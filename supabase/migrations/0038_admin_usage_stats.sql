-- All figures for the admin Usage page (/admin/usage; customer spec "Usage
-- logging and monitoring", docs/features/monitoring-logging-cleanup/) in one
-- call, computed when the page opens. "Last week" = the last 7 days.
-- - users: auth.users totals; "active" = any activity in the window in
--   designs, library_conversations or ai_usage.
-- - conversations: designs split by meta->>'flow' (contributor → contribute,
--   otherwise analyse) plus library_conversations (explore — signed-in only).
-- - ai_usage: per area, since the table started (release day).
-- - errors: sys_errors (30 days kept) per day (UTC) and per source, split by
--   context->>'kind'.
-- The published-pathway count is added by the page (static corpus files +
-- published_pathways, deduplicated), since SQL can't read the files.
-- security definer so it can read auth.users; only the server may call it.
-- Additive only.
create or replace function public.admin_usage_stats()
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  with
  activity as (
    select user_id, updated_at as at from public.designs
    union all
    select user_id, updated_at from public.library_conversations
    union all
    select user_id, created_at from public.ai_usage where user_id is not null
  ),
  conversations as (
    select case when meta->>'flow' = 'contributor' then 'contribute' else 'analyse' end as area, created_at
    from public.designs
    union all
    select 'explore', created_at from public.library_conversations
  ),
  errors as (
    select created_at, source,
           case when context->>'kind' = 'expected' then 'expected' else 'unexpected' end as kind
    from public.sys_errors
  )
  select jsonb_build_object(
    'users', jsonb_build_object(
      'total', (select count(*) from auth.users),
      'new_7d', (select count(*) from auth.users where created_at >= now() - interval '7 days'),
      'active_7d', (select count(distinct user_id) from activity where at >= now() - interval '7 days'),
      'active_30d', (select count(distinct user_id) from activity where at >= now() - interval '30 days')
    ),
    'conversations', (
      select coalesce(jsonb_object_agg(area, jsonb_build_object('total', total, 'last_7d', last_7d)), '{}'::jsonb)
      from (
        select area, count(*) as total, count(*) filter (where created_at >= now() - interval '7 days') as last_7d
        from conversations group by area
      ) c
    ),
    'ai_usage', (
      select coalesce(jsonb_object_agg(area, jsonb_build_object(
        'calls', calls, 'failed', failed,
        'input_tokens', input_tokens, 'output_tokens', output_tokens,
        'cache_read_tokens', cache_read_tokens, 'cache_creation_tokens', cache_creation_tokens
      )), '{}'::jsonb)
      from (
        select area, count(*) as calls, count(*) filter (where not ok) as failed,
               coalesce(sum(input_tokens), 0) as input_tokens, coalesce(sum(output_tokens), 0) as output_tokens,
               coalesce(sum(cache_read_tokens), 0) as cache_read_tokens,
               coalesce(sum(cache_creation_tokens), 0) as cache_creation_tokens
        from public.ai_usage group by area
      ) u
    ),
    'errors_per_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', day, 'expected', expected, 'unexpected', unexpected) order by day desc), '[]'::jsonb)
      from (
        select (created_at at time zone 'utc')::date as day,
               count(*) filter (where kind = 'expected') as expected,
               count(*) filter (where kind = 'unexpected') as unexpected
        from errors group by 1
      ) d
    ),
    'errors_per_source', (
      select coalesce(jsonb_agg(jsonb_build_object('source', source, 'expected', expected, 'unexpected', unexpected) order by unexpected desc, expected desc), '[]'::jsonb)
      from (
        select source,
               count(*) filter (where kind = 'expected') as expected,
               count(*) filter (where kind = 'unexpected') as unexpected
        from errors group by source
      ) s
    )
  );
$$;

-- Functions are executable by PUBLIC by default; only the server may call it.
revoke all on function public.admin_usage_stats() from public, anon, authenticated;
grant execute on function public.admin_usage_stats() to service_role;
