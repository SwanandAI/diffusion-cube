import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type QueryOp, type SupabaseMock } from '../../helpers/supabase-mock';
import { indexListedSlugs, readPathwayFile, uncuratedDraftSlugs } from '../../helpers/server-corpus';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { getWikiPathway, getWikiStats, listWikiPathways, stripProvenanceAppendix } from '@/lib/wiki-content';

let session: SupabaseMock;

function published(handler: (op: QueryOp) => { data?: unknown; error?: { message: string } | null }) {
  session = createSupabaseMock({ tables: { published_pathways: handler } });
  vi.mocked(createClient).mockResolvedValue(session.client);
}

beforeEach(() => published(() => ({ data: null })));

describe('stripProvenanceAppendix', () => {
  it('cuts at the first Source Trace heading', () => {
    expect(stripProvenanceAppendix('# Doc\n\nBody\n\n## Source Trace\n\nsecret notes')).toBe('# Doc\n\nBody');
  });

  it('cuts at a legacy Provenance heading, any level, any case', () => {
    expect(stripProvenanceAppendix('Body\n#### PROVENANCE appendix\nx')).toBe('Body');
    expect(stripProvenanceAppendix('Body\n### Source Trace appendix (contributor-facing only)\nx')).toBe('Body');
  });

  it('keeps everything when there is no appendix', () => {
    const doc = '# Doc\n\nWe traced the source of the data.';
    expect(stripProvenanceAppendix(doc)).toBe(doc);
  });

  it('ignores the words outside a heading', () => {
    const doc = 'Body mentions provenance and a source trace inline.';
    expect(stripProvenanceAppendix(doc)).toBe(doc);
  });

  it('returns empty when the document is only the appendix', () => {
    expect(stripProvenanceAppendix('## Source Trace\nx')).toBe('');
  });
});

describe('listWikiPathways', () => {
  it('lists every curated pathway with category and frontmatter metadata', async () => {
    const list = await listWikiPathways();
    expect(list.map((p) => p.slug)).toEqual(indexListedSlugs());
    const maha = list.find((p) => p.slug === 'mahavistaar')!;
    expect(maha).toMatchObject({
      title: 'MahaVISTAAR',
      category: 'Voice AI',
      sector: 'Agriculture',
      stage: 'Scale',
      timestamp: '2026-08-31',
    });
    expect(maha.description).toMatch(/^Maharashtra/);
    expect(list.find((p) => p.slug === 'data-dhara')?.category).toBe('Data Infrastructure');
  });

  it('never files anything under the top "Pathways" heading', async () => {
    const list = await listWikiPathways();
    expect(list.every((p) => p.category && p.category !== 'Pathways')).toBe(true);
  });

  it('leaves sector undefined where the file has none', async () => {
    const list = await listWikiPathways();
    expect(list.find((p) => p.slug === 'data-dhara')?.sector).toBeUndefined();
  });

  it('does not list unpublished drafts', async () => {
    const slugs = (await listWikiPathways()).map((p) => p.slug);
    for (const draft of uncuratedDraftSlugs()) expect(slugs).not.toContain(draft);
  });

  it('appends published community pathways, newest first, sector null → undefined', async () => {
    published(() => ({
      data: [
        { slug: 'pub-a', title: 'A', description: 'da', category: 'Community', sector: 'Health' },
        { slug: 'pub-b', title: 'B', description: 'db', category: 'Community', sector: null },
      ],
    }));
    const list = await listWikiPathways();
    expect(list.slice(-2)).toEqual([
      { slug: 'pub-a', title: 'A', description: 'da', category: 'Community', sector: 'Health' },
      { slug: 'pub-b', title: 'B', description: 'db', category: 'Community', sector: undefined },
    ]);
    const [op] = session.ops('published_pathways', 'select');
    expect(op.filters).toContainEqual(['order', 'created_at', { ascending: false }]);
  });

  it('still lists the curated corpus when the published query fails', async () => {
    published(() => ({ error: { message: 'down' } }));
    expect((await listWikiPathways()).length).toBe(indexListedSlugs().length);
  });
});

