-- System error log for the system administrator (customer spec "Handling
-- System Errors"; docs/features/monitoring-logging-cleanup/). Every error the
-- server sees — expected (validation, sign-in, not found; context->>'kind' =
-- 'expected') and unexpected (context->>'kind' = 'unexpected') — is written
-- here by lib/errors.ts's logError() through the service-role client, with the
-- full stack trace. Context holds IDs and short metadata only (allow-listed in
-- lib/errors.ts), never passwords, tokens or chat transcripts. Kept for 30
-- days: logError() calls purge_old_sys_errors() at most hourly per instance.
-- Additive only.
create table if not exists public.sys_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null,
  message text not null,
  stack text,
  context jsonb,
  -- Account deletion anonymises rather than deletes the row.
  user_id uuid references auth.users (id) on delete set null,
  environment text not null check (environment in ('prod', 'dev'))
);

create index if not exists sys_errors_created_idx
  on public.sys_errors (created_at desc);

create index if not exists sys_errors_source_created_idx
  on public.sys_errors (source, created_at desc);

-- RLS on with no policies: no browser client (anon or authenticated) can read
-- or write this table. Writes and admin-page reads go through the service role.
alter table public.sys_errors enable row level security;

create or replace function public.purge_old_sys_errors(days integer default 30)
returns integer
language sql
as $$
  with deleted as (
    delete from public.sys_errors
    where created_at < now() - make_interval(days => days)
    returning 1
  )
  select count(*)::integer from deleted;
$$;

-- Functions are executable by PUBLIC by default; only the server may purge.
revoke all on function public.purge_old_sys_errors(integer) from public, anon, authenticated;
grant execute on function public.purge_old_sys_errors(integer) to service_role;
