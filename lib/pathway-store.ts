import { createHash, randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseFrontmatter } from '@/lib/strip-frontmatter';
import { parseUnits, type ParsedUnit, type SkippedUnit } from '@/lib/pathway-units';
import { embedTexts, toPgVector } from '@/lib/embeddings';
import { logError } from '@/lib/errors';
import { stripProvenanceAppendix } from '@/lib/provenance';
import { documentChunks } from '@/lib/text-chunks';
import { sanitizeAssetFileName } from '@/lib/toolkit-assets';
import { MAX_SOURCE_FILE_BYTES, MAX_SOURCE_TEXT_CHARS, SOURCES_BUCKET } from '@/lib/pathway-sources';

// The one place pathways are saved, published and read
// (docs/features/pathway-storage/, PS-04). Pathways live only in Supabase:
// pathway_versions holds every document sent for review (or seeded), and
// publishing points pathways.published_version_id at one of them and
// re-indexes its micro-innovation units (pathway_units) for search.
// published_pathways is a view over that (migration 0042).
//
// Everything here runs with the service role. Callers check who may call.

type Admin = ReturnType<typeof createAdminClient>;

// ── Writes ────────────────────────────────────────────────────────────────

export interface SaveVersionInput {
  pathwayId: string;
  content: string;
  source: 'contributor' | 'seed';
  designDocumentId?: string | null;
  createdBy?: string | null;
  changeNote?: string;
}

export interface SavedVersion {
  id: string;
  version_number: number;
}

// Appends the next version. Two saves racing for the same number hit the
// (pathway_id, version_number) unique key and the loser throws — a version
// number is never written twice.
export async function saveVersion(input: SaveVersionInput, admin: Admin = createAdminClient()): Promise<SavedVersion> {
  const { data: last, error: lastErr } = await admin
    .from('pathway_versions')
    .select('version_number')
    .eq('pathway_id', input.pathwayId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastErr) throw lastErr;

  const { data, error } = await admin
    .from('pathway_versions')
    .insert({
      pathway_id: input.pathwayId,
      version_number: ((last?.version_number as number | undefined) ?? 0) + 1,
      content: input.content,
      source: input.source,
      design_document_id: input.designDocumentId ?? null,
      created_by: input.createdBy ?? null,
      change_note: input.changeNote ?? '',
    })
    .select('id, version_number')
    .single();
  if (error) throw error;
  if (!data) throw new Error('pathway_versions insert returned no row');

  // A draft becomes "in review". A pathway that is already live stays
  // 'published' while its next version waits — it must not vanish from the
  // library (pathways.review_requested marks the waiting version).
  if (input.source === 'contributor') {
    const { error: statusErr } = await admin
      .from('pathways')
      .update({ status: 'in_review' })
      .eq('id', input.pathwayId)
      .eq('status', 'draft');
    if (statusErr) throw statusErr;
  }
  return data as SavedVersion;
}

export async function latestVersion(pathwayId: string, admin: Admin = createAdminClient()): Promise<{ id: string; content: string; version_number: number } | null> {
  const { data, error } = await admin
    .from('pathway_versions')
    .select('id, content, version_number')
    .eq('pathway_id', pathwayId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string; content: string; version_number: number } | null) ?? null;
}

// What a unit's vector is computed from: its title, conditions, the questions
// it answers and its own text. gte-small reads ~512 tokens, so keep it short.
export function unitEmbeddingText(unit: Pick<ParsedUnit, 'title' | 'applies_when' | 'fails_when' | 'adopter_intents' | 'body'>): string {
  return [
    unit.title,
    unit.applies_when && `Applies when: ${unit.applies_when}`,
    unit.fails_when && `Fails when: ${unit.fails_when}`,
    unit.adopter_intents.length ? `Answers: ${unit.adopter_intents.join(' / ')}` : '',
    unit.body,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 1600);
}

function frontmatterLine(markdown: string, key: string): string {
  const fm = markdown.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  return fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? '';
}

export interface PublishInput {
  pathwayId: string;
  versionId: string;
  publishedBy?: string | null;
}

export interface PublishResult {
  slug: string;
  title: string;
  indexedUnits: number;
  skippedUnits: SkippedUnit[];
  // Whether the units and the document were embedded. null when indexing
  // runs in the background after the response (index: 'background').
  embedded: boolean | null;
}

