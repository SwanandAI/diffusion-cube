import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import { embedTexts, toPgVector } from '@/lib/embeddings';
import { adopterDocument, getPublishedDocuments, listPublished, type PublishedCard } from '@/lib/pathway-store';
import { recordAiUsage } from '@/lib/ai-usage';
import { logError } from '@/lib/errors';
import { datedLine } from '@/lib/wiki-loader';
import { DIMENSIONS, STAGES, UNIT_TYPES, type DimensionCode, type Stage, type UnitType } from '@/lib/dimensions';

// Grounding for Explore and Analyse (docs/features/pathway-storage/, PS-07).
// Instead of handing the model every pathway, each message is grounded on
// what its question needs:
//
//   1. Claude Haiku works out the kind of question (forced tool use, thinking
//      off) — about one pathway (UC1), the person's own situation, across
//      pathways (UC2) or common patterns (UC3) — plus any named pathway and
//      dimension / stage / unit-type filters, and a search text.
//   2. Hybrid search (match_pathway_units: vector + full text + labels).
//   3. The results are shaped per kind. Pattern counts are computed here, in
//      code, never left to the model.
//
// Nothing here throws on a classifier or embedding failure: a failed
// classification falls back to the surface's default kind, and a failed
// embedding searches by full text and labels alone. A database error does
// throw — the route's withErrorHandling answers it.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
export const CLASSIFIER_MODEL = 'claude-haiku-5-5';

export const QUERY_KINDS = ['specific', 'situation', 'broad', 'patterns'] as const;
export type QueryKind = (typeof QUERY_KINDS)[number];

// Where the grounding is for. 'explore-pathway' is the library chat with one
// pathway open (always UC1 on that pathway, no classifier call); 'document'
// is an Analysis Document / Executive Summary (always the user's situation).
export type Surface = 'analyse' | 'contribute' | 'explore-pathway' | 'explore-overview' | 'document';

// Starting limits (architecture Q7), tuned with the test set.
export const LIMITS = {
  specific: { documents: 2, passages: 5 },
  situation: { pathways: 3, documents: 2, units: 30 },
  broad: { pathways: 8, units: 30 },
  patterns: { units: 40 },
} as const;

const SELECTION_TURNS = 6;
const SELECTION_TURN_CHARS = 2000;

export interface Classification {
  kind: QueryKind;
  slugs: string[];
  dimension?: DimensionCode;
  stage?: Stage;
  unitTypes?: UnitType[];
  searchText: string;
  fromModel: boolean;
}

export interface UnitHit {
  id: string;
  pathway_id: string;
  slug: string;
  pathway_title: string;
  sector: string | null;
  unit_number: number;
  title: string;
  unit_type: string;
  dimension: string;
  sub_category: string;
  stage: string;
  applies_when: string;
  fails_when: string;
  body: string;
  score: number;
}

export interface Passage {
  source_key: string;
  file_name: string;
  chunk_index: number;
  text: string;
  is_public: boolean;
}

type ChatMessage = { role: string; content: unknown };

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && (b as { type?: string }).type === 'text' ? (b as { text: string }).text : ''))
      .join('\n');
  }
  return '';
}

export function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return textOf(messages[i].content).trim();
  }
  return '';
}

export function defaultClassification(surface: Surface, messages: ChatMessage[], openSlug?: string | null): Classification {
  const searchText = lastUserText(messages);
  if (surface === 'explore-pathway' && openSlug) return { kind: 'specific', slugs: [openSlug], searchText, fromModel: false };
  if (surface === 'explore-overview') return { kind: 'broad', slugs: [], searchText, fromModel: false };
  return { kind: 'situation', slugs: [], searchText, fromModel: false };
}

// ── 1. Classify ───────────────────────────────────────────────────────────

function classifyTool(slugs: string[]): Anthropic.Tool {
  return {
    name: 'route_question',
    description: 'Report what kind of question the latest user message is, and what to search the pathway corpus for.',
    input_schema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [...QUERY_KINDS],
          description:
            "specific = about one or two named pathways; situation = about the user's own adoption; broad = what several deployments did about a topic; patterns = what usually happens / common lessons across pathways.",
        },
        pathway_slugs: {
          type: 'array',
          items: { type: 'string', enum: slugs.length ? slugs : ['none'] },
          description: 'Slugs of pathways the question names or clearly means. Empty unless kind is specific.',
        },
        dimension: { type: ['string', 'null'], enum: [...DIMENSIONS.map((d) => d.code), null] },
        stage: { type: ['string', 'null'], enum: [...STAGES, null] },
        unit_types: { type: 'array', items: { type: 'string', enum: [...UNIT_TYPES] } },
        search_text: {
          type: 'string',
          description: 'The question restated as a short, self-contained search query (resolve pronouns from earlier turns).',
        },
      },
      required: ['kind', 'pathway_slugs', 'search_text'],
    },
  };
}

