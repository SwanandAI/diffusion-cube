-- Per-IP rate limiting for the public /explore chat (/api/chat 'library'
-- mode) and the public browser-error endpoint (/api/errors/client) — see
-- docs/features/monitoring-logging-cleanup/. Counters live in Postgres
-- because the app runs on serverless instances that share no memory.
-- `key` is a salted SHA-256 of scope + client IP (lib/rate-limit.ts) — a raw
-- IP is never stored. Two fixed windows per key: the current minute and the
-- current day. Called only by the server through the service role. Additive
-- only.
create table if not exists public.rate_limits (
  key text not null,
  bucket text not null check (bucket in ('minute', 'day')),
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, bucket)
);

-- RLS on with no policies: browser clients can't read or reset counters.
alter table public.rate_limits enable row level security;

-- Counts this request and returns whether it is within both limits. Each
-- upsert takes the row lock, so concurrent requests for one key can't lose
-- an increment. A rejected request still counts.
create or replace function public.check_rate_limit(p_key text, p_per_min integer, p_per_day integer)
returns boolean
language plpgsql
as $$
declare
  minute_count integer;
  day_count integer;
  minute_start timestamptz := date_trunc('minute', now());
  day_start timestamptz := date_trunc('day', now());
begin
  insert into public.rate_limits as r (key, bucket, window_start, count)
  values (p_key, 'minute', minute_start, 1)
  on conflict (key, bucket) do update
    set count = case when r.window_start = excluded.window_start then r.count + 1 else 1 end,
        window_start = excluded.window_start
  returning r.count into minute_count;

  insert into public.rate_limits as r (key, bucket, window_start, count)
  values (p_key, 'day', day_start, 1)
  on conflict (key, bucket) do update
    set count = case when r.window_start = excluded.window_start then r.count + 1 else 1 end,
        window_start = excluded.window_start
  returning r.count into day_count;

  -- Keep the table small: now and then, drop keys idle for over two days.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;

  return minute_count <= p_per_min and day_count <= p_per_day;
end;
$$;

-- Functions are executable by PUBLIC by default; only the server may call it.
revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
