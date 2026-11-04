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
  getPublishedDocument,
  isSlugTaken,
  publishVersion,
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

function publishTables(over: Record<string, TableHandler> = {}) {
  return {
    pathway_versions: () => ({ data: { id: 'v3', pathway_id: 'p1', content: DOC } }),
    pathways: (op: QueryOp) =>
      op.action === 'select'
        ? { data: { id: 'p1', slug: 'maha', title: 'Old title', sector: '', description: 'old', first_published_at: null } }
        : {},
    pathway_units: () => ({}),
    ...over,
  } as Record<string, TableHandler>;
}

describe('publishVersion', () => {
  it('points the pathway at the version, copies card fields, and indexes its units with vectors', async () => {
    setup(publishTables());
    vi.mocked(embedTexts).mockResolvedValue([vec]);
    const res = await publishVersion({ pathwayId: 'p1', versionId: 'v3', publishedBy: 'admin1' });

    expect(res).toMatchObject({ slug: 'maha', title: 'Maha Path', indexedUnits: 1, embedded: true });
    expect(res.skippedUnits).toEqual([{ unit: 2, title: 'Bad unit', reason: 'unknown dimension "Governance"' }]);

    const update = admin.ops('pathways', 'update')[0].payload as Record<string, unknown>;
    expect(update).toMatchObject({
      status: 'published', published_version_id: 'v3', title: 'Maha Path', description: 'Voice advisory at scale',
      sector: 'Agriculture', stage: 'Scale', location: 'Maharashtra', tags: ['Voice AI', 'Agri'], organisation: 'Org A',
      published_by: 'admin1',
    });
    expect(update.first_published_at).toEqual(expect.any(String));

    // Old units replaced, new ones inserted with their vector.
    expect(admin.ops('pathway_units', 'delete')[0].filters).toContainEqual(['eq', 'pathway_id', 'p1']);
    const [row] = admin.ops('pathway_units', 'insert')[0].payload as Record<string, unknown>[];
    expect(row).toMatchObject({
      id: 'maha-u01', pathway_id: 'p1', version_id: 'v3', dimension: 'institution', sub_category: 'institution-E',
      adopter_intents: ['How do we share data?'], source_ids: ['src-01'],
    });
    expect(row.embedding).toBe(`[${vec.join(',')}]`);
  });

  it('keeps the first publish date on a re-publish', async () => {
    setup(publishTables({
      pathways: (op) =>
        op.action === 'select'
          ? { data: { id: 'p1', slug: 'maha', title: 't', sector: '', description: '', first_published_at: '2026-01-01T00:00:00Z' } }
          : {},
    }));
    vi.mocked(embedTexts).mockResolvedValue([vec]);
    await publishVersion({ pathwayId: 'p1', versionId: 'v3' });
    expect((admin.ops('pathways', 'update')[0].payload as Record<string, unknown>).first_published_at).toBe('2026-01-01T00:00:00Z');
  });

  it('still publishes, without vectors, when embedding fails — and records it', async () => {
    setup(publishTables());
    vi.mocked(embedTexts).mockRejectedValue(new Error('embed down'));
    const res = await publishVersion({ pathwayId: 'p1', versionId: 'v3' });
    expect(res.embedded).toBe(false);
    const [row] = admin.ops('pathway_units', 'insert')[0].payload as Record<string, unknown>[];
    expect(row.embedding).toBeNull();
    expect(logError).toHaveBeenCalledWith('lib/pathway-store', expect.any(Error), expect.objectContaining({ pathway_slug: 'maha' }));
  });

  it('publishes a version whose units are all skipped, with no units indexed', async () => {
    setup(publishTables({ pathway_versions: () => ({ data: { id: 'v3', pathway_id: 'p1', content: DOC.replace(/^- \*\*Sub-category.*\n/gm, '') } }) }));
    const res = await publishVersion({ pathwayId: 'p1', versionId: 'v3' });
    expect(res.indexedUnits).toBe(0);
    expect(res.skippedUnits.map((s) => s.reason)).toEqual(['missing sub-category', 'unknown dimension "Governance"']);
    expect(admin.ops('pathway_units', 'insert')).toHaveLength(0);
    expect(admin.ops('pathway_units', 'delete')).toHaveLength(1);
    expect(embedTexts).not.toHaveBeenCalled();
  });

  it("refuses a version that belongs to another pathway", async () => {
    setup(publishTables({ pathway_versions: () => ({ data: { id: 'v3', pathway_id: 'OTHER', content: DOC } }) }));
    await expect(publishVersion({ pathwayId: 'p1', versionId: 'v3' })).rejects.toThrow(/not found/);
    expect(admin.ops('pathways', 'update')).toHaveLength(0);
  });

  it('throws when inserting the units fails', async () => {
    setup(publishTables({ pathway_units: (op) => (op.action === 'insert' ? { error: { message: 'boom' } } : {}) }));
    vi.mocked(embedTexts).mockResolvedValue([vec]);
    await expect(publishVersion({ pathwayId: 'p1', versionId: 'v3' })).rejects.toMatchObject({ message: 'boom' });
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
