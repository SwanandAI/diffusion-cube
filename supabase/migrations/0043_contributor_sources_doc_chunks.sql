-- Contributor originals, full-document indexing and index status
-- (follows 0042_pathway_storage.sql).
--
-- 1. pathway_sources now also holds contributors' original documents. Every
--    document a contributor sends in their workspace is kept (file in the
--    private pathway-sources bucket + its extracted text), with no per-file
--    choice: contributor rows are is_public = true, so once the pathway is
--    published they can answer adopters' one-pathway questions. They are
--    NOT embedded: lib/retrieval.ts reads their text directly when the
--    published write-up doesn't cover a question. Seeded rows keep the
--    manifest's flag and their embedded passages (pathway_source_chunks).
-- 2. pathway_doc_chunks: the published pathway document itself (frontmatter
--    and Source Trace removed), cut by section into passages and embedded
--    after every publish — lib/pathway-store.ts (indexPublishedVersion). match_pathway_doc_chunks
--    finds the ones nearest a question, for one pathway.
-- 3. pathways.index_status: publish no longer embeds inside the request; a
--    background job does, with retries, and records the outcome here.

-- ── 1. Contributor originals ─────────────────────────────────────────────
alter table public.pathway_sources
  add column if not exists origin text not null default 'seed',
  add column if not exists design_id uuid references public.designs (id) on delete set null,
  add column if not exists uploaded_by uuid references auth.users (id) on delete set null,
  add column if not exists content_hash text;

alter table public.pathway_sources drop constraint if exists pathway_sources_origin_check;
alter table public.pathway_sources
  add constraint pathway_sources_origin_check check (origin in ('seed', 'contributor'));

create index if not exists pathway_sources_pathway_idx on public.pathway_sources (pathway_id);
-- The same document sent twice is kept once.
create unique index if not exists pathway_sources_contributor_dedupe_idx
  on public.pathway_sources (pathway_id, content_hash)
  where origin = 'contributor' and content_hash is not null;

-- ── 2. The published document, embedded by section ────────────────────────
-- Service role only (RLS on, no policies), like pathway_source_chunks.
create table if not exists public.pathway_doc_chunks (
  id uuid primary key default gen_random_uuid(),
  pathway_id uuid not null references public.pathways (id) on delete cascade,
  version_id uuid not null references public.pathway_versions (id) on delete cascade,
  section text not null default '',
  chunk_index integer not null,
  text text not null,
  embedding extensions.vector(384),
  created_at timestamptz not null default now(),
  unique (pathway_id, chunk_index)
);

alter table public.pathway_doc_chunks enable row level security;

create index if not exists pathway_doc_chunks_embedding_idx
  on public.pathway_doc_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists pathway_doc_chunks_pathway_idx on public.pathway_doc_chunks (pathway_id);

-- Nearest passages of one published pathway's live document.
create or replace function public.match_pathway_doc_chunks(
  query_embedding extensions.vector(384),
  pathway_slug text,
  match_count integer default 5
)
returns table (
  section text,
  chunk_index integer,
  text text,
  similarity double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select c.section, c.chunk_index, c.text, 1 - (c.embedding <=> query_embedding) as similarity
  from pathway_doc_chunks c
  join pathways p on p.id = c.pathway_id
  where p.slug = pathway_slug
    and p.status = 'published'
    and c.version_id = p.published_version_id
    and c.embedding is not null
    and query_embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_pathway_doc_chunks(extensions.vector, text, integer) from public, anon, authenticated;
grant execute on function public.match_pathway_doc_chunks(extensions.vector, text, integer) to service_role;

-- ── 3. Index status ──────────────────────────────────────────────────────
alter table public.pathways
  add column if not exists index_status text not null default 'none',
  add column if not exists indexed_at timestamptz,
  add column if not exists index_error text;

alter table public.pathways drop constraint if exists pathways_index_status_check;
alter table public.pathways
  add constraint pathways_index_status_check
  check (index_status in ('none', 'pending', 'indexed', 'failed'));
