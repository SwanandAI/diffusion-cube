-- /admin/usage's Activity table gets an Overall / Last 7 days / Last 30 days
-- toggle, so both of its sources now also return 30-day figures:
-- - admin_usage_stats() (0041): conversations.<area>.last_30d, counted by
--   created_at like last_7d (and like the Feedback Digest's period, 0044).
-- - admin_feedback_stats() (0043): per_surface.<surface>.up_30d / down_30d,
--   counted by the vote's updated_at like up_7d / down_7d.
-- Both functions are otherwise unchanged (same signatures, same keys plus the
-- new ones), so this is create-or-replace only. Additive only.

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
      select coalesce(jsonb_object_agg(area, jsonb_build_object('total', total, 'last_7d', last_7d, 'last_30d', last_30d)), '{}'::jsonb)
      from (
        select area, count(*) as total,
               count(*) filter (where created_at >= now() - interval '7 days') as last_7d,
               count(*) filter (where created_at >= now() - interval '30 days') as last_30d
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
        select (created_at at time zone 'Asia/Kolkata')::date as day,
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
        'up', up, 'down', down, 'up_7d', up_7d, 'down_7d', down_7d, 'up_30d', up_30d, 'down_30d', down_30d
      )), '{}'::jsonb)
      from (
        select surface,
               count(*) filter (where vote = 1) as up,
               count(*) filter (where vote = -1) as down,
               count(*) filter (where vote = 1 and updated_at >= now() - interval '7 days') as up_7d,
               count(*) filter (where vote = -1 and updated_at >= now() - interval '7 days') as down_7d,
               count(*) filter (where vote = 1 and updated_at >= now() - interval '30 days') as up_30d,
               count(*) filter (where vote = -1 and updated_at >= now() - interval '30 days') as down_30d
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

-- Functions are executable by PUBLIC by default; only the server may call them.
revoke all on function public.admin_feedback_stats() from public, anon, authenticated;
grant execute on function public.admin_feedback_stats() to service_role;
