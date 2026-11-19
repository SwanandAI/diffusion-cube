-- Thumbs up / down on Cube's chat replies (POST /api/feedback, shown on /admin/usage).
-- One row per (reply, voter): changing a vote updates the row, undoing it
-- deletes the row. Written only by POST /api/feedback with the service role,
-- so the table has RLS on and no client policy at all (like sys_errors and
-- ai_usage). message_id is the id the browser gives each streamed reply; it
-- is also stored on the message itself in designs.messages /
-- library_conversations.messages so the chosen thumb survives a reload.
-- voter_key is 'user:<auth uid>' for a signed-in voter or 'anon:<salted IP
-- hash>' for a signed-out /explore visitor, so one unique key covers both.
-- message_excerpt keeps the start of the reply so admins can see what was
-- rated without opening anyone's conversation (and for the planned digest).
-- admin_feedback_stats() returns the figures for /admin/usage.
-- Additive only.
create table if not exists public.message_feedback (
  id uuid primary key default gen_random_uuid(),
  message_id text not null check (char_length(message_id) between 1 and 64),
  voter_key text not null,
  user_id uuid references auth.users(id) on delete cascade,
  surface text not null check (surface in ('explore', 'analyse', 'contribute')),
  conversation_id uuid,
  pathway_slug text,
  vote smallint not null check (vote in (1, -1)),
  message_excerpt text not null default '' check (char_length(message_excerpt) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id, voter_key)
);

create index if not exists message_feedback_surface_created_idx
  on public.message_feedback (surface, created_at desc);
create index if not exists message_feedback_user_idx
  on public.message_feedback (user_id);

alter table public.message_feedback enable row level security;

-- Figures for the Feedback section of /admin/usage, computed on page load.
-- security definer so it reads the table regardless of caller; only the
-- server may call it.
create or replace function public.admin_feedback_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'per_surface', (
      select coalesce(jsonb_object_agg(surface, jsonb_build_object(
        'up', up, 'down', down, 'up_7d', up_7d, 'down_7d', down_7d
      )), '{}'::jsonb)
      from (
        select surface,
               count(*) filter (where vote = 1) as up,
               count(*) filter (where vote = -1) as down,
               count(*) filter (where vote = 1 and updated_at >= now() - interval '7 days') as up_7d,
               count(*) filter (where vote = -1 and updated_at >= now() - interval '7 days') as down_7d
        from public.message_feedback group by surface
      ) s
    ),
    'recent_down', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'surface', surface, 'pathway_slug', pathway_slug,
        'excerpt', message_excerpt, 'at', updated_at
      ) order by updated_at desc), '[]'::jsonb)
      from (
        select surface, pathway_slug, message_excerpt, updated_at
        from public.message_feedback
        where vote = -1
        order by updated_at desc
        limit 20
      ) d
    )
  );
$$;

-- Functions are executable by PUBLIC by default; only the server may call it.
revoke all on function public.admin_feedback_stats() from public, anon, authenticated;
grant execute on function public.admin_feedback_stats() to service_role;