export interface PublishOptions {
  // 'now' (default): embed before returning — the seed script.
  // 'background': return once the version is live and embed after the
  // response is sent — the admin publish route, so a long document never
  // holds the admin's request open.
  index?: 'now' | 'background';
  retryDelayMs?: number;
}

// Makes a version live: pointer + card fields, then replaces the pathway's
// units with this version's (saved without vectors, so keyword search works
// at once) and indexes it — indexPublishedVersion embeds the units and the
// whole document, retrying on failure, and records the outcome in
// pathways.index_status.
export async function publishVersion(
  input: PublishInput,
  admin: Admin = createAdminClient(),
  options: PublishOptions = {}
): Promise<PublishResult> {
  const { data: version, error: vErr } = await admin
    .from('pathway_versions')
    .select('id, pathway_id, content')
    .eq('id', input.versionId)
    .maybeSingle();
  if (vErr) throw vErr;
  if (!version || version.pathway_id !== input.pathwayId) throw new Error('Version not found for this pathway.');

  const { data: pathway, error: pErr } = await admin
    .from('pathways')
    .select('id, slug, title, sector, description, first_published_at')
    .eq('id', input.pathwayId)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!pathway) throw new Error('Pathway not found.');

  const content = version.content as string;
  const fm = parseFrontmatter(content) ?? {};
  const title = fm.title || (pathway.title as string);

  const { error: upErr } = await admin
    .from('pathways')
    .update({
      status: 'published',
      published_version_id: version.id,
      title,
      description: fm.description || (pathway.description as string) || '',
      sector: fm.sector || (pathway.sector as string) || '',
      stage: fm.stage || '',
      location: fm.location || '',
      tags: fm.tags ?? [],
      organisation: frontmatterLine(content, 'contributor'),
      published_by: input.publishedBy ?? null,
      first_published_at: (pathway.first_published_at as string | null) ?? new Date().toISOString(),
      index_status: 'pending',
      index_error: null,
    })
    .eq('id', input.pathwayId);
  if (upErr) throw upErr;

  const { units, skipped } = parseUnits(content, pathway.slug as string);

  const { error: delErr } = await admin.from('pathway_units').delete().eq('pathway_id', input.pathwayId);
  if (delErr) throw delErr;

  if (units.length) {
    const { error: insErr } = await admin.from('pathway_units').insert(
      units.map((u) => ({ ...u, pathway_id: input.pathwayId, version_id: version.id, embedding: null }))
    );
    if (insErr) throw insErr;
  }

  const base = { slug: pathway.slug as string, title, indexedUnits: units.length, skippedUnits: skipped };
  const job = { pathwayId: input.pathwayId, versionId: version.id as string };
  const indexOpts = { retryDelayMs: options.retryDelayMs };

  if (options.index === 'background') {
    runAfterResponse(() => indexPublishedVersion(job, admin, indexOpts));
    return { ...base, embedded: null };
  }
  const indexed = await indexPublishedVersion(job, admin, indexOpts);
  return { ...base, embedded: indexed.ok };
}

// ── Indexing (embeddings) ──────────────────────────────────────────────────

// The first try plus two retries. Each embed call already retries a busy
// Edge Function twice (lib/embeddings.ts); this retries the whole job —
// a dropped connection, a database error, the function being down for a
// few seconds — and resumes where the last try stopped (units that already
// have a vector are skipped).
export const INDEX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 3000;

export interface IndexResult {
  ok: boolean;
  attempts: number;
  units: number; // units embedded by this run
  docChunks: number; // document passages embedded by this run
  superseded?: boolean; // a newer version was published meanwhile; nothing written
  error?: string;
}

// Runs fn after the response has been sent (Next's after()), or straight
// away, unawaited, outside a request (scripts, tests). Never throws.
function runAfterResponse(fn: () => Promise<unknown>): void {
  const run = () => fn().catch((err) => logError('lib/pathway-store', err, { step: 'background index' }));
  try {
    after(run);
  } catch {
    void run();
  }
}

class Superseded extends Error {}

