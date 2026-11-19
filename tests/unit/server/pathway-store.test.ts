import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type QueryOp, type SupabaseMock, type TableHandler } from '../../helpers/supabase-mock';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/embeddings', () => ({
  embedTexts: vi.fn(),
  toPgVector: (v: number[]) => `[${v.join(',')}]`,
}));
vi.mock('@/lib/errors', () => ({ logError: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { embedTexts } from '@/lib/embeddings';
import { logError } from '@/lib/errors';
import {
  adopterDocument,
  buildOverview,
  contributorSourcePath,
  getPublishedDocument,
  indexPublishedVersion,
  INDEX_ATTEMPTS,
  isContributorSourcePath,
  isSlugTaken,
  publicSourceTexts,
  publishVersion,
  saveContributorSource,
  saveVersion,
  unitEmbeddingText,
} from '@/lib/pathway-store';

const DOC = `---
title: Maha Path
description: Voice advisory at scale
sector: Agriculture
stage: Scale
location: Maharashtra
tags: [Voice AI, Agri]
contributor: Org A
---

## Section 3 — Micro-innovations

**1. Sign an MoU**

- **Dimension:** Institution
- **Sub-category:** E. Data Stewardship
- **Stage:** Pilot
- **Type:** Strategic Decision
- **Condition — applies when:** Department owns data.
- **Condition — fails when:** No mandate.

**2. Bad unit**

- **Dimension:** Governance
- **Sub-category:** A
- **Stage:** Pilot
- **Type:** Playbook

## Section 6 — Retrieval guide

*"How do we share data?"* → Unit 1

## Source Trace

| Source file | Covers | Notes |
|---|---|---|
| src-01 · mou.pdf | Unit 1 | Primary |
`;

let admin: SupabaseMock;

function setup(tables: Record<string, TableHandler> = {}) {
  admin = createSupabaseMock({ tables });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

const vec = Array.from({ length: 384 }, () => 0.5);

beforeEach(() => {
  vi.mocked(embedTexts).mockReset();
  vi.mocked(logError).mockReset();
});

describe('saveVersion', () => {
  it('appends the next version number and marks a draft "in review"', async () => {
    setup({
      pathway_versions: (op) =>
        op.action === 'select'
          ? { data: { version_number: 2 } }
          : { data: { id: 'v3', version_number: 3 } },
    });
    const v = await saveVersion({ pathwayId: 'p1', content: DOC, source: 'contributor', designDocumentId: 'd1', createdBy: 'u1' });
    expect(v).toEqual({ id: 'v3', version_number: 3 });
    expect(admin.ops('pathway_versions', 'insert')[0].payload).toMatchObject({
      pathway_id: 'p1', version_number: 3, content: DOC, source: 'contributor', design_document_id: 'd1', created_by: 'u1',
    });
    const status = admin.ops('pathways', 'update')[0];
    expect(status.payload).toEqual({ status: 'in_review' });
    // Only a draft moves: a live pathway stays published while its next version waits.
    expect(status.filters).toContainEqual(['eq', 'status', 'draft']);
  });

  it('starts at version 1', async () => {
    setup({ pathway_versions: (op) => (op.action === 'select' ? { data: null } : { data: { id: 'v1', version_number: 1 } }) });
    await saveVersion({ pathwayId: 'p1', content: DOC, source: 'seed' });
    expect(admin.ops('pathway_versions', 'insert')[0].payload).toMatchObject({ version_number: 1, source: 'seed' });
    expect(admin.ops('pathways', 'update')).toHaveLength(0);
  });

  it('throws when the insert fails (e.g. a racing save took the number)', async () => {
    setup({
      pathway_versions: (op) =>
        op.action === 'select' ? { data: { version_number: 1 } } : { error: { message: 'duplicate key', code: '23505' } },
    });
    await expect(saveVersion({ pathwayId: 'p1', content: DOC, source: 'contributor' })).rejects.toMatchObject({ code: '23505' });
  });
});

const UNIT_ROW = { id: 'maha-u01', title: 'Sign an MoU', applies_when: 'Department owns data.', fails_when: 'No mandate.', adopter_intents: ['How do we share data?'], body: '**1. Sign an MoU**' };

function publishTables(over: Record<string, TableHandler> = {}) {
  return {
    pathway_versions: () => ({ data: { id: 'v3', pathway_id: 'p1', content: DOC } }),
    pathways: (op: QueryOp) =>
      op.action !== 'select'
        ? {}
        : op.columns === 'published_version_id'
          ? { data: { published_version_id: 'v3' } }
          : { data: { id: 'p1', slug: 'maha', title: 'Old title', sector: '', description: 'old', first_published_at: null } },
    pathway_units: (op: QueryOp) => (op.action === 'select' ? { data: [UNIT_ROW] } : {}),
    pathway_doc_chunks: () => ({}),
    ...over,
  } as Record<string, TableHandler>;
}

// embedTexts answers one vector per text it's given.
function embedOk() {
  vi.mocked(embedTexts).mockImplementation(async (texts: string[]) => texts.map(() => vec));
}

const FAST = { retryDelayMs: 0 };

describe('publishVersion', () => {
  it('points the pathway at the version, copies card fields, and saves its units without vectors first', async () => {
    setup(publishTables());
    embedOk();
    const res = await publishVersion({ pathwayId: 'p1', versionId: 'v3', publishedBy: 'admin1' }, undefined, FAST);

    expect(res).toMatchObject({ slug: 'maha', title: 'Maha Path', indexedUnits: 1, embedded: true });
    expect(res.skippedUnits).toEqual([{ unit: 2, title: 'Bad unit', reason: 'unknown dimension "Governance"' }]);

    const update = admin.ops('pathways', 'update')[0].payload as Record<string, unknown>;
    expect(update).toMatchObject({
      status: 'published', published_version_id: 'v3', title: 'Maha Path', description: 'Voice advisory at scale',
      sector: 'Agriculture', stage: 'Scale', location: 'Maharashtra', tags: ['Voice AI', 'Agri'], organisation: 'Org A',
      published_by: 'admin1', index_status: 'pending', index_error: null,
    });
    expect(update.first_published_at).toEqual(expect.any(String));

    // Old units replaced; new ones inserted without a vector (keyword search works at once).
    expect(admin.ops('pathway_units', 'delete')[0].filters).toContainEqual(['eq', 'pathway_id', 'p1']);
    const [row] = admin.ops('pathway_units', 'insert')[0].payload as Record<string, unknown>[];
    expect(row).toMatchObject({
      id: 'maha-u01', pathway_id: 'p1', version_id: 'v3', dimension: 'institution', sub_category: 'institution-E',
      adopter_intents: ['How do we share data?'], source_ids: ['src-01'], embedding: null,
    });
  });

  it('keeps the first publish date on a re-publish', async () => {
    setup(publishTables({
      pathways: (op) =>
        op.action !== 'select'
          ? {}
          : op.columns === 'published_version_id'
            ? { data: { published_version_id: 'v3' } }
            : { data: { id: 'p1', slug: 'maha', title: 't', sector: '', description: '', first_published_at: '2026-01-01T00:00:00Z' } },
    }));
    embedOk();
    await publishVersion({ pathwayId: 'p1', versionId: 'v3' }, undefined, FAST);
    expect((admin.ops('pathways', 'update')[0].payload as Record<string, unknown>).first_published_at).toBe('2026-01-01T00:00:00Z');
  });

  it('still publishes when embedding keeps failing — reports it and records the failure', async () => {
    setup(publishTables());
    vi.mocked(embedTexts).mockRejectedValue(new Error('embed down'));
    const res = await publishVersion({ pathwayId: 'p1', versionId: 'v3' }, undefined, FAST);
    expect(res.embedded).toBe(false);
    const [row] = admin.ops('pathway_units', 'insert')[0].payload as Record<string, unknown>[];
    expect(row.embedding).toBeNull();
    expect(embedTexts).toHaveBeenCalledTimes(INDEX_ATTEMPTS);
    expect(logError).toHaveBeenCalledWith('lib/pathway-store', expect.any(Error), expect.objectContaining({ step: 'index', pathway_id: 'p1' }));
    const failed = admin.ops('pathways', 'update').map((o) => o.payload as Record<string, unknown>).find((p) => p.index_status === 'failed');
    expect(failed).toMatchObject({ index_status: 'failed', index_error: 'embed down' });
  });

  it("with index: 'background', returns before embedding anything", async () => {
    setup(publishTables());
    let release: () => void = () => {};
    vi.mocked(embedTexts).mockImplementation(() => new Promise((r) => { release = () => r([vec]); }));
    const res = await publishVersion({ pathwayId: 'p1', versionId: 'v3' }, undefined, { index: 'background', retryDelayMs: 0 });
    expect(res.embedded).toBeNull();
    expect(admin.ops('pathway_units', 'insert')).toHaveLength(1);
    release();
  });

  it('publishes a version whose units are all skipped, with no units indexed', async () => {
    setup(publishTables({
      pathway_versions: () => ({ data: { id: 'v3', pathway_id: 'p1', content: DOC.replace(/^- \*\*Sub-category.*\n/gm, '') } }),
      pathway_units: (op: QueryOp) => (op.action === 'select' ? { data: [] } : {}),
    }));
    embedOk();
    const res = await publishVersion({ pathwayId: 'p1', versionId: 'v3' }, undefined, FAST);
    expect(res.indexedUnits).toBe(0);
    expect(res.skippedUnits.map((s) => s.reason)).toEqual(['missing sub-category', 'unknown dimension "Governance"']);
    expect(admin.ops('pathway_units', 'insert')).toHaveLength(0);
    expect(admin.ops('pathway_units', 'delete')).toHaveLength(1);
    // The document itself is still embedded.
    expect(admin.ops('pathway_doc_chunks', 'insert')).toHaveLength(1);
  });

  it("refuses a version that belongs to another pathway", async () => {
    setup(publishTables({ pathway_versions: () => ({ data: { id: 'v3', pathway_id: 'OTHER', content: DOC } }) }));
    await expect(publishVersion({ pathwayId: 'p1', versionId: 'v3' })).rejects.toThrow(/not found/);
    expect(admin.ops('pathways', 'update')).toHaveLength(0);
  });

  it('throws when inserting the units fails', async () => {
    setup(publishTables({ pathway_units: (op) => (op.action === 'insert' ? { error: { message: 'boom' } } : {}) }));
    embedOk();
    await expect(publishVersion({ pathwayId: 'p1', versionId: 'v3' })).rejects.toMatchObject({ message: 'boom' });
  });
});

describe('indexPublishedVersion', () => {
  it('embeds the units and the whole document by section, then marks the pathway indexed', async () => {
    setup(publishTables());
    embedOk();
    const res = await indexPublishedVersion({ pathwayId: 'p1', versionId: 'v3' }, undefined, FAST);
    expect(res).toMatchObject({ ok: true, attempts: 1, units: 1 });

    // Unit vector written onto its row.
    const unitUpdate = admin.ops('pathway_units', 'update')[0];
    expect(unitUpdate.payload).toEqual({ embedding: `[${vec.join(',')}]` });
    expect(unitUpdate.filters).toContainEqual(['eq', 'id', 'maha-u01']);
    // Only units without a vector are picked up (so a retry resumes).
    expect(admin.ops('pathway_units', 'select')[0].filters).toContainEqual(['is', 'embedding', null]);

    // The document: frontmatter and Source Trace left out, every section in.
    const chunks = admin.ops('pathway_doc_chunks', 'insert')[0].payload as Record<string, unknown>[];
    expect(res.docChunks).toBe(chunks.length);
    expect(chunks.map((c) => c.section)).toEqual(['Section 3 — Micro-innovations', 'Section 6 — Retrieval guide']);
    const all = chunks.map((c) => c.text).join('\n');
    expect(all).toContain('Sign an MoU');
    expect(all).not.toMatch(/mou\.pdf|description:/);
    expect(chunks[0]).toMatchObject({ pathway_id: 'p1', version_id: 'v3', chunk_index: 0, embedding: `[${vec.join(',')}]` });
    expect(admin.ops('pathway_doc_chunks', 'delete')[0].filters).toContainEqual(['eq', 'pathway_id', 'p1']);

    const done = admin.ops('pathways', 'update').at(-1)!;
    expect(done.payload).toMatchObject({ index_status: 'indexed', index_error: null, indexed_at: expect.any(String) });
    // Only while this version is still the live one.
    expect(done.filters).toContainEqual(['eq', 'published_version_id', 'v3']);
  });

  it('retries twice after a failure, then succeeds', async () => {
    setup(publishTables());
    vi.mocked(embedTexts)
      .mockRejectedValueOnce(new Error('busy'))
      .mockRejectedValueOnce(new Error('busy'))
      .mockImplementation(async (texts: string[]) => texts.map(() => vec));
    const res = await indexPublishedVersion({ pathwayId: 'p1', versionId: 'v3' }, undefined, FAST);
    expect(res).toMatchObject({ ok: true, attempts: 3 });
    expect(logError).toHaveBeenCalledTimes(2);
  });

  it('gives up after the first try and 2 retries, and records why', async () => {
    setup(publishTables());
    vi.mocked(embedTexts).mockRejectedValue(new Error('down'));
    const res = await indexPublishedVersion({ pathwayId: 'p1', versionId: 'v3' }, undefined, FAST);
    expect(INDEX_ATTEMPTS).toBe(3);
    expect(res).toMatchObject({ ok: false, attempts: 3, error: 'down' });
    expect(admin.ops('pathways', 'update').at(-1)!.payload).toEqual({ index_status: 'failed', index_error: 'down' });
  });

  it('writes nothing when a newer version was published meanwhile', async () => {
    setup(publishTables({
      pathways: (op) => (op.action === 'select' ? { data: { published_version_id: 'v4' } } : {}),
    }));
    embedOk();
    const res = await indexPublishedVersion({ pathwayId: 'p1', versionId: 'v3' }, undefined, FAST);
    expect(res).toMatchObject({ ok: true, superseded: true });
    expect(embedTexts).not.toHaveBeenCalled();
    expect(admin.ops('pathways', 'update')).toHaveLength(0);
    expect(admin.ops('pathway_doc_chunks')).toHaveLength(0);
  });
});

describe('contributor originals', () => {
  const INPUT = {
    pathwayId: 'p1', designId: 'd1', uploadedBy: 'u1', fileName: 'Vendor Eval.pdf', mimeType: 'application/pdf',
    storagePath: 'contrib/p1/x-Vendor Eval.pdf', text: 'We chose Vendor X.',
  };

  it('keeps the document as public, contributor-origin, with the next src key and a content hash', async () => {
    setup({
      pathway_sources: (op) =>
        op.action === 'insert'
          ? { data: { id: 'new' } }
          : op.columns === 'source_key'
            ? { data: [{ source_key: 'src-01' }, { source_key: 'src-07' }] }
            : { data: null },
    });
    const saved = await saveContributorSource(INPUT);
    expect(saved).toEqual({ id: 'new', sourceKey: 'src-08', duplicate: false, storagePath: 'contrib/p1/x-Vendor Eval.pdf' });
    expect(admin.ops('pathway_sources', 'insert')[0].payload).toMatchObject({
      pathway_id: 'p1', source_key: 'src-08', file_name: 'Vendor Eval.pdf', storage_path: 'contrib/p1/x-Vendor Eval.pdf',
      extracted_text: 'We chose Vendor X.', is_public: true, origin: 'contributor', design_id: 'd1', uploaded_by: 'u1',
      content_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('keeps the same text only once', async () => {
    setup({ pathway_sources: (op) => (op.columns === 'id, source_key, storage_path' ? { data: { id: 'old', source_key: 'src-02', storage_path: null } } : {}) });
    expect(await saveContributorSource(INPUT)).toEqual({ id: 'old', sourceKey: 'src-02', duplicate: true, storagePath: null });
    expect(admin.ops('pathway_sources', 'insert')).toHaveLength(0);
  });

  it('retries when another save took the same key first', async () => {
    let inserts = 0;
    setup({
      pathway_sources: (op) =>
        op.action === 'insert'
          ? ++inserts === 1 ? { error: { message: 'duplicate key', code: '23505' } } : { data: { id: 'new' } }
          : op.columns === 'source_key' ? { data: [] } : { data: null },
    });
    expect(await saveContributorSource(INPUT)).toMatchObject({ id: 'new', sourceKey: 'src-01' });
    expect(inserts).toBe(2);
  });

  it('keeps an image (no text) without a hash, so it is never deduped away', async () => {
    setup({ pathway_sources: (op) => (op.action === 'insert' ? { data: { id: 'img' } } : { data: [] }) });
    await saveContributorSource({ ...INPUT, fileName: 'photo.png', text: '' });
    expect(admin.ops('pathway_sources', 'insert')[0].payload).toMatchObject({ content_hash: null, extracted_text: '' });
  });

  it('stores contributor files under contrib/<pathway>/ and checks paths against it', () => {
    const path = contributorSourcePath('p1', '../../etc/passwd');
    expect(path).toMatch(/^contrib\/p1\/[0-9a-f-]{36}-passwd$/);
    expect(isContributorSourcePath('p1', path)).toBe(true);
    expect(isContributorSourcePath('p2', path)).toBe(false);
    expect(isContributorSourcePath('p1', 'contrib/p1/../p2/x')).toBe(false);
    expect(isContributorSourcePath('p1', 42)).toBe(false);
  });

  it('publicSourceTexts returns the public originals with text of a published pathway only', async () => {
    setup({
      pathways: (op) => ({ data: op.filters.some((f) => f[2] === 'maha') ? { id: 'p1' } : null }),
      pathway_sources: {
        data: [
          { id: 'a', file_name: 'a.pdf', extracted_text: 'A', is_public: true },
          { id: 'b', file_name: 'b.png', extracted_text: '', is_public: true },
          { id: 'c', file_name: 'c.pdf', extracted_text: 'C', is_public: false },
        ],
      },
    });
    expect(await publicSourceTexts('maha')).toEqual([{ id: 'a', file_name: 'a.pdf', text: 'A' }]);
    expect(admin.ops('pathways', 'select')[0].filters).toContainEqual(['eq', 'status', 'published']);
    expect(await publicSourceTexts('nope')).toEqual([]);
  });
});

describe('readers', () => {
  it('getPublishedDocument reads the view and returns null for an unknown slug', async () => {
    setup({ published_pathways: (op) => ({ data: (op.filters[0][2] as string[]).includes('maha') ? [{ slug: 'maha', title: 'M', content: DOC }] : [] }) });
    expect((await getPublishedDocument('maha'))?.title).toBe('M');
    expect(await getPublishedDocument('nope')).toBeNull();
  });

  it('adopterDocument strips the Source Trace', () => {
    expect(adopterDocument({ content: DOC })).not.toMatch(/source trace|mou\.pdf/i);
  });

  it('buildOverview lists every published card and states the count', async () => {
    setup({
      published_pathways: {
        data: [
          { slug: 'a', title: 'A', description: 'd', sector: 'Health', stage: 'Pilot', location: '', tags: ['x'] },
          { slug: 'b', title: 'B', description: null, sector: null, stage: null, location: null, tags: null },
        ],
      },
    });
    const { overview, count } = await buildOverview();
    expect(count).toBe(2);
    expect(overview).toBe('[a]\ntitle: A\ndescription: d\nsector: Health\nstage: Pilot\ntags: [x]\n\n[b]\ntitle: B');
  });

  it('isSlugTaken is true for any existing pathway row', async () => {
    setup({ pathways: (op) => ({ data: op.filters[0][2] === 'taken' ? { id: 'p' } : null }) });
    expect(await isSlugTaken('taken')).toBe(true);
    expect(await isSlugTaken('free')).toBe(false);
  });
});

describe('unitEmbeddingText', () => {
  it('leads with the title and conditions and stays short', () => {
    const text = unitEmbeddingText({ title: 'T', applies_when: 'A', fails_when: '', adopter_intents: ['Q?'], body: 'x'.repeat(5000) });
    expect(text.startsWith('T\nApplies when: A\nAnswers: Q?\n')).toBe(true);
    expect(text.length).toBe(1600);
  });
});
