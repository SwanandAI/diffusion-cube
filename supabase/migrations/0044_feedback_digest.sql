-- Feedback Digest for admins (docs/features/feedback-digest/, FD-01): the
-- figures and the AI-written digest on /admin/usage/digest.
--
-- - feedback_digests: the latest digest per period (7 or 30 days), replaced
--   on every successful Regenerate. No history.
-- - feedback_digest_runs: one row per Generate attempt (who, when, result),
--   for the 10-per-day cap. The call's tokens are recorded in ai_usage
--   (area 'admin') like every other Claude call.
-- - feedback_digest_lock: a single-row lease so only one digest is generated
--   at a time across all admins.
-- - admin_digest_stats(): the page's numbers, computed on load.
-- - admin_digest_input(): the model's input, built here so only trimmed text
--   leaves the database (never uploaded documents' full text, never a user
--   id: people are random numbers per call).
-- - claim_feedback_digest_run() / finish_feedback_digest_run(): the lease,
--   the daily cap and the attempt log, each in one statement.
--
-- Every function is security definer and executable by the service role
-- only (the API route checks isAdmin first); the new tables have RLS on and
-- no policies. Admins' own conversations are counted like anyone's.
--
-- Conversations are read from the jsonb message arrays the chat clients
-- write (components/ChatPanel.tsx Message, lib/adoption-conversation.ts,
-- app/explore/ExploreLibrary.tsx ChatMessage): role, content, displayContent,
-- hidden, pathwaysReferenced and at. A change to those shapes must be
-- mirrored here.
--
-- Additive, except one step: ai_usage's area check is REPLACED to also
-- allow 'admin' (digest calls). No rows are changed.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.feedback_digest_runs (
  id uuid primary key default gen_random_uuid(),
  period_days int not null check (period_days in (7, 30)),
  admin_user_id uuid references auth.users (id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'empty', 'failed', 'superseded'))
);

create index if not exists feedback_digest_runs_started_idx
  on public.feedback_digest_runs (started_at desc);

alter table public.feedback_digest_runs enable row level security;
revoke all on public.feedback_digest_runs from anon, authenticated;

create table if not exists public.feedback_digests (
  period_days int primary key check (period_days in (7, 30)),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  generated_at timestamptz not null default now(),
  run_id uuid references public.feedback_digest_runs (id) on delete set null
);

alter table public.feedback_digests enable row level security;
revoke all on public.feedback_digests from anon, authenticated;

create table if not exists public.feedback_digest_lock (
  id int primary key default 1 check (id = 1),
  run_id uuid not null,
  locked_until timestamptz not null
);

alter table public.feedback_digest_lock enable row level security;
revoke all on public.feedback_digest_lock from anon, authenticated;

-- ---------------------------------------------------------------------------
-- ai_usage: allow the 'admin' area (mode 'digest', lib/ai-usage.ts).
-- REPLACES the check from 0a036; existing rows all satisfy the new one.
-- ---------------------------------------------------------------------------

alter table public.ai_usage drop constraint if exists ai_usage_area_check;
alter table public.ai_usage
  add constraint ai_usage_area_check check (area in ('explore', 'analyse', 'contribute', 'admin'));

-- Period filters on conversations (created_at, as /admin/usage counts them).
create index if not exists designs_created_at_idx on public.designs (created_at);
create index if not exists library_conversations_created_at_idx on public.library_conversations (created_at);

-- ---------------------------------------------------------------------------
-- A message's own time: its `at` stamp when that is a valid, finite
-- timestamp, never later than now; else p_fallback. Users can write their
-- own message arrays (designs RLS), so a malformed `at` must fall back,
-- never raise; 'infinity' falls back, and a future time counts as now, so
-- nobody can sort their messages ahead of everyone else's. Used only to
-- order messages newest first; an unstamped message (written before stamps
-- existed) takes its conversation's last update.
-- ---------------------------------------------------------------------------

