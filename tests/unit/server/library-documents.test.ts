import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type MockResponse, type SupabaseMock } from '../../helpers/supabase-mock';
import { indexListedSlugs, readPathwayFile, uncuratedDraftSlugs } from '../../helpers/server-corpus';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { libraryPathways } from '@/lib/library-pathways';
import {
  buildLibraryOverview,
  libraryDocumentFromPublished,
  readLibraryPathwayDocument,
} from '@/lib/library-documents';

let admin: SupabaseMock;

function published(response: MockResponse) {
  admin = createSupabaseMock({ tables: { published_pathways: response } });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

beforeEach(() => published({ data: [] }));

describe('readLibraryPathwayDocument', () => {
  it('returns a curated document with the Source Trace appendix removed', async () => {
    const doc = await readLibraryPathwayDocument('mahavistaar');
    expect(doc).not.toBeNull();
    expect(doc).toContain('title: MahaVISTAAR');
    expect(doc).not.toMatch(/^#+\s*Source Trace/m);
    expect(readPathwayFile('mahavistaar')).toMatch(/^#+\s*Source Trace/m);
    expect(readPathwayFile('mahavistaar').startsWith(doc!.slice(0, 200))).toBe(true);
  });

  it('serves every curated slug', async () => {
    for (const slug of indexListedSlugs()) expect(await readLibraryPathwayDocument(slug)).toBeTruthy();
  });

  it('returns null for an unlisted draft in the same folder (caller falls back to published_pathways)', async () => {
    for (const draft of uncuratedDraftSlugs()) expect(await readLibraryPathwayDocument(draft)).toBeNull();
  });

  it.each(['../../etc/passwd', '../framework', 'index', 'MAHAVISTAAR', 'mahavistaar.md', ''])(
    'returns null for %j',
    async (id) => {
      expect(await readLibraryPathwayDocument(id)).toBeNull();
    }
  );

  it('returns null for an unknown slug', async () => {
    expect(await readLibraryPathwayDocument('nope')).toBeNull();
  });
});

describe('libraryDocumentFromPublished', () => {
  it('strips the Source Trace appendix', () => {
    expect(libraryDocumentFromPublished('# P\n\nBody\n\n## Source Trace\nx')).toBe('# P\n\nBody');
  });

  it('leaves a document without an appendix as is', () => {
    expect(libraryDocumentFromPublished('# P\n\nBody')).toBe('# P\n\nBody');
  });
});

describe('buildLibraryOverview', () => {
  it('lists each static library card with its frontmatter block when nothing is published', async () => {
    const { overview, count } = await buildLibraryOverview();
    expect(count).toBe(libraryPathways.length);
    for (const { id } of libraryPathways) expect(overview).toContain(`[${id}]\n`);
    expect(overview).toContain('[mahavistaar]\ntype: Pathway\ntitle: MahaVISTAAR');
    // Frontmatter only — no document body.
    expect(overview).not.toContain('# 0. Reading Guide');
    const [op] = admin.ops('published_pathways', 'select');
    expect(op.columns).toBe('slug, title, description, sector, stage, location, tags');
    expect(op.filters).toContainEqual(['order', 'created_at', { ascending: false }]);
  });

  it('formats published rows as frontmatter, first, and lets them override a static card of the same slug', async () => {
    published({
      data: [
        {
          slug: 'mahavistaar',
          title: 'MahaVISTAAR (updated)',
          description: 'New desc',
          sector: 'Agriculture',
          stage: 'Scale',
          location: 'Maharashtra',
          tags: ['Voice AI', 'Agri'],
        },
        { slug: 'community-x', title: 'X', description: null, sector: null, stage: null, location: null, tags: [] },
      ],
    });
    const { overview, count } = await buildLibraryOverview();
    // mahavistaar is counted once, not as both a static and a published card.
    expect(count).toBe(libraryPathways.length + 1);
    expect(overview.startsWith('[mahavistaar]\ntitle: MahaVISTAAR (updated)\n')).toBe(true);
    expect(overview).toContain(
      '[mahavistaar]\ntitle: MahaVISTAAR (updated)\ndescription: New desc\nsector: Agriculture\nstage: Scale\nlocation: Maharashtra\ntags: [Voice AI, Agri]'
    );
    expect(overview).toContain('[community-x]\ntitle: X\n\n');
    expect(overview.match(/\[mahavistaar\]/g)).toHaveLength(1);
    expect(overview).not.toContain('title: MahaVISTAAR\n');
  });

  it('falls back to the static cards when the published query fails', async () => {
    published({ error: { message: 'down' } });
    const { overview } = await buildLibraryOverview();
    for (const { id } of libraryPathways) expect(overview).toContain(`[${id}]`);
  });

  it('never includes a Source Trace appendix', async () => {
    expect((await buildLibraryOverview()).overview).not.toMatch(/Source Trace/);
  });
});
