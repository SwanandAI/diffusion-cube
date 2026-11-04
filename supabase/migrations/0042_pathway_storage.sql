-- Pathway storage in the app database (docs/features/pathway-storage/).
-- Pathways stop living in GitHub and in files shipped with the app. A pathway
-- is now: versions of its reviewed document (pathway_versions), its
-- micro-innovation units as searchable rows (pathway_units: labels, a
-- full-text index and a 384-dim gte-small embedding), and — for seeded
-- pathways only — its original documents (pathway_sources) cut into embedded
-- passages (pathway_source_chunks). match_pathway_units / match_source_chunks
-- run the hybrid search (vector + full text + label filters, merged by
-- reciprocal rank) that grounds Explore and Analyse.
--
-- DESTRUCTIVE: drops the published_pathways TABLE and every row in it
-- (business decision Q21 — the live library is rebuilt from the seed), and
-- recreates published_pathways as a VIEW over the new tables with the same
-- columns, so its existing readers keep working. Existing pathways rows lose
-- their published state: none is 'published' after this migration.
--
-- The view runs with its owner's rights (not security_invoker) so the public
-- /explore page can read it without a session, exactly as the old table's
-- `using (true)` policy allowed. Supabase's linter flags this; it is
-- intentional (plan_pathway_storage.md → Key Tradeoffs). Do not "fix" it.

create extension if not exists vector with schema extensions;

-- ── pathways: lifecycle + card fields ────────────────────────────────────
alter table public.pathways
  add column if not exists status text not null default 'draft',
  add column if not exists published_version_id uuid,
  add column if not exists is_seed boolean not null default false,
  add column if not exists stage text not null default '',
  add column if not exists location text not null default '',
  add column if not exists tags text[] not null default '{}',
  add column if not exists organisation text not null default '',
  add column if not exists published_by uuid references auth.users (id) on delete set null,
  add column if not exists first_published_at timestamptz;

alter table public.pathways drop constraint if exists pathways_status_check;
alter table public.pathways
  add constraint pathways_status_check
  check (status in ('draft', 'in_review', 'published', 'retired'));

update public.pathways
  set status = case when review_requested then 'in_review' else 'draft' end;

-- ── pathway_versions: every document sent for review, or seeded ──────────
create table if not exists public.pathway_versions (
  id uuid primary key default gen_random_uuid(),
  pathway_id uuid not null references public.pathways (id) on delete cascade,
  version_number integer not null,
  content text not null,
  source text not null check (source in ('contributor', 'seed')),
  design_document_id uuid references public.design_documents (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  change_note text not null default '',
  created_at timestamptz not null default now(),
  unique (pathway_id, version_number)
);

alter table public.pathway_versions enable row level security;

-- Same audience as the pathway row itself (0040): its contributors and
-- admins. Writes go through the service role only (lib/pathway-store.ts).
drop policy if exists "Contributors and admins can view pathway versions" on public.pathway_versions;
create policy "Contributors and admins can view pathway versions"
  on public.pathway_versions for select
  using (
    exists (
      select 1 from public.pathway_contributors pc
      where pc.pathway_id = pathway_versions.pathway_id and pc.user_id = auth.uid()
    )
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role = 'admin'
    )
  );

alter table public.pathways drop constraint if exists pathways_published_version_id_fkey;
alter table public.pathways
  add constraint pathways_published_version_id_fkey
  foreign key (published_version_id) references public.pathway_versions (id) on delete set null;

-- ── pathway_units: one row per micro-innovation of a PUBLISHED version ────
-- lib/pathway-store.ts replaces a pathway's rows on every publish and deletes
-- them on retire, so only published units ever exist here.
create table if not exists public.pathway_units (
  id text primary key, -- <slug>-uNN
  pathway_id uuid not null references public.pathways (id) on delete cascade,
  version_id uuid not null references public.pathway_versions (id) on delete cascade,
  unit_number integer not null,
  title text not null,
  unit_type text not null,
  dimension text not null,
  sub_category text not null,
  stage text not null,
  also_relevant_at text[] not null default '{}',
  applies_when text not null default '',
  fails_when text not null default '',
  body text not null,
  adopter_intents text[] not null default '{}',
  source_ids text[] not null default '{}',
  fts tsvector,
  embedding extensions.vector(384),
  created_at timestamptz not null default now()
);

