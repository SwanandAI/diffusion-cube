-- One row per Claude call, for the admin Usage page (customer spec "Usage
-- logging and monitoring"; docs/features/monitoring-logging-cleanup/). Written
-- by lib/ai-usage.ts through the service-role client after each call
-- completes (or fails). Holds counts only — no prompt, message or reply text.
-- `area` groups the internal chat modes into the three product areas
-- (lib/ai-usage.ts areaFor). Cache columns let the page show what prompt
-- caching saves. Additive only.
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Null for a signed-out Explore visitor; account deletion anonymises.
  user_id uuid references auth.users (id) on delete set null,
  area text not null check (area in ('explore', 'analyse', 'contribute')),
  mode text not null,
  flow text,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cache_creation_tokens integer,
  ok boolean not null
);

create index if not exists ai_usage_created_area_idx
  on public.ai_usage (created_at desc, area);

-- RLS on with no policies: no browser client can read or write this table.
alter table public.ai_usage enable row level security;