create or replace function public.digest_message_time(p_at text, p_fallback timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v timestamptz;
begin
  if p_at is null or p_at = '' then
    return p_fallback;
  end if;
  v := p_at::timestamptz;
  if not isfinite(v) then
    return p_fallback;
  end if;
  return least(v, now());
exception when others then
  return p_fallback;
end;
$$;

revoke all on function public.digest_message_time(text, timestamptz) from public, anon, authenticated;
grant execute on function public.digest_message_time(text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Numbers for the page: the period's users and conversations (for the
-- banner; all-time totals and 👍/👎 counts live on /admin/usage), the most
-- discussed pathways, and what still exists. Keys identify conversations
-- across both stores:
-- d:<designs.id>, l:<library_conversations.id>, f:<message_feedback.id>
-- (a vote, used when a 👎 is cited on its own). live_keys lets a saved digest
-- drop what has since been deleted.
--
-- A conversation is "in the period" when it was CREATED in it, exactly as
-- admin_usage_stats() (0041) counts /admin/usage's "Last 7 days" column, so
-- the two pages always agree. A change to one must be mirrored in the other.
--
-- PERFORMANCE: "pathways" (till date) unnests every conversation's messages
-- on each page load. Fine at today's scale; cache it if the page slows.
-- ---------------------------------------------------------------------------

create or replace function public.admin_digest_stats(p_days int, p_since timestamptz default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with
  conv as (
    select 'd:' || d.id as key, d.user_id, d.created_at, d.messages, null::text as pathway_slug
    from public.designs d
    union all
    select 'l:' || l.id, l.user_id, l.created_at, l.messages, l.pathway_slug
    from public.library_conversations l
  ),
  msgs as (
    select c.key, m.value as msg
    from conv c
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(c.messages) = 'array' then c.messages else '[]'::jsonb end
    ) as m(value)
  ),
  in_period as (
    select key, user_id from conv
    where created_at >= now() - make_interval(days => p_days)
  ),
  mentions as (
    select msgs.key, r.slug
    from msgs
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(msgs.msg->'pathwaysReferenced') = 'array'
           then msgs.msg->'pathwaysReferenced' else '[]'::jsonb end
    ) as r(slug)
    where msgs.msg->>'role' = 'assistant'
    union
    select key, pathway_slug from conv where pathway_slug is not null
  ),
  pathway_counts as (
    select p.slug, p.title, count(distinct mn.key) as conversations
    from mentions mn
    join public.pathways p on p.slug = mn.slug and p.status = 'published'
    group by p.slug, p.title
  ),
  live_feedback as (
    select 'f:' || f.id as key
    from public.message_feedback f
    where f.conversation_id is null
       or exists (select 1 from public.designs d where d.id = f.conversation_id)
       or exists (select 1 from public.library_conversations l where l.id = f.conversation_id)
  )
  select case
    when p_days not in (7, 30) then null
    else jsonb_build_object(
      'users_period', (select count(distinct user_id) from in_period),
      'conversations_period', (select count(*) from in_period),
      'pathways', coalesce((
        select jsonb_agg(jsonb_build_object('slug', slug, 'title', title, 'conversations', conversations)
                         order by conversations desc, title)
        from (select * from pathway_counts order by conversations desc, title limit 10) top
      ), '[]'::jsonb),
      'live_keys', coalesce((
        select jsonb_agg(key) from (select key from conv union all select key from live_feedback) k
      ), '[]'::jsonb),
      'new_since', case
        when p_since is null then 0
        else (select count(*) from conv where created_at > p_since)
      end
    )
  end;
$$;

-- ---------------------------------------------------------------------------
-- The model's input for one period: the user messages of the conversations
-- created in the period (the same conversations the page and /admin/usage
-- count), newest first, at most 400 of them and at most
-- 80 per person (so one account can't fill the input), with the bubble text
-- (displayContent over content, so an upload's extracted text never leaves)
-- cut to 400 characters, each with the start of Cube's next reply (400
-- characters) and the pathways that reply drew on; plus the period's 👎
-- votes with their excerpts (300). lib/feedback-digest.ts scrubs contact
-- details from this text and then trims it to 300 / 300 / 200, dropping a
-- word the cut here may have split, so a half-cut email can't survive.
-- `person` is numbered at random on every call, so it means nothing outside
-- one result.
-- ---------------------------------------------------------------------------

create or replace function public.admin_digest_input(p_days int)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with
  conv as (
    select 'd:' || d.id as key, d.user_id,
           case when d.meta->>'flow' = 'contributor' then 'contribute' else 'analyse' end as area,
           d.updated_at, d.messages, null::text as pathway_slug
    from public.designs d
    where d.created_at >= now() - make_interval(days => p_days)
    union all
    select 'l:' || l.id, l.user_id, 'explore', l.updated_at, l.messages, l.pathway_slug
    from public.library_conversations l
    where l.created_at >= now() - make_interval(days => p_days)
  ),
  msgs as (
    select c.key, c.user_id, c.area, c.updated_at, c.pathway_slug, m.value as msg, m.pos
    from conv c
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(c.messages) = 'array' then c.messages else '[]'::jsonb end
    ) with ordinality as m(value, pos)
  ),
  user_msgs as (
    select u.key, u.user_id, u.area,
           public.digest_message_time(u.msg->>'at', u.updated_at) as at,
           left(coalesce(nullif(u.msg->>'displayContent', ''), u.msg->>'content', ''), 400) as question,
           left(r.msg->>'content', 400) as reply,
           case
             when jsonb_typeof(r.msg->'pathwaysReferenced') = 'array' then r.msg->'pathwaysReferenced'
             when u.pathway_slug is not null then jsonb_build_array(u.pathway_slug)
             else '[]'::jsonb
           end as pathways
    from msgs u
    left join msgs r on r.key = u.key and r.pos = u.pos + 1 and r.msg->>'role' = 'assistant'
    where u.msg->>'role' = 'user' and coalesce(u.msg->>'hidden', '') <> 'true'
  ),
  period_msgs as (
    select * from user_msgs
    where question <> ''
  ),
  ranked as (
    select p.*, row_number() over (partition by p.user_id order by p.at desc) as rn
    from period_msgs p
  ),
  newest as (
    select * from ranked where rn <= 80 order by at desc limit 400
  ),
  down_votes as (
    select 'f:' || f.id as key,
           coalesce(f.user_id::text, f.voter_key) as voter,
           f.surface as area, f.pathway_slug, f.updated_at as at,
           left(f.message_excerpt, 300) as excerpt
    from public.message_feedback f
    where f.vote = -1 and f.updated_at >= now() - make_interval(days => p_days)
      and (f.conversation_id is null
           or exists (select 1 from public.designs d where d.id = f.conversation_id)
           or exists (select 1 from public.library_conversations l where l.id = f.conversation_id))
  ),
  voters as (
    select voter, row_number() over (order by random()) as person
    from (
      select distinct user_id::text as voter from newest
      union
      select distinct voter from down_votes
    ) v
  )
  select case
    when p_days not in (7, 30) then null
    else jsonb_build_object(
      'messages_total', (select count(*) from period_msgs),
      'messages', coalesce((
        select jsonb_agg(jsonb_build_object(
          'key', n.key, 'area', n.area, 'person', vo.person, 'at', n.at,
          'question', n.question, 'reply', n.reply, 'pathways', n.pathways
        ) order by n.at)
        from newest n join voters vo on vo.voter = n.user_id::text
      ), '[]'::jsonb),
      'feedback', coalesce((
        select jsonb_agg(jsonb_build_object(
          'key', dv.key, 'area', dv.area, 'person', vo.person, 'at', dv.at,
          'pathway_slug', dv.pathway_slug, 'excerpt', dv.excerpt
        ) order by dv.at)
        from down_votes dv join voters vo on vo.voter = dv.voter
      ), '[]'::jsonb)
    )
  end;