-- fts is kept by a trigger rather than a generated column: array_to_string
-- isn't immutable, which generated columns require.
create or replace function public.pathway_units_set_fts()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.fts :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('english', array_to_string(new.adopter_intents, ' ')), 'B')
    || setweight(to_tsvector('english', coalesce(new.applies_when, '') || ' ' || coalesce(new.fails_when, '')), 'B')
    || setweight(to_tsvector('english', coalesce(new.body, '')), 'C');
  return new;
end;
$$;

drop trigger if exists pathway_units_fts on public.pathway_units;
create trigger pathway_units_fts
  before insert or update on public.pathway_units
  for each row execute function public.pathway_units_set_fts();

create index if not exists pathway_units_fts_idx on public.pathway_units using gin (fts);
create index if not exists pathway_units_embedding_idx
  on public.pathway_units using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists pathway_units_pathway_idx on public.pathway_units (pathway_id);
create index if not exists pathway_units_dimension_stage_idx on public.pathway_units (dimension, stage);

alter table public.pathway_units enable row level security;

-- Published content, readable by anyone like the old published_pathways.
-- No write policy: the service role writes.
drop policy if exists "Anyone can view published units" on public.pathway_units;
create policy "Anyone can view published units"
  on public.pathway_units for select
  using (true);

-- ── pathway_sources / pathway_source_chunks: seeded pathways' originals ──
-- Service role only (RLS on, no policies). The app uses only is_public
-- sources for adopters, and filters on it in code as well as in SQL.
create table if not exists public.pathway_sources (
  id uuid primary key default gen_random_uuid(),
  pathway_id uuid not null references public.pathways (id) on delete cascade,
  source_key text not null, -- src-01, src-02, ... (the Source Trace keys)
  file_name text not null,
  storage_path text,
  mime_type text,
  extracted_text text not null default '',
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  unique (pathway_id, source_key)
);

alter table public.pathway_sources enable row level security;

create table if not exists public.pathway_source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.pathway_sources (id) on delete cascade,
  pathway_id uuid not null references public.pathways (id) on delete cascade,
  chunk_index integer not null,
  text text not null,
  embedding extensions.vector(384),
  unique (source_id, chunk_index)
);

alter table public.pathway_source_chunks enable row level security;

create index if not exists pathway_source_chunks_embedding_idx
  on public.pathway_source_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists pathway_source_chunks_pathway_idx on public.pathway_source_chunks (pathway_id);