// Embeds a published version: its units (unitEmbeddingText) and its whole
// adopter-facing document, cut by section (pathway_doc_chunks). Records
// 'indexed' or 'failed' in pathways.index_status — only while this version
// is still the live one, so a slow job never overwrites a newer publish.
export async function indexPublishedVersion(
  input: { pathwayId: string; versionId: string },
  admin: Admin = createAdminClient(),
  options: { attempts?: number; retryDelayMs?: number } = {}
): Promise<IndexResult> {
  const attempts = Math.max(1, options.attempts ?? INDEX_ATTEMPTS);
  const delay = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  let units = 0;
  let docChunks = 0;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1 && delay > 0) await new Promise((r) => setTimeout(r, delay * (attempt - 1)));
    try {
      const run = await indexOnce(input, admin);
      units += run.units;
      docChunks = run.docChunks;
      await setIndexStatus(input, admin, { index_status: 'indexed', indexed_at: new Date().toISOString(), index_error: null });
      return { ok: true, attempts: attempt, units, docChunks };
    } catch (err) {
      if (err instanceof Superseded) return { ok: true, attempts: attempt, units, docChunks, superseded: true };
      lastError = err;
      logError('lib/pathway-store', err, { step: 'index', attempt, pathway_id: input.pathwayId });
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error');
  try {
    await setIndexStatus(input, admin, { index_status: 'failed', index_error: message.slice(0, 500) });
  } catch (err) {
    logError('lib/pathway-store', err, { step: 'record index failure', pathway_id: input.pathwayId });
  }
  return { ok: false, attempts, units, docChunks, error: message };
}

async function setIndexStatus(
  input: { pathwayId: string; versionId: string },
  admin: Admin,
  fields: Record<string, unknown>
): Promise<void> {
  const { error } = await admin
    .from('pathways')
    .update(fields)
    .eq('id', input.pathwayId)
    .eq('published_version_id', input.versionId);
  if (error) throw error;
}

// Throws Superseded once another version has been published. Checked before
// the job starts and again after each slow embedding step, right before the
// writes it guards.
async function assertStillLive(input: { pathwayId: string; versionId: string }, admin: Admin): Promise<void> {
  const { data: pathway, error: pErr } = await admin
    .from('pathways')
    .select('published_version_id')
    .eq('id', input.pathwayId)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!pathway || pathway.published_version_id !== input.versionId) throw new Superseded();
}

async function indexOnce(
  input: { pathwayId: string; versionId: string },
  admin: Admin
): Promise<{ units: number; docChunks: number }> {
  await assertStillLive(input, admin);

  // 1. Units still without a vector (all of them on the first try).
  const { data: pending, error: uErr } = await admin
    .from('pathway_units')
    .select('id, title, applies_when, fails_when, adopter_intents, body')
    .eq('pathway_id', input.pathwayId)
    .eq('version_id', input.versionId)
    .is('embedding', null);
  if (uErr) throw uErr;
  const rows = (pending ?? []) as (Pick<ParsedUnit, 'title' | 'applies_when' | 'fails_when' | 'adopter_intents' | 'body'> & { id: string })[];
  if (rows.length) {
    const vectors = await embedTexts(rows.map((r) => unitEmbeddingText({ ...r, adopter_intents: r.adopter_intents ?? [] })));
    // Scoped to this version: unit ids (<slug>-uNN) repeat across versions,
    // so a newer publish's rows can carry the same id by now.
    for (let i = 0; i < rows.length; i++) {
      const { error } = await admin
        .from('pathway_units')
        .update({ embedding: toPgVector(vectors[i]) })
        .eq('id', rows[i].id)
        .eq('version_id', input.versionId);
      if (error) throw error;
    }
  }

  // 2. The whole document, by section.
  const { data: version, error: vErr } = await admin
    .from('pathway_versions')
    .select('content')
    .eq('id', input.versionId)
    .maybeSingle();
  if (vErr) throw vErr;
  const chunks = documentChunks((version?.content as string | undefined) ?? '');
  const vectors = chunks.length ? await embedTexts(chunks.map((c) => c.text)) : [];

  // The replace below is pathway-wide: never let a superseded job wipe the
  // newer version's passages.
  await assertStillLive(input, admin);
  const { error: delErr } = await admin.from('pathway_doc_chunks').delete().eq('pathway_id', input.pathwayId);
  if (delErr) throw delErr;
  if (chunks.length) {
    const { error: insErr } = await admin.from('pathway_doc_chunks').insert(
      chunks.map((c, i) => ({
        pathway_id: input.pathwayId,
        version_id: input.versionId,
        section: c.section,
        chunk_index: c.chunk_index,
        text: c.text,
        embedding: toPgVector(vectors[i]),
      }))
    );
    if (insErr) throw insErr;
  }
  return { units: rows.length, docChunks: chunks.length };
}

