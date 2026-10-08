import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasRole } from '@/lib/roles';
import {
  TOOLKIT_ASSET_BUCKET,
  linkDomain,
  sanitizeAssetFileName,
  type ToolkitAssetBlockEntry,
  type ToolkitAssetSummary,
} from '@/lib/toolkit-assets';

// SERVER-ONLY. The storage + database half of toolkit assets (the pure half
// is lib/toolkit-assets.ts). Uses the service-role client deliberately:
// - the 'toolkit-assets' bucket has no client storage policies at all, so
//   every upload URL / download URL has to be minted here;
// - published assets are public by the contributor's explicit consent, and
//   /explore + the public download route serve anonymous visitors who have
//   no session for RLS to evaluate — the same reason app/explore/page.tsx
//   reads published_pathways with the admin client. Every read below filters
//   to published rows explicitly unless the caller has already authorised a
//   narrower audience (owner/admin preview, assemble).
// Never import this from a 'use client' file.

const ASSET_COLUMNS =
  'unit_internal_id, pathway_id, user_id, asset_kind, asset_name, purpose, reuse_condition, storage_path, file_name, mime_type, size_bytes, link_url, published_at, created_at';

export interface ToolkitAssetRow {
  unit_internal_id: string;
  pathway_id: string;
  user_id: string | null;
  asset_kind: 'file' | 'link';
  asset_name: string;
  purpose: string | null;
  reuse_condition: string | null;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  link_url: string | null;
  published_at: string | null;
  created_at: string;
}

// What the explorer / library prompts are given about each published asset.
export interface PublishedToolkitAsset extends ToolkitAssetSummary {
  reuseCondition: string;
}

type RowWithPathway = ToolkitAssetRow & { pathways: { slug: string; title: string } | null };

function toPublished(row: RowWithPathway): PublishedToolkitAsset {
  return {
    id: row.unit_internal_id,
    name: row.asset_name,
    purpose: row.purpose ?? '',
    reuseCondition: row.reuse_condition ?? '',
    kind: row.asset_kind,
    fileName: row.asset_kind === 'file' ? row.file_name : null,
    sizeBytes: row.asset_kind === 'file' ? row.size_bytes : null,
    linkDomain: row.asset_kind === 'link' && row.link_url ? linkDomain(row.link_url) : null,
    pathwaySlug: row.pathways?.slug ?? '',
    pathwayTitle: row.pathways?.title ?? '',
    publishedAt: row.published_at,
  };
}

export function toSummary(asset: PublishedToolkitAsset): ToolkitAssetSummary {
  return {
    id: asset.id,
    name: asset.name,
    purpose: asset.purpose,
    kind: asset.kind,
    fileName: asset.fileName,
    sizeBytes: asset.sizeBytes,
    linkDomain: asset.linkDomain,
    pathwaySlug: asset.pathwaySlug,
    pathwayTitle: asset.pathwayTitle,
    publishedAt: asset.publishedAt,
  };
}

export function toBlockEntry(row: ToolkitAssetRow): ToolkitAssetBlockEntry {
  return {
    id: row.unit_internal_id,
    name: row.asset_name,
    kind: row.asset_kind,
    fileName: row.file_name,
    linkDomain: row.link_url ? linkDomain(row.link_url) : null,
    purpose: row.purpose ?? '',
    reuseCondition: row.reuse_condition ?? '',
  };
}

// Published assets only — optionally narrowed to specific ids or one
// pathway's slug. Safe to hand to anyone (public by consent).
export async function loadPublishedToolkitAssets(
  filter: { ids?: string[]; pathwaySlug?: string } = {}
): Promise<PublishedToolkitAsset[]> {
  if (filter.ids && filter.ids.length === 0) return [];
  const admin = createAdminClient();
  let query = admin
    .from('contribution_units')
    .select(`${ASSET_COLUMNS}, pathways!inner(slug, title)`)
    .eq('unit_type', 'toolkit-asset')
    .not('published_at', 'is', null)
    .order('created_at', { ascending: true });
  if (filter.ids) query = query.in('unit_internal_id', filter.ids);
  if (filter.pathwaySlug) query = query.eq('pathways.slug', filter.pathwaySlug);

  const { data, error } = await query;
  if (error) {
    console.error('[toolkit-assets] load published failed:', error);
    return [];
  }
  return ((data ?? []) as unknown as RowWithPathway[]).map(toPublished);
}