-- ── Hybrid search over published units ───────────────────────────────────
-- Reciprocal-rank fusion of cosine similarity and full-text rank. Any filter
-- left null is ignored. A null query_embedding ranks by full text alone (the
-- fallback when the embedding function is down); with neither a vector nor
-- text, the filtered units are returned in document order. The full-text
-- query ORs the question's words, so a long natural question still matches.
create or replace function public.match_pathway_units(
  query_embedding extensions.vector(384),
  query_text text,
  filter_slugs text[] default null,
  filter_dimension text default null,
  filter_stage text default null,
  filter_types text[] default null,
  match_count integer default 30,
  rrf_k integer default 50
)
returns table (
  id text,
  pathway_id uuid,
  slug text,
  pathway_title text,
  sector text,
  unit_number integer,
  title text,
  unit_type text,
  dimension text,
  sub_category text,
  stage text,
  also_relevant_at text[],
  applies_when text,
  fails_when text,
  body text,
  score double precision
)
language sql
stable
set search_path = public, extensions
as $$
  with
  q as (
    select case
      when coalesce(btrim(query_text), '') = '' then null
      else nullif(replace(plainto_tsquery('english', query_text)::text, '&', '|'), '')::tsquery
    end as tsq
  ),
  candidates as (
    select u.*, p.slug as p_slug, p.title as p_title, p.sector as p_sector
    from pathway_units u
    join pathways p on p.id = u.pathway_id
    where p.status = 'published'
      and (filter_slugs is null or p.slug = any (filter_slugs))
      and (filter_dimension is null or u.dimension = filter_dimension)
      and (filter_stage is null or u.stage = filter_stage or filter_stage = any (u.also_relevant_at))
      and (filter_types is null or u.unit_type = any (filter_types))
  ),
  full_text as (
    select c.id, row_number() over (order by ts_rank_cd(c.fts, q.tsq) desc) as rank_ix
    from candidates c, q
    where q.tsq is not null and c.fts @@ q.tsq
    order by rank_ix
    limit match_count * 2
  ),
  semantic as (
    select c.id, row_number() over (order by c.embedding <=> query_embedding) as rank_ix
    from candidates c
    where query_embedding is not null and c.embedding is not null
    order by rank_ix
    limit match_count * 2
  ),
  browse as (
    select c.id, row_number() over (order by c.p_slug, c.unit_number) as rank_ix
    from candidates c, q
    where query_embedding is null and q.tsq is null
  )
  select
    c.id, c.pathway_id, c.p_slug, c.p_title, c.p_sector, c.unit_number, c.title, c.unit_type,
    c.dimension, c.sub_category, c.stage, c.also_relevant_at, c.applies_when, c.fails_when, c.body,
    coalesce(1.0 / (rrf_k + ft.rank_ix), 0.0)
      + coalesce(1.0 / (rrf_k + s.rank_ix), 0.0)
      + coalesce(1.0 / (rrf_k + b.rank_ix), 0.0) as score
  from candidates c
  left join full_text ft on ft.id = c.id
  left join semantic s on s.id = c.id
  left join browse b on b.id = c.id
  where ft.id is not null or s.id is not null or b.id is not null
  order by score desc, c.p_slug, c.unit_number
  limit match_count;
$$;

-- Nearest public passages of one published, seeded pathway's originals.
create or replace function public.match_source_chunks(
  query_embedding extensions.vector(384),
  pathway_slug text,
  match_count integer default 5
)
returns table (
  id uuid,
  source_key text,
  file_name text,
  chunk_index integer,
  text text,
  is_public boolean,
  similarity double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select ch.id, s.source_key, s.file_name, ch.chunk_index, ch.text, s.is_public,
         1 - (ch.embedding <=> query_embedding) as similarity
  from pathway_source_chunks ch
  join pathway_sources s on s.id = ch.source_id
  join pathways p on p.id = ch.pathway_id
  where p.slug = pathway_slug
    and p.status = 'published'
    and s.is_public
    and ch.embedding is not null
    and query_embedding is not null
  order by ch.embedding <=> query_embedding
  limit match_count;
$$;

-- Only the server calls these (with the service role).
revoke all on function public.match_pathway_units(extensions.vector, text, text[], text, text, text[], integer, integer) from public, anon, authenticated;
revoke all on function public.match_source_chunks(extensions.vector, text, integer) from public, anon, authenticated;
grant execute on function public.match_pathway_units(extensions.vector, text, text[], text, text, text[], integer, integer) to service_role;
grant execute on function public.match_source_chunks(extensions.vector, text, integer) to service_role;

-- ── published_pathways: table → view ─────────────────────────────────────
drop table if exists public.published_pathways;

create view public.published_pathways as
select
  p.id,
  p.slug,
  p.title,
  p.description,
  case
    when cardinality(p.tags) > 0 then array_to_string(p.tags[1:2], ' · ')
    else 'Community'
  end as category,
  v.content,
  p.sector,
  p.location,
  p.tags,
  p.stage,
  nullif(p.organisation, '') as contributor_org,
  p.published_by,
  coalesce(p.first_published_at, v.created_at) as created_at
from public.pathways p
join public.pathway_versions v on v.id = p.published_version_id
where p.status = 'published';

grant select on public.published_pathways to anon, authenticated;

-- ── Private bucket for seeded pathways' original files ───────────────────
-- No storage.objects policies: only the service role (the seed script and
-- the delete route) touches it. Adopters never download originals.
insert into storage.buckets (id, name, public, file_size_limit)
values ('pathway-sources', 'pathway-sources', false, 52428800) -- 50 MB
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;
