import { createAdminClient } from '@/lib/supabase/admin';
import { parseFrontmatter } from '@/lib/strip-frontmatter';
import { parseUnits, type ParsedUnit, type SkippedUnit } from '@/lib/pathway-units';
import { embedTexts, toPgVector } from '@/lib/embeddings';
import { logError } from '@/lib/errors';
import { stripProvenanceAppendix } from '@/lib/provenance';

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
  embedded: boolean;
}

// Makes a version live: pointer + card fields, then replaces the pathway's
// units with this version's and embeds them. If embedding fails the units
// are still saved (without vectors — search falls back to full text for
// them) and the failure is recorded; a later publish embeds them.
export async function publishVersion(input: PublishInput, admin: Admin = createAdminClient()): Promise<PublishResult> {
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
    })
    .eq('id', input.pathwayId);
  if (upErr) throw upErr;

  const { units, skipped } = parseUnits(content, pathway.slug as string);

  let vectors: (number[] | null)[] = units.map(() => null);
  let embedded = units.length === 0;
  if (units.length) {
    try {
      vectors = await embedTexts(units.map(unitEmbeddingText));
      embedded = true;
    } catch (err) {
      // embedTexts already recorded the cause; note which pathway it hit.
      logError('lib/pathway-store', err, { step: 'embed units', pathway_slug: pathway.slug });
    }
  }

  const { error: delErr } = await admin.from('pathway_units').delete().eq('pathway_id', input.pathwayId);
  if (delErr) throw delErr;

  if (units.length) {
    const { error: insErr } = await admin.from('pathway_units').insert(
      units.map((u, i) => ({
        ...u,
        pathway_id: input.pathwayId,
        version_id: version.id,
        embedding: vectors[i] ? toPgVector(vectors[i] as number[]) : null,
      }))
    );
    if (insErr) throw insErr;
  }

  return { slug: pathway.slug as string, title, indexedUnits: units.length, skippedUnits: skipped, embedded };
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

// Private bucket for seeded pathways' original files (migration 0042).
export const SOURCES_BUCKET = 'pathway-sources';

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
