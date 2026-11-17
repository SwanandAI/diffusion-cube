import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type SupabaseMock } from '../../helpers/supabase-mock';
import { fakeToolUseMessage } from '../../helpers/anthropic-mock';

const anthropic = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: anthropic.create };
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/embeddings', () => ({ embedTexts: vi.fn(), toPgVector: (v: number[]) => `[${v.join(',')}]` }));
vi.mock('@/lib/ai-usage', () => ({ recordAiUsage: vi.fn() }));
vi.mock('@/lib/errors', () => ({ logError: vi.fn() }));
vi.mock('@/lib/pathway-store', async (orig) => ({
  ...(await orig<typeof import('@/lib/pathway-store')>()),
  listPublished: vi.fn(),
  getPublishedDocuments: vi.fn(),
  publicSourceTexts: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { embedTexts } from '@/lib/embeddings';
import { recordAiUsage } from '@/lib/ai-usage';
import { getPublishedDocuments, listPublished, publicSourceTexts, type PublishedCard, type SourceText } from '@/lib/pathway-store';
import {
  buildGrounding, classifyQuery, CLASSIFIER_MODEL, COVERAGE_MODEL, groupPatterns, pathwayPassages, selectSourceText, SOURCE_TEXT_BUDGET, type UnitHit,
} from '@/lib/retrieval';

const card = (slug: string, sector = 'Agriculture'): PublishedCard => ({
  slug, title: slug.toUpperCase(), description: '', category: '', sector, stage: '', location: '', tags: [], contributor_org: null, created_at: '2026-01-01',
});
const PUBLISHED = [card('maha'), card('blue-dots', 'Health'), card('naya', 'Legal')];

function unit(slug: string, n: number, over: Partial<UnitHit> = {}): UnitHit {
  return {
    id: `${slug}-u0${n}`, pathway_id: `p-${slug}`, slug, pathway_title: slug.toUpperCase(), sector: null, unit_number: n,
    title: `Unit ${n}`, unit_type: 'Failure and Fix', dimension: 'institution', sub_category: 'institution-B', stage: 'Pilot',
    applies_when: '', fails_when: '', body: `**${n}. Body of ${slug} ${n}**`, score: 1, ...over,
  };
}

const doc = (slug: string, content = `# ${slug} doc\n\n## Source Trace\n\nsecret.pdf`) => ({
  slug, title: slug.toUpperCase(), content, contributor_org: 'Org', created_at: '2026-02-01T00:00:00Z',
});

let admin: SupabaseMock;
let units: UnitHit[] = [];
let passages: unknown[] = [];
let docChunks: unknown[] = [];
let sources: SourceText[] = [];

function msgs(text: string) {
  return [{ role: 'user', content: text }];
}

function classifierSays(input: Record<string, unknown>) {
  anthropic.create.mockResolvedValue(fakeToolUseMessage(input, CLASSIFIER_MODEL));
}

beforeEach(() => {
  units = [];
  passages = [];
  docChunks = [];
  sources = [];
  admin = createSupabaseMock({
    rpc: {
      match_pathway_units: () => ({ data: units }),
      match_source_chunks: () => ({ data: passages }),
      match_pathway_doc_chunks: () => ({ data: docChunks }),
    },
  });
  vi.mocked(publicSourceTexts).mockReset();
  vi.mocked(publicSourceTexts).mockImplementation(async () => sources);
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
  vi.mocked(listPublished).mockResolvedValue(PUBLISHED);
  vi.mocked(getPublishedDocuments).mockImplementation(async (slugs: string[]) => slugs.map((s) => doc(s)));
  vi.mocked(embedTexts).mockReset();
  vi.mocked(embedTexts).mockResolvedValue([[0.1, 0.2]]);
  anthropic.create.mockReset();
  vi.mocked(recordAiUsage).mockReset();
});

describe('classifyQuery', () => {
  it('calls Haiku with forced tool use, thinking off and low effort, and records usage', async () => {
    classifierSays({ kind: 'patterns', pathway_slugs: [], dimension: 'institution', stage: 'Pilot', unit_types: ['Failure and Fix'], search_text: 'what goes wrong at pilot' });
    const c = await classifyQuery({ messages: msgs('What usually goes wrong at Pilot on the institution side?'), surface: 'analyse', published: PUBLISHED });
    expect(c).toEqual({ kind: 'patterns', slugs: [], dimension: 'institution', stage: 'Pilot', unitTypes: ['Failure and Fix'], searchText: 'what goes wrong at pilot', fromModel: true });
    const req = anthropic.create.mock.calls[0][0];
    expect(req.model).toBe('claude-haiku-5-5');
    expect(req.thinking).toEqual({ type: 'disabled' });
    expect(req.output_config).toEqual({ effort: 'low' });
    expect(req.tool_choice).toEqual({ type: 'tool', name: 'route_question' });
    expect(req.tools[0].input_schema.properties.pathway_slugs.items.enum).toEqual(['maha', 'blue-dots', 'naya']);
    expect(recordAiUsage).toHaveBeenCalledWith(expect.objectContaining({ mode: 'retrieval-classify', ok: true }));
  });

  it('keeps only published slugs, and turns a "specific" with none into "broad"', async () => {
    classifierSays({ kind: 'specific', pathway_slugs: ['ghost'], search_text: 'x' });
    const c = await classifyQuery({ messages: msgs('Tell me about Ghost'), surface: 'explore-overview', published: PUBLISHED });
    expect(c.kind).toBe('broad');
    expect(c.slugs).toEqual([]);
  });

  it('sends only the last six turns, each capped', async () => {
    classifierSays({ kind: 'broad', pathway_slugs: [], search_text: 'x' });
    const long = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn${i} ` + 'y'.repeat(5000) }));
    await classifyQuery({ messages: long, surface: 'analyse', published: PUBLISHED });
    const prompt = anthropic.create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).not.toContain('turn3 ');
    expect(prompt).toContain('turn4 ');
    expect(prompt.length).toBeLessThan(6 * 2100 + 2000);
  });

  it.each([
    ['analyse', 'situation'],
    ['explore-overview', 'broad'],
  ] as const)('falls back to the %s default (%s) when Haiku fails, without throwing', async (surface, kind) => {
    anthropic.create.mockRejectedValue(new Error('overloaded'));
    const c = await classifyQuery({ messages: msgs('hello there'), surface, published: PUBLISHED });
    expect(c).toMatchObject({ kind, searchText: 'hello there', fromModel: false });
    expect(recordAiUsage).toHaveBeenCalledWith(expect.objectContaining({ mode: 'retrieval-classify', ok: false }));
  });

  it('falls back on an invalid kind or no tool call', async () => {
    classifierSays({ kind: 'gossip', pathway_slugs: [], search_text: 'x' });
    expect((await classifyQuery({ messages: msgs('q'), surface: 'analyse', published: PUBLISHED })).fromModel).toBe(false);
    anthropic.create.mockResolvedValue({ model: CLASSIFIER_MODEL, usage: {}, content: [{ type: 'text', text: 'no' }] });
    expect((await classifyQuery({ messages: msgs('q'), surface: 'analyse', published: PUBLISHED })).fromModel).toBe(false);
  });

  it("never calls Haiku with a pathway open, for a document, or in the contributor's chat", async () => {
    expect(await classifyQuery({ messages: msgs('q'), surface: 'explore-pathway', published: PUBLISHED, openSlug: 'maha' })).toMatchObject({ kind: 'specific', slugs: ['maha'] });
    expect((await classifyQuery({ messages: msgs('q'), surface: 'document', published: PUBLISHED })).kind).toBe('situation');
    expect((await classifyQuery({ messages: msgs('q'), surface: 'contribute', published: PUBLISHED })).kind).toBe('situation');
    expect(anthropic.create).not.toHaveBeenCalled();
  });
});

describe('groupPatterns', () => {
  it('counts distinct pathways per framework cell, most-shared first', () => {
    const groups = groupPatterns([
      unit('maha', 1), unit('blue-dots', 2), unit('naya', 3), unit('maha', 4),
      unit('maha', 5, { stage: 'Scale' }),
      unit('naya', 6, { dimension: 'persona', sub_category: 'persona-A' }), unit('blue-dots', 7, { dimension: 'persona', sub_category: 'persona-A' }),
    ]);
    expect(groups.map((g) => g.pathways.length)).toEqual([3, 2, 1]);
    expect(groups[0].pathways).toEqual(['maha', 'blue-dots', 'naya']);
    expect(groups[0].units).toHaveLength(4);
  });
});

describe('buildGrounding', () => {
  it("UC1 with a pathway open: its write-up without Source Trace, plus its originals when Haiku says the write-up falls short", async () => {
    sources = [{ id: 's1', file_name: 'vendors.pdf', text: 'We chose Vendor X.' }];
    docChunks = [{ section: 'Section 1', text: 'Section 1\nVoice line for farmers.', similarity: 0.4 }];
    coverageSays(false);
    const g = await buildGrounding({ surface: 'explore-pathway', messages: msgs('Which telephony vendor?'), openSlug: 'maha' });
    expect(g.kind).toBe('specific');
    expect(g.slugs).toEqual(['maha']);
    expect(g.text).toContain('# Pathway: maha');
    expect(g.text).toContain('Contributed by: Org');
    expect(g.text).not.toMatch(/source trace|secret\.pdf/i);
    expect(g.text).toContain('original documents');
    expect(g.text).toContain('### Source document: vendors.pdf\nWe chose Vendor X.');
    // The only model call is the coverage check (no classifier on an open pathway).
    expect(anthropic.create).toHaveBeenCalledTimes(1);
    expect(anthropic.create.mock.calls[0][0].tool_choice).toEqual({ type: 'tool', name: 'judge_coverage' });
    expect(publicSourceTexts).toHaveBeenCalledWith('maha');
  });

  it('UC1 on a pathway with no originals: no passage section', async () => {
    const g = await buildGrounding({ surface: 'explore-pathway', messages: msgs('q'), openSlug: 'maha' });
    expect(g.text).not.toContain('Source document');
  });

  it('UC2: top units, each credited, from at most 8 pathways', async () => {
    classifierSays({ kind: 'broad', pathway_slugs: [], search_text: 'data sharing' });
    units = Array.from({ length: 10 }, (_, i) => unit(`p${i}`, 1));
    const g = await buildGrounding({ surface: 'explore-overview', messages: msgs('How did deployments get departments to share data?') });
    expect(g.kind).toBe('broad');
    expect(g.slugs).toHaveLength(8);
    expect(g.text).toContain('#### From "P0" (p0), Unit 1');
    expect(g.text).not.toContain('(p9)');
    const [name, args] = admin.rpc.mock.calls[0];
    expect(name).toBe('match_pathway_units');
    expect(args).toMatchObject({ query_embedding: '[0.1,0.2]', query_text: 'data sharing', match_count: 30, filter_slugs: null });
  });

  it('UC3: pattern counts are stated from code, and one-pathway groups are marked', async () => {
    classifierSays({ kind: 'patterns', pathway_slugs: [], dimension: 'institution', stage: 'Pilot', search_text: 'pilot failures' });
    units = [unit('maha', 1), unit('naya', 2), unit('blue-dots', 3, { unit_type: 'Playbook' })];
    const g = await buildGrounding({ surface: 'analyse', messages: msgs('What usually goes wrong at Pilot?') });
    expect(g.text).toContain('### Seen in 2 pathways (maha, naya)');
    expect(g.text).toContain('### Only one pathway shows this (blue-dots)');
    expect(admin.rpc.mock.calls[0][1]).toMatchObject({ filter_dimension: 'institution', filter_stage: 'Pilot', match_count: 40 });
  });

  it("situation: searches the user's sector's pathways and puts the top two write-ups first", async () => {
    classifierSays({ kind: 'situation', pathway_slugs: [], search_text: 'voice advisory for farmers' });
    units = [unit('maha', 1), unit('maha', 2)];
    const g = await buildGrounding({ surface: 'analyse', messages: msgs('We run a farmer helpline'), sector: 'agriculture' });
    expect(admin.rpc.mock.calls[0][1]).toMatchObject({ filter_slugs: ['maha'] });
    expect(g.slugs).toEqual(['maha']);
    expect(g.text).toContain('same sector as the user');
  });

  it('says plainly that nothing matches when search finds nothing', async () => {
    classifierSays({ kind: 'broad', pathway_slugs: [], search_text: 'quantum farming' });
    const g = await buildGrounding({ surface: 'analyse', messages: msgs('quantum farming?') });
    expect(g.text).toMatch(/No published pathway documents anything/);
    expect(g.slugs).toEqual([]);
  });

  it('searches by full text alone when embedding fails', async () => {
    classifierSays({ kind: 'broad', pathway_slugs: [], search_text: 'mou' });
    vi.mocked(embedTexts).mockRejectedValue(new Error('down'));
    units = [unit('maha', 1)];
    const g = await buildGrounding({ surface: 'explore-overview', messages: msgs('mou?') });
    expect(admin.rpc.mock.calls[0][1]).toMatchObject({ query_embedding: null, query_text: 'mou' });
    expect(g.slugs).toEqual(['maha']);
  });

  it('throws a database error for the route to handle', async () => {
    admin = createSupabaseMock({ rpc: { match_pathway_units: { error: { message: 'boom' } } } });
    vi.mocked(createAdminClient).mockReturnValue(admin.client);
    classifierSays({ kind: 'broad', pathway_slugs: [], search_text: 'x' });
    await expect(buildGrounding({ surface: 'analyse', messages: msgs('x') })).rejects.toMatchObject({ message: 'boom' });
  });

  it('says so when nothing is published yet, without calling Haiku', async () => {
    vi.mocked(listPublished).mockResolvedValue([]);
    const g = await buildGrounding({ surface: 'analyse', messages: msgs('x') });
    expect(g.text).toMatch(/No pathways are published yet/);
    expect(anthropic.create).not.toHaveBeenCalled();
  });
});

function coverageSays(answered: boolean) {
  anthropic.create.mockResolvedValue(fakeToolUseMessage({ answered }, COVERAGE_MODEL));
}

describe('pathwayPassages', () => {
  const VENDORS: SourceText = { id: 's1', file_name: 'vendors.pdf', text: 'We chose Vendor X for telephony.' };

  it("is '' without a question, and never calls Haiku when the pathway has no originals", async () => {
    sources = [VENDORS];
    expect(await pathwayPassages('maha', '')).toBe('');
    sources = [];
    expect(await pathwayPassages('maha', 'Which vendor?')).toBe('');
    expect(anthropic.create).not.toHaveBeenCalled();
    expect(embedTexts).not.toHaveBeenCalled();
  });

  it("adds nothing when Haiku says the nearest write-up passages answer the question", async () => {
    sources = [VENDORS];
    docChunks = [{ section: 'Section 3', text: 'Section 3\nThey picked Vendor X.', similarity: 0.8 }];
    coverageSays(true);
    expect(await pathwayPassages('maha', 'Which vendor?', 'explore')).toBe('');
    expect(admin.rpc).toHaveBeenCalledWith('match_pathway_doc_chunks', { query_embedding: '[0.1,0.2]', pathway_slug: 'maha', match_count: 5 });
    const req = anthropic.create.mock.calls[0][0];
    expect(req.model).toBe('claude-haiku-5-5');
    expect(req.messages[0].content).toContain('Which vendor?');
    expect(req.messages[0].content).toContain('They picked Vendor X.');
    expect(anthropic.create.mock.calls[0][1]).toEqual({ maxRetries: 2 });
    expect(recordAiUsage).toHaveBeenCalledWith(expect.objectContaining({ mode: 'retrieval-coverage', flow: 'explore', ok: true }));
  });

  it('adds the whole original text, unembedded, when Haiku says the write-up falls short', async () => {
    sources = [VENDORS, { id: 's2', file_name: 'notes.md', text: 'Budget was small.' }];
    docChunks = [{ section: 'Section 1', text: 'Section 1\nAbout the pilot.', similarity: 0.3 }];
    coverageSays(false);
    expect(await pathwayPassages('maha', 'Which vendor?')).toBe(
      '### Source document: vendors.pdf\nWe chose Vendor X for telephony.\n\n### Source document: notes.md\nBudget was small.'
    );
    // Only the question is embedded — never the originals.
    expect(vi.mocked(embedTexts).mock.calls).toEqual([[['Which vendor?']]]);
  });

  it('adds the originals without asking Haiku when the write-up has no indexed passages (or embedding is down)', async () => {
    sources = [VENDORS];
    vi.mocked(embedTexts).mockRejectedValue(new Error('down'));
    expect(await pathwayPassages('maha', 'Which vendor?')).toContain('We chose Vendor X');
    expect(anthropic.create).not.toHaveBeenCalled();
  });

  it('adds the originals when the coverage check fails, and records the failure', async () => {
    sources = [VENDORS];
    docChunks = [{ section: 'S', text: 'S\nx', similarity: 0.5 }];
    anthropic.create.mockRejectedValue(new Error('overloaded'));
    expect(await pathwayPassages('maha', 'Which vendor?')).toContain('We chose Vendor X');
    expect(recordAiUsage).toHaveBeenCalledWith(expect.objectContaining({ mode: 'retrieval-coverage', ok: false }));
  });

  it('uses seeded embedded passages first when the originals are over the budget', async () => {
    sources = [{ id: 's1', file_name: 'big.pdf', text: 'filler words here. '.repeat(SOURCE_TEXT_BUDGET / 10) }];
    docChunks = [{ section: 'S', text: 'S\nx', similarity: 0.5 }];
    passages = [
      { source_key: 'src-01', file_name: 'big.pdf', chunk_index: 7, text: 'The vendor was Vendor X.', is_public: true },
      { source_key: 'src-02', file_name: 'private.pdf', chunk_index: 0, text: 'PRIVATE', is_public: false },
    ];
    coverageSays(false);
    const text = await pathwayPassages('maha', 'Which vendor?');
    expect(text).toContain('### Source document: big.pdf (excerpts)');
    expect(text).toContain('The vendor was Vendor X.');
    expect(text).not.toContain('PRIVATE');
    expect(text.length).toBeLessThan(SOURCE_TEXT_BUDGET + 500);
  });
});

describe('selectSourceText', () => {
  it('keeps whole documents that fit the budget', () => {
    expect(selectSourceText([{ id: 'a', file_name: 'a.txt', text: ' A text ' }], 'q', [], 100)).toBe('### Source document: a.txt\nA text');
  });

  it('past the budget, keeps the passages sharing the most words with the question, in document order', () => {
    // ~1,500-character paragraphs, so each passage is about one paragraph
    // (plus chunkText's 200-character overlap from the one before).
    const filler = (w: string) => `${w} `.repeat(Math.ceil(1450 / (w.length + 1))).trim() + '.';
    const text = [
      filler('alpha'),
      `The telephony vendor was Vendor X. ${filler('gamma')}`,
      filler('beta'),
      `Vendor contract signed in March. ${filler('delta')}`,
    ].join('\n\n');
    const out = selectSourceText([{ id: 'a', file_name: 'a.pdf', text }], 'Which telephony vendor?', [], 3500);
    const count = (w: string) => out.split(w).length - 1;
    expect(out.startsWith('### Source document: a.pdf (excerpts)')).toBe(true);
    expect(out).toContain('The telephony vendor was Vendor X.');
    expect(out).toContain('Vendor contract signed in March.');
    // The alpha and beta passages aren't picked (242 and 262 words); only
    // the neighbouring passages' leading text carries a few in.
    expect(count('alpha')).toBeLessThan(45);
    expect(count('beta')).toBeLessThan(100);
    // Document order, with a gap marker between the two excerpts.
    expect(out.indexOf('telephony vendor')).toBeLessThan(out.indexOf('[…]'));
    expect(out.indexOf('[…]')).toBeLessThan(out.indexOf('Vendor contract'));
  });

  it("is '' when nothing over the budget matches the question", () => {
    expect(selectSourceText([{ id: 'a', file_name: 'a.pdf', text: 'x'.repeat(200) }], 'vendor', [], 100)).toBe('');
  });
});