function classifierPrompt(messages: ChatMessage[], published: PublishedCard[], openSlug?: string | null): string {
  const turns = messages
    .slice(-SELECTION_TURNS)
    .map((m) => `${m.role.toUpperCase()}: ${textOf(m.content).slice(0, SELECTION_TURN_CHARS)}`)
    .join('\n\n');
  const list = published.map((p) => `- ${p.slug}: ${p.title}${p.sector ? ` (${p.sector})` : ''}`).join('\n');
  return [
    'Route the LATEST user message below. Only set a dimension, stage or unit types when the message clearly asks about one.',
    '',
    'Dimensions: persona (users, their problem and trust), solution (the AI system, data, UX, scale), institution (ownership, governance, workforce, data stewardship, operating model), ecosystem (partners, external dependencies, distribution, procurement).',
    'Stages: Explore, Define, Pilot, Scale. Unit types: Strategic Decision, Tactical Decision, Failure and Fix (what went wrong), Playbook, Toolkit Asset.',
    openSlug ? `\nThe user is looking at the pathway "${openSlug}".` : '',
    '\nPublished pathways:',
    list || '(none)',
    '\nConversation (most recent last):',
    turns,
  ].join('\n');
}

export async function classifyQuery(opts: {
  messages: ChatMessage[];
  surface: Surface;
  published: PublishedCard[];
  openSlug?: string | null;
  flow?: string | null;
}): Promise<Classification> {
  const fallback = defaultClassification(opts.surface, opts.messages, opts.openSlug);
  // No classifier call where the kind is already known: an open pathway is
  // UC1, a document is the user's situation, and the contributor's chat only
  // uses the corpus as a style reference (its situation is enough).
  if (opts.surface === 'explore-pathway' || opts.surface === 'document' || opts.surface === 'contribute') return fallback;
  if (!fallback.searchText) return fallback;

  const slugs = opts.published.map((p) => p.slug);
  const usageFlow = opts.surface === 'explore-overview' ? 'explore' : opts.flow ?? null;
  try {
    const result = await anthropic.messages.create({
      model: CLASSIFIER_MODEL,
      max_tokens: 300,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      tools: [classifyTool(slugs)],
      tool_choice: { type: 'tool', name: 'route_question' },
      messages: [{ role: 'user', content: classifierPrompt(opts.messages, opts.published, opts.openSlug) }],
    });
    recordAiUsage({ mode: 'retrieval-classify', flow: usageFlow, model: result.model, usage: result.usage, ok: true });

    const tool = result.content.find((b) => b.type === 'tool_use');
    if (!tool || tool.type !== 'tool_use') return fallback;
    const input = tool.input as Record<string, unknown>;

    const kind = QUERY_KINDS.find((k) => k === input.kind);
    if (!kind) return fallback;
    const known = new Set(slugs);
    const named = Array.isArray(input.pathway_slugs)
      ? input.pathway_slugs.filter((s): s is string => typeof s === 'string' && known.has(s))
      : [];
    const dimension = DIMENSIONS.find((d) => d.code === input.dimension)?.code;
    const stage = STAGES.find((s) => s === input.stage);
    const unitTypes = Array.isArray(input.unit_types)
      ? input.unit_types.filter((t): t is UnitType => (UNIT_TYPES as readonly string[]).includes(t as string))
      : [];
    const searchText = typeof input.search_text === 'string' && input.search_text.trim() ? input.search_text.trim() : fallback.searchText;

    // "specific" with no pathway we know of is really a broad question.
    const finalKind: QueryKind = kind === 'specific' && named.length === 0 ? (opts.openSlug ? 'specific' : 'broad') : kind;
    return {
      kind: finalKind,
      slugs: finalKind === 'specific' ? (named.length ? named : opts.openSlug ? [opts.openSlug] : []) : named,
      ...(dimension ? { dimension } : {}),
      ...(stage ? { stage } : {}),
      ...(unitTypes.length ? { unitTypes } : {}),
      searchText,
      fromModel: true,
    };
  } catch (err) {
    recordAiUsage({ mode: 'retrieval-classify', flow: usageFlow, model: CLASSIFIER_MODEL, ok: false });
    logError('lib/retrieval', err, { step: 'classify' });
    return fallback;
  }
}

// ── 2. Search ─────────────────────────────────────────────────────────────