// Every consented asset on a pathway, published or not — what assemble lists
// in the document the admin then reviews.
export async function loadPathwayToolkitAssets(pathwayId: string): Promise<ToolkitAssetRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('contribution_units')
    .select(ASSET_COLUMNS)
    .eq('unit_type', 'toolkit-asset')
    .eq('pathway_id', pathwayId)
    .eq('share_consent', true)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`toolkit assets for pathway ${pathwayId}: ${error.message}`);
  return (data ?? []) as ToolkitAssetRow[];
}

export async function loadToolkitAsset(id: string): Promise<ToolkitAssetRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('contribution_units')
    .select(ASSET_COLUMNS)
    .eq('unit_type', 'toolkit-asset')
    .eq('unit_internal_id', id)
    .maybeSingle();
  return (data as ToolkitAssetRow | null) ?? null;
}

// The real gate for every contributor-side asset route: a session, the
// pathway_contributor role, and membership of this specific pathway — the
// same checks /api/pathways/assemble makes. `supabase` is the caller's own
// session client (lib/supabase/server), never the admin client.
export async function authorizePathwayContributor(
  supabase: SupabaseClient,
  pathwayId: unknown
): Promise<{ ok: true; userId: string; pathwayId: string } | { ok: false; status: number; error: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' };
  if (!(await hasRole(supabase, 'pathway_contributor'))) {
    return { ok: false, status: 403, error: 'Contributor role required' };
  }
  if (typeof pathwayId !== 'string' || !pathwayId) return { ok: false, status: 400, error: 'pathwayId required' };
  const { data: membership } = await supabase
    .from('pathway_contributors')
    .select('user_id')
    .eq('pathway_id', pathwayId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership) return { ok: false, status: 403, error: 'Not a contributor to this pathway' };
  return { ok: true, userId: user.id, pathwayId };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export function buildAssetStoragePath(pathwayId: string, fileName: string): string {
  return `${pathwayId}/${randomUUID()}/${sanitizeAssetFileName(fileName)}`;
}

export async function createAssetUploadUrl(path: string): Promise<{ path: string; token: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(TOOLKIT_ASSET_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`signed upload url: ${error?.message ?? 'no data'}`);
  return { path: data.path, token: data.token };
}

// null when the object isn't there (never uploaded, or deleted).
export async function assetObjectSize(path: string): Promise<number | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(TOOLKIT_ASSET_BUCKET).info(path);
  if (error || !data) return null;
  return typeof data.size === 'number' ? data.size : null;
}

// Opens a server-side read stream of a stored asset file. The download
// route pipes this straight to the browser, so the storage URL (project
// host, bucket path, signed token) never leaves the server. The signed URL
// used internally lives 60 seconds. null when the object is missing.
export async function openAssetFileStream(
  path: string
): Promise<{ body: ReadableStream<Uint8Array>; size: string | null } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(TOOLKIT_ASSET_BUCKET).createSignedUrl(path, 60);
  if (error || !data) {
    console.error('[toolkit-assets] signed url failed:', error);
    return null;
  }
  const upstream = await fetch(data.signedUrl, { cache: 'no-store' });
  if (!upstream.ok || !upstream.body) {
    console.error('[toolkit-assets] storage fetch failed:', upstream.status);
    return null;
  }
  return { body: upstream.body, size: upstream.headers.get('content-length') };
}

export async function removeAssetObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const admin = createAdminClient();
  const { error } = await admin.storage.from(TOOLKIT_ASSET_BUCKET).remove(paths);
  if (error) console.error('[toolkit-assets] remove objects failed:', error);
}