// ── Reads (published only) ────────────────────────────────────────────────

export interface PublishedCard {
  slug: string;
  title: string;
  description: string;
  category: string;
  sector: string;
  stage: string;
  location: string;
  tags: string[];
  contributor_org: string | null;
  created_at: string;
}

export async function listPublished(admin: Admin = createAdminClient()): Promise<PublishedCard[]> {
  const { data, error } = await admin
    .from('published_pathways')
    .select('slug, title, description, category, sector, stage, location, tags, contributor_org, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as PublishedCard[]).map((r) => ({
    ...r,
    description: r.description ?? '',
    sector: r.sector ?? '',
    stage: r.stage ?? '',
    location: r.location ?? '',
    tags: r.tags ?? [],
  }));
}

export interface PublishedDocument {
  slug: string;
  title: string;
  // The full document, Source Trace included — strip it before any
  // adopter-facing use (adopterDocument below).
  content: string;
  contributor_org: string | null;
  created_at: string;
}

export async function getPublishedDocuments(slugs: string[], admin: Admin = createAdminClient()): Promise<PublishedDocument[]> {
  if (slugs.length === 0) return [];
  const { data, error } = await admin
    .from('published_pathways')
    .select('slug, title, content, contributor_org, created_at')
    .in('slug', slugs);
  if (error) throw error;
  return (data ?? []) as PublishedDocument[];
}

export async function getPublishedDocument(slug: string, admin: Admin = createAdminClient()): Promise<PublishedDocument | null> {
  const [doc] = await getPublishedDocuments([slug], admin);
  return doc ?? null;
}

// The document as adopters may see it: Source Trace removed.
export function adopterDocument(doc: Pick<PublishedDocument, 'content'>): string {
  return stripProvenanceAppendix(doc.content);
}

function overviewEntry(row: PublishedCard): string {
  const lines = [`[${row.slug}]`, `title: ${row.title}`];
  if (row.description) lines.push(`description: ${row.description}`);
  if (row.sector) lines.push(`sector: ${row.sector}`);
  if (row.stage) lines.push(`stage: ${row.stage}`);
  if (row.location) lines.push(`location: ${row.location}`);
  if (row.tags.length) lines.push(`tags: [${row.tags.join(', ')}]`);
  return lines.join('\n');
}

// Every published pathway's card fields, one block each, for the library's
// general (no pathway open) prompt. `count` is stated in the prompt so the
// model never counts the list itself.
export async function buildOverview(admin: Admin = createAdminClient()): Promise<{ overview: string; count: number }> {
  const rows = await listPublished(admin);
  return { overview: rows.map(overviewEntry).join('\n\n'), count: rows.length };
}

