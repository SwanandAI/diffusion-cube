-- Toolkit asset files: a contributor can attach the actual reusable file (or
-- an https link) behind a Toolkit Asset, after explicitly consenting to share
-- it publicly. Each asset is one contribution_units row
-- (section='micro-innovation', unit_type='toolkit-asset',
-- unit_internal_id='asset-<uuid>'); published_at stays null until the
-- pathway whose reviewed document lists the asset is published by an admin.
-- See docs/tasks/toolkit-asset-files/plan.md.
--
-- NOT purely additive: this also drops the two client write policies on
-- contribution_units. Every write now goes through service-role route
-- handlers (app/api/toolkit-assets/*, app/api/admin/pathways/publish) — the
-- old insert/update policies let a user set published_at on their own rows,
-- i.e. self-publish. Nothing in the app wrote this table through them.

alter table public.contribution_units
  add column if not exists asset_kind text check (asset_kind in ('file', 'link')),
  add column if not exists asset_name text,
  add column if not exists purpose text,
  add column if not exists reuse_condition text,
  -- Object path inside the private 'toolkit-assets' bucket:
  -- <pathway_id>/<uuid>/<sanitised file name>. Built server-side only.
  add column if not exists storage_path text,
  add column if not exists file_name text,
  add column if not exists mime_type text,
  add column if not exists size_bytes bigint,
  add column if not exists link_url text check (link_url is null or link_url ~ '^https://'),
  -- The contributor's explicit "OK to share this publicly?" answer. Rows are
  -- only ever created after a Yes, so this is always true for an asset row.
  add column if not exists share_consent boolean not null default false,
  add column if not exists share_consented_at timestamptz;

alter table public.contribution_units
  drop constraint if exists contribution_units_toolkit_asset_shape;
alter table public.contribution_units
  add constraint contribution_units_toolkit_asset_shape check (
    unit_type <> 'toolkit-asset'
    or (
      section = 'micro-innovation'
      and asset_name is not null
      and share_consent
      and share_consented_at is not null
      and (
        (asset_kind = 'file' and storage_path is not null and file_name is not null)
        or (asset_kind = 'link' and link_url is not null)
      )
    )
  );

create index if not exists contribution_units_toolkit_assets_idx
  on public.contribution_units (pathway_id, published_at)
  where unit_type = 'toolkit-asset';

drop policy if exists "Contributors can insert their own units" on public.contribution_units;
drop policy if exists "Contributors can only update their own units" on public.contribution_units;

-- Private bucket for the files. No storage.objects policies are created, so
-- no client (anon or authenticated) can read or write it directly: uploads
-- use service-role-issued signed upload URLs, downloads use short-lived
-- signed URLs minted by app/api/toolkit-assets/[id]/download. Size and type
-- limits are enforced here by Supabase itself, not just by the app. No ZIP.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'toolkit-assets',
  'toolkit-assets',
  false,
  26214400, -- 25 MB
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain',
    'text/markdown',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