describe('getWikiStats', () => {
  it('counts every pathway and lists unique real sectors (no Cross-Sector, no blanks)', async () => {
    published(() => ({
      data: [
        { slug: 'p1', title: 'x', description: '', category: '', sector: 'Agriculture' },
        { slug: 'p2', title: 'x', description: '', category: '', sector: 'Health' },
        { slug: 'p3', title: 'x', description: '', category: '', sector: 'Cross-Sector' },
        { slug: 'p4', title: 'x', description: '', category: '', sector: null },
      ],
    }));
    const stats = await getWikiStats();
    expect(stats.total).toBe(indexListedSlugs().length + 4);
    expect(stats.sectors).not.toContain('Cross-Sector');
    expect(stats.sectors).toContain('Agriculture');
    expect(stats.sectors).toContain('Livelihoods');
    expect(stats.sectors).toContain('Health');
    expect(new Set(stats.sectors).size).toBe(stats.sectors.length);
    expect(stats.sectors.every(Boolean)).toBe(true);
  });
});

describe('getWikiPathway', () => {
  it('serves a curated pathway from disk: title from frontmatter, frontmatter and Source Trace removed', async () => {
    const page = await getWikiPathway('blue-dots');
    expect(page?.title).toBe('Blue Dots — Local Job, Talent, and Service Discovery');
    expect(page?.content.startsWith('---')).toBe(false);
    expect(page?.content).not.toMatch(/^#+\s*Source Trace/m);
    expect(readPathwayFile('blue-dots')).toMatch(/^#+\s*Source Trace/m); // the file itself has one
    expect(session.ops('published_pathways')).toHaveLength(0);
  });

  it.each([
    ['traversal', '../../etc/passwd'],
    ['traversal to framework', '../framework'],
    ['encoded-ish', '..%2Fsecret'],
    ['uppercase', 'MahaVISTAAR'],
    ['with extension', 'mahavistaar.md'],
    ['empty', ''],
    ['slash', 'pathways/blue-dots'],
  ])('returns null for an invalid slug (%s) without any lookup', async (_label, slug) => {
    expect(await getWikiPathway(slug)).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('never serves an unlisted draft from disk — falls back to published_pathways', async () => {
    const drafts = uncuratedDraftSlugs();
    expect(drafts.length).toBeGreaterThan(0);
    for (const draft of drafts) {
      published(() => ({ data: null }));
      expect(await getWikiPathway(draft)).toBeNull();
      const [op] = session.ops('published_pathways', 'select');
      expect(op.filters).toEqual([['eq', 'slug', draft]]);
      expect(op.single).toBe('maybeSingle');
    }
  });

  it('serves a published community pathway, stripped of frontmatter and Source Trace', async () => {
    published(() => ({
      data: { title: 'Community Pathway', content: '---\ntitle: x\n---\n# Body\n\nText\n\n## Source Trace\nprivate' },
    }));
    expect(await getWikiPathway('community-pathway')).toEqual({ title: 'Community Pathway', content: '# Body\n\nText' });
  });

  it('serves an unlisted draft slug only if published_pathways has it (DB copy, not the file)', async () => {
    const [draft] = uncuratedDraftSlugs();
    published(() => ({ data: { title: 'Published copy', content: 'DB body' } }));
    expect(await getWikiPathway(draft)).toEqual({ title: 'Published copy', content: 'DB body' });
  });

  it('returns null for an unknown slug', async () => {
    expect(await getWikiPathway('does-not-exist')).toBeNull();
  });

  it('returns null when the published lookup errors', async () => {
    published(() => ({ error: { message: 'down' } }));
    expect(await getWikiPathway('does-not-exist')).toBeNull();
  });
});