// Any pathway row with this slug, whatever its status, blocks reuse.
export async function isSlugTaken(slug: string, admin: Admin = createAdminClient()): Promise<boolean> {
  const { data, error } = await admin.from('pathways').select('id').eq('slug', slug).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

// ── Original documents (seeded pathways) ──────────────────────────────────

// Bucket name and limits: lib/pathway-sources.ts (shared with the browser).
export { SOURCES_BUCKET, MAX_SOURCE_FILE_BYTES, MAX_SOURCE_TEXT_CHARS };

// Where a contributor's upload is stored: under its pathway, with a random
// part so two files of the same name never collide.
export function contributorSourcePath(pathwayId: string, fileName: string): string {
  return `contrib/${pathwayId}/${randomUUID()}-${sanitizeAssetFileName(fileName)}`;
}

export function isContributorSourcePath(pathwayId: string, path: unknown): path is string {
  return typeof path === 'string' && path.startsWith(`contrib/${pathwayId}/`) && !path.includes('..');
}

export interface SaveSourceInput {
  pathwayId: string;
  designId: string;
  uploadedBy: string;
  fileName: string;
  mimeType: string | null;
  storagePath: string | null;
  text: string;
}

export interface SavedSource {
  id: string;
  sourceKey: string;
  duplicate: boolean; // the same text was already saved for this pathway
  storagePath: string | null; // the kept row's file (the existing one's, for a duplicate)
}

function nextSourceKey(keys: string[]): string {
  const max = keys.reduce((m, k) => Math.max(m, Number(k.match(/^src-(\d+)$/)?.[1] ?? 0)), 0);
  return `src-${String(max + 1).padStart(2, '0')}`;
}

// Keeps one document a contributor sent in their workspace: every upload is
// kept, with no per-file choice, as is_public — once the pathway is
// published, lib/retrieval.ts may read its text to answer an adopter's
// question the write-up doesn't cover. Never embedded. The same text sent
// twice is kept once. Two saves racing for the next src-NN key retry.
export async function saveContributorSource(input: SaveSourceInput, admin: Admin = createAdminClient()): Promise<SavedSource> {
  const text = input.text.slice(0, MAX_SOURCE_TEXT_CHARS);
  const hash = text.trim() ? createHash('sha256').update(text).digest('hex') : null;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (hash) {
      const { data: dup, error: dupErr } = await admin
        .from('pathway_sources')
        .select('id, source_key, storage_path')
        .eq('pathway_id', input.pathwayId)
        .eq('origin', 'contributor')
        .eq('content_hash', hash)
        .maybeSingle();
      if (dupErr) throw dupErr;
      if (dup) {
        return {
          id: dup.id as string,
          sourceKey: dup.source_key as string,
          duplicate: true,
          storagePath: (dup.storage_path as string | null) ?? null,
        };
      }
    }

    const { data: existing, error: keysErr } = await admin
      .from('pathway_sources')
      .select('source_key')
      .eq('pathway_id', input.pathwayId);
    if (keysErr) throw keysErr;
    const sourceKey = nextSourceKey(((existing ?? []) as { source_key: string }[]).map((r) => r.source_key));

    const { data, error } = await admin
      .from('pathway_sources')
      .insert({
        pathway_id: input.pathwayId,
        source_key: sourceKey,
        file_name: input.fileName.slice(0, 255),
        storage_path: input.storagePath,
        mime_type: input.mimeType,
        extracted_text: text,
        is_public: true,
        origin: 'contributor',
        design_id: input.designId,
        uploaded_by: input.uploadedBy,
        content_hash: hash,
      })
      .select('id')
      .single();
    if (!error && data) return { id: data.id as string, sourceKey, duplicate: false, storagePath: input.storagePath };
    // 23505: another save took this key (or saved the same text) first.
    if (error?.code !== '23505') throw error ?? new Error('pathway_sources insert returned no row');
  }
  throw new Error('Could not save the document after 3 attempts.');
}

export interface SourceText {
  id: string;
  file_name: string;
  text: string;
}

// The public originals of one published pathway, with their text, in upload
// order — what lib/retrieval.ts reads when the write-up doesn't answer.
export async function publicSourceTexts(slug: string, admin: Admin = createAdminClient()): Promise<SourceText[]> {
  const { data: pathway, error: pErr } = await admin
    .from('pathways')
    .select('id')
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle();
  if (pErr) throw pErr;
  if (!pathway) return [];
  const { data, error } = await admin
    .from('pathway_sources')
    .select('id, file_name, extracted_text, is_public')
    .eq('pathway_id', pathway.id)
    .eq('is_public', true)
    .order('source_key', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as { id: string; file_name: string; extracted_text: string | null; is_public: boolean }[])
    .filter((r) => r.is_public === true && (r.extracted_text ?? '').trim() !== '')
    .map((r) => ({ id: r.id, file_name: r.file_name, text: r.extracted_text as string }));
}

// Removes a pathway's original files from storage before the pathway row is
// deleted (its pathway_sources / chunks rows cascade away with it). Best
// effort: a storage failure is logged and never blocks the delete.
export async function removeSourceObjects(pathwayId: string, admin: Admin = createAdminClient()): Promise<void> {
  try {
    const { data, error } = await admin
      .from('pathway_sources')
      .select('storage_path')
      .eq('pathway_id', pathwayId)
      .not('storage_path', 'is', null);
    if (error) throw error;
    const paths = (data ?? []).map((r) => r.storage_path as string).filter(Boolean);
    if (paths.length === 0) return;
    const { error: rmErr } = await admin.storage.from(SOURCES_BUCKET).remove(paths);
    if (rmErr) throw rmErr;
  } catch (err) {
    logError('lib/pathway-store', err, { step: 'remove source files', pathway_id: pathwayId });
  }
}