$$;

-- ---------------------------------------------------------------------------
-- Lease, daily cap and attempt log. Both functions take the same advisory
-- lock, so two admins pressing Regenerate together are serialised.
-- ---------------------------------------------------------------------------

-- {run_id} when this run may proceed; {error: 'busy'} while another run's
-- lease (5 minutes) is live; {error: 'daily_limit'} once p_cap attempts
-- have started today, counted in India Standard Time days.
create or replace function public.claim_feedback_digest_run(p_period int, p_admin uuid, p_cap int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_run uuid := gen_random_uuid();
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_count int;
begin
  if p_period not in (7, 30) then
    raise exception 'bad_period' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('feedback_digest'));

  if exists (select 1 from public.feedback_digest_lock where id = 1 and locked_until > now()) then
    return jsonb_build_object('error', 'busy');
  end if;

  select count(*) into v_count from public.feedback_digest_runs where started_at >= v_day_start;
  if v_count >= p_cap then
    return jsonb_build_object('error', 'daily_limit');
  end if;

  insert into public.feedback_digest_runs (id, period_days, admin_user_id, status)
  values (v_run, p_period, p_admin, 'running');

  insert into public.feedback_digest_lock (id, run_id, locked_until)
  values (1, v_run, now() + interval '5 minutes')
  on conflict (id) do update
    set run_id = excluded.run_id, locked_until = excluded.locked_until;

  return jsonb_build_object('run_id', v_run);
end;
$$;

-- Records how a run ended and releases its lease. A 'succeeded' or 'empty'
-- run saves its digest (replacing only that period's) if it still holds the
-- lease; if another run took over meanwhile it is marked 'superseded' and
-- false is returned. A 'failed' run never touches the saved digest.
create or replace function public.finish_feedback_digest_run(p_run uuid, p_status text, p_payload jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_period int;
  v_held boolean;
begin
  if p_status not in ('succeeded', 'empty', 'failed') then
    raise exception 'bad_status' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('feedback_digest'));

  select period_days into v_period
  from public.feedback_digest_runs
  where id = p_run and status = 'running';
  if v_period is null then
    return false;
  end if;

  delete from public.feedback_digest_lock where id = 1 and run_id = p_run;
  v_held := found;

  if p_status in ('succeeded', 'empty') then
    if not v_held then
      update public.feedback_digest_runs
      set status = 'superseded', finished_at = now()
      where id = p_run;
      return false;
    end if;
    if jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload) > 1048576 then
      raise exception 'bad_payload' using errcode = '22023';
    end if;
    insert into public.feedback_digests (period_days, payload, generated_at, run_id)
    values (v_period, p_payload, now(), p_run)
    on conflict (period_days) do update
      set payload = excluded.payload, generated_at = excluded.generated_at, run_id = excluded.run_id;
  end if;

  update public.feedback_digest_runs
  set status = p_status, finished_at = now()
  where id = p_run;
  return true;
end;
$$;

-- Functions are executable by PUBLIC by default; only the server may call them.
revoke all on function public.admin_digest_stats(int, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_digest_input(int) from public, anon, authenticated;
revoke all on function public.claim_feedback_digest_run(int, uuid, int) from public, anon, authenticated;
revoke all on function public.finish_feedback_digest_run(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_digest_stats(int, timestamptz) to service_role;
grant execute on function public.admin_digest_input(int) to service_role;
grant execute on function public.claim_feedback_digest_run(int, uuid, int) to service_role;
grant execute on function public.finish_feedback_digest_run(uuid, text, jsonb) to service_role;