async function queryVector(searchText: string): Promise<string | null> {
  if (!searchText) return null;
  try {
    const [v] = await embedTexts([searchText]);
    return v ? toPgVector(v) : null;
  } catch {
    // embedTexts logged it; search by full text + labels alone.
    return null;
  }
}

export async function hybridSearch(opts: {
  searchText: string;
  vector?: string | null;
  slugs?: string[];
  dimension?: DimensionCode;
  stage?: Stage;
  unitTypes?: UnitType[];
  count: number;
}): Promise<UnitHit[]> {
  const vector = opts.vector !== undefined ? opts.vector : await queryVector(opts.searchText);
  const { data, error } = await createAdminClient().rpc('match_pathway_units', {
    query_embedding: vector,
    query_text: opts.searchText || null,
    filter_slugs: opts.slugs?.length ? opts.slugs : null,
    filter_dimension: opts.dimension ?? null,
    filter_stage: opts.stage ?? null,
    filter_types: opts.unitTypes?.length ? opts.unitTypes : null,
    match_count: opts.count,
  });
  if (error) throw error;
  return (data ?? []) as UnitHit[];
}

async function sourcePassages(slug: string, vector: string | null, count: number): Promise<Passage[]> {
  if (!vector) return [];
  const { data, error } = await createAdminClient().rpc('match_source_chunks', {
    query_embedding: vector,
    pathway_slug: slug,
    match_count: count,
  });
  if (error) throw error;
  // The RPC returns public sources only; checked again here so a
  // contributor-only passage can never reach an adopter.
  return ((data ?? []) as Passage[]).filter((p) => p.is_public === true);
}

// The public source-document passages of one published pathway nearest to
// the question, formatted for a prompt — '' when it has none (contributor
// pathways never do; seeded ones only for documents marked public).
export async function pathwayPassages(slug: string, searchText: string): Promise<string> {
  if (!searchText) return '';
  const vector = await queryVector(searchText);
  const passages = await sourcePassages(slug, vector, LIMITS.specific.passages);
  return passages.map((p) => `### Source document: ${p.file_name}\n${p.text}`).join('\n\n');
}

// ── 3. Shape ──────────────────────────────────────────────────────────────

export interface PatternGroup {
  key: string;
  dimension: string;
  sub_category: string;
  stage: string;
  unit_type: string;
  pathways: string[]; // distinct slugs
  units: UnitHit[];
}

// Groups units that share a dimension, sub-category, stage and type. A group
// is a pattern only when units from 2+ distinct pathways fall in it — the
// count is computed here and stated in the grounding, never estimated.
export function groupPatterns(units: UnitHit[]): PatternGroup[] {
  const groups = new Map<string, PatternGroup>();
  for (const u of units) {
    const key = `${u.dimension}|${u.sub_category}|${u.stage}|${u.unit_type}`;
    const g = groups.get(key) ?? {
      key, dimension: u.dimension, sub_category: u.sub_category, stage: u.stage, unit_type: u.unit_type, pathways: [], units: [],
    };
    if (!g.pathways.includes(u.slug)) g.pathways.push(u.slug);
    g.units.push(u);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.pathways.length - a.pathways.length || b.units.length - a.units.length);
}

function subCategoryName(id: string): string {
  const [dim, code] = id.split('-');
  return DIMENSIONS.find((d) => d.code === dim)?.subCategories.find((s) => s.code === code)?.name ?? id;
}

function unitBlock(u: UnitHit): string {
  return `#### From "${u.pathway_title}" (${u.slug}), Unit ${u.unit_number}\n${u.body}`;
}

function documentBlock(doc: { slug: string; content: string; contributor_org: string | null; created_at: string }): string {
  const contributor = doc.contributor_org ? `Contributed by: ${doc.contributor_org}\n\n` : '';
  return `# Pathway: ${doc.slug}\n\n${contributor}${datedLine(doc.content, doc.created_at)}${adopterDocument(doc)}`;
}

const NOTHING = 'No published pathway documents anything that matches this question. Say so plainly; do not fill the gap with general knowledge.';

export interface Grounding {
  kind: QueryKind;
  text: string;
  slugs: string[]; // pathways the grounding drew on
}

