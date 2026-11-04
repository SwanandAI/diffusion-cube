import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/pathway-store', () => ({ listPublished: vi.fn(), getPublishedDocument: vi.fn() }));

import { getPublishedDocument, listPublished, type PublishedCard } from '@/lib/pathway-store';
import { getWikiPathway, getWikiStats, listWikiPathways, stripProvenanceAppendix } from '@/lib/wiki-content';

// /wiki reads only published pathways from the app's store
// (docs/features/pathway-storage/) — nothing from disk.

const card = (over: Partial<PublishedCard>): PublishedCard => ({
  slug: 's', title: 'T', description: 'd', category: 'Community', sector: '', stage: '', location: '', tags: [],
  contributor_org: null, created_at: '2026-01-01T00:00:00Z', ...over,
});

beforeEach(() => {
  vi.mocked(listPublished).mockReset();
  vi.mocked(getPublishedDocument).mockReset();
});

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
  it('lists every published pathway with its card fields', async () => {
    vi.mocked(listPublished).mockResolvedValue([
      card({ slug: 'maha', title: 'MahaVISTAAR', description: 'Voice line', category: 'Voice AI · Agri', sector: 'Agriculture', stage: 'Scale', contributor_org: 'Org M' }),
      card({ slug: 'x', title: 'X' }),
    ]);
    const list = await listWikiPathways();
    expect(list.map((p) => p.slug)).toEqual(['maha', 'x']);
    expect(list[0]).toEqual({
      slug: 'maha', title: 'MahaVISTAAR', description: 'Voice line', category: 'Voice AI · Agri', sector: 'Agriculture',
      stage: 'Scale', timestamp: '2026-01-01T00:00:00Z', contributor: 'Org M',
    });
    // Blank sector / stage / contributor → undefined.
    expect(list[1]).toMatchObject({ sector: undefined, stage: undefined, contributor: undefined });
  });

  it('is empty when nothing is published', async () => {
    vi.mocked(listPublished).mockResolvedValue([]);
    expect(await listWikiPathways()).toEqual([]);
  });
});

describe('getWikiStats', () => {
  it('counts every pathway and lists unique real sectors (no Cross-Sector, no blanks)', async () => {
    vi.mocked(listPublished).mockResolvedValue([
      card({ slug: 'a', sector: 'Health' }),
      card({ slug: 'b', sector: 'Health' }),
      card({ slug: 'c', sector: 'Cross-Sector' }),
      card({ slug: 'd', sector: '' }),
      card({ slug: 'e', sector: 'Agriculture' }),
    ]);
    expect(await getWikiStats()).toEqual({ total: 5, sectors: ['Health', 'Agriculture'] });
  });
});

describe('getWikiPathway', () => {
  it('serves a published pathway, stripped of frontmatter and Source Trace', async () => {
    vi.mocked(getPublishedDocument).mockResolvedValue({
      slug: 'maha', title: 'MahaVISTAAR', contributor_org: null, created_at: '2026-01-01',
      content: '---\ntitle: MahaVISTAAR\n---\n# MahaVISTAAR\n\nBody.\n\n## Source Trace\n\nsecret.pdf',
    });
    expect(await getWikiPathway('maha')).toEqual({ title: 'MahaVISTAAR', content: '# MahaVISTAAR\n\nBody.' });
    expect(getPublishedDocument).toHaveBeenCalledWith('maha');
  });

  it('returns null for a slug that is not published (draft, retired or unknown)', async () => {
    vi.mocked(getPublishedDocument).mockResolvedValue(null);
    expect(await getWikiPathway('nope')).toBeNull();
  });

  it('never looks up a malformed slug', async () => {
    expect(await getWikiPathway('../../x')).toBeNull();
    expect(getPublishedDocument).not.toHaveBeenCalled();
  });

  it('lets a database error through (the page shows the generic error)', async () => {
    vi.mocked(getPublishedDocument).mockRejectedValue(new Error('connection refused'));
    await expect(getWikiPathway('maha')).rejects.toThrow('connection refused');
  });
});