export async function buildGrounding(opts: {
  surface: Surface;
  messages: ChatMessage[];
  openSlug?: string | null;
  sector?: string | null;
  situationText?: string; // documents: what to search for instead of the last message
  flow?: string | null;
}): Promise<Grounding> {
  const published = await listPublished();
  if (published.length === 0) {
    return { kind: 'broad', text: 'No pathways are published yet. Say so plainly if the user asks about other deployments.', slugs: [] };
  }

  const cls = await classifyQuery({ messages: opts.messages, surface: opts.surface, published, openSlug: opts.openSlug, flow: opts.flow });
  const searchText = (opts.situationText && opts.surface === 'document' ? opts.situationText : cls.searchText) || '';
  const filters = { dimension: cls.dimension, stage: cls.stage, unitTypes: cls.unitTypes };

  if (cls.kind === 'specific') {
    const slugs = cls.slugs.slice(0, LIMITS.specific.documents);
    const docs = await getPublishedDocuments(slugs);
    if (docs.length === 0) return { kind: 'specific', text: NOTHING, slugs: [] };
    const parts = docs.map(documentBlock);
    // Source passages only for one pathway, and only when it has public
    // originals (seeded pathways) — the fallback for what the write-up lacks.
    if (docs.length === 1 && searchText) {
      const passages = await pathwayPassages(docs[0].slug, searchText);
      if (passages) {
        parts.push(
          `## Passages from "${docs[0].title}"'s source documents\n\nUse these ONLY if the write-up above doesn't answer the question, and say the answer comes from the source document, naming the file.\n\n${passages}`
        );
      }
    }
    return { kind: 'specific', text: parts.join('\n\n---\n\n'), slugs: docs.map((d) => d.slug) };
  }

  if (cls.kind === 'situation') {
    const sector = (opts.sector ?? '').trim().toLowerCase();
    const sectorSlugs = sector
      ? published.filter((p) => p.sector && (p.sector.toLowerCase().includes(sector) || sector.includes(p.sector.toLowerCase()))).map((p) => p.slug)
      : [];
    const units = await hybridSearch({ searchText, slugs: sectorSlugs, ...filters, count: LIMITS.situation.units });
    const ranked: string[] = [];
    for (const u of units) if (!ranked.includes(u.slug)) ranked.push(u.slug);
    const top = ranked.slice(0, LIMITS.situation.pathways);
    if (top.length === 0) return { kind: 'situation', text: NOTHING, slugs: [] };
    const docs = (await getPublishedDocuments(top.slice(0, LIMITS.situation.documents))).sort(
      (a, b) => top.indexOf(a.slug) - top.indexOf(b.slug)
    );
    const rest = units.filter((u) => top.includes(u.slug) && !docs.some((d) => d.slug === u.slug));
    const parts = [
      sectorSlugs.length
        ? `These pathways are from the same sector as the user (${opts.sector}). Present one as matching their situation only if it is also the same kind of problem.`
        : 'No published pathway is from the same sector as the user, as far as is known. Any pathway below is an adjacent match: say so in the same breath.',
      ...docs.map(documentBlock),
      ...(rest.length ? [`## Further relevant lessons\n\n${rest.map(unitBlock).join('\n\n')}`] : []),
    ];
    return { kind: 'situation', text: parts.join('\n\n---\n\n'), slugs: top };
  }

  if (cls.kind === 'broad') {
    const units = await hybridSearch({ searchText, ...filters, count: LIMITS.broad.units });
    const kept: UnitHit[] = [];
    const seen: string[] = [];
    for (const u of units) {
      if (!seen.includes(u.slug)) {
        if (seen.length >= LIMITS.broad.pathways) continue;
        seen.push(u.slug);
      }
      kept.push(u);
    }
    if (kept.length === 0) return { kind: 'broad', text: NOTHING, slugs: [] };
    const text =
      `## Lessons across pathways (${seen.length} pathway${seen.length === 1 ? '' : 's'})\n\nCredit every point to the pathway it comes from. Name any part of the question none of them covers as a gap.\n\n` +
      kept.map(unitBlock).join('\n\n');
    return { kind: 'broad', text, slugs: seen };
  }

  // patterns
  const units = await hybridSearch({ searchText, ...filters, count: LIMITS.patterns.units });
  if (units.length === 0) return { kind: 'patterns', text: NOTHING, slugs: [] };
  const groups = groupPatterns(units);
  const text =
    '## Lessons grouped by where they sit in the framework\n\nThe pathway counts below are exact. Call something a common pattern ONLY when a group says 2 or more pathways; for a group from one pathway, say that only one pathway shows it.\n\n' +
    groups
      .map((g) => {
        const head =
          g.pathways.length >= 2
            ? `### Seen in ${g.pathways.length} pathways (${g.pathways.join(', ')})`
            : `### Only one pathway shows this (${g.pathways[0]})`;
        return `${head} — ${g.stage} · ${subCategoryName(g.sub_category)} · ${g.unit_type}\n\n${g.units.map(unitBlock).join('\n\n')}`;
      })
      .join('\n\n');
  const slugs = [...new Set(units.map((u) => u.slug))];
  return { kind: 'patterns', text, slugs };
}
