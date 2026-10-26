import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type MockResponse, type SupabaseMock } from '../../helpers/supabase-mock';
import { indexListedSlugs, readPathwayFile, uncuratedDraftSlugs } from '../../helpers/server-corpus';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import {
  curatedPathwaySlugs,
  datedLine,
  isReservedPathwaySlug,
  loadFrameworkContent,
  loadPathwayGenerationPrompt,
  loadResourcesContent,
  loadWikiContext,
} from '@/lib/wiki-loader';

let session: SupabaseMock;

function published(response: MockResponse) {
  session = createSupabaseMock({ tables: { published_pathways: response } });
  vi.mocked(createClient).mockResolvedValue(session.client);
}

beforeEach(() => published({ data: [] }));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('curatedPathwaySlugs', () => {
  it('is exactly the list index.md links to', async () => {
    const curated = await curatedPathwaySlugs();
    expect([...curated].sort()).toEqual([...new Set(indexListedSlugs())].sort());
    expect(curated.size).toBeGreaterThan(0);
  });

  it('includes known curated pathways', async () => {
    const curated = await curatedPathwaySlugs();
    for (const slug of ['mahavistaar', 'blue-dots', 'data-dhara']) expect(curated.has(slug)).toBe(true);
  });

  it('excludes index itself and every unlisted draft file in the same folder', async () => {
    const curated = await curatedPathwaySlugs();
    expect(curated.has('index')).toBe(false);
    const drafts = uncuratedDraftSlugs();
    expect(drafts.length).toBeGreaterThan(0); // the corpus folder does hold drafts today
    for (const draft of drafts) expect(curated.has(draft)).toBe(false);
  });

  it('every curated slug has a file on disk', async () => {
    for (const slug of await curatedPathwaySlugs()) {
      expect(() => readPathwayFile(slug)).not.toThrow();
    }
  });
});

describe('isReservedPathwaySlug', () => {
  it('reserves "index"', async () => {
    expect(await isReservedPathwaySlug('index')).toBe(true);
  });

  it('reserves every curated slug', async () => {
    for (const slug of indexListedSlugs()) expect(await isReservedPathwaySlug(slug)).toBe(true);
  });

  it('does not reserve an unlisted draft slug or a fresh slug', async () => {
    for (const draft of uncuratedDraftSlugs()) expect(await isReservedPathwaySlug(draft)).toBe(false);
    expect(await isReservedPathwaySlug('brand-new-pathway')).toBe(false);
  });

  it('is exact-match (no case folding or extensions)', async () => {
    expect(await isReservedPathwaySlug('MahaVISTAAR')).toBe(false);
    expect(await isReservedPathwaySlug('mahavistaar.md')).toBe(false);
    expect(await isReservedPathwaySlug('Index')).toBe(false);
  });
});

describe('static content loaders', () => {
  it('loadFrameworkContent returns content/framework.md', async () => {
    const text = await loadFrameworkContent();
    expect(text).toBe(readFileSync(path.join(process.cwd(), 'content', 'framework.md'), 'utf-8'));
    expect(text.length).toBeGreaterThan(100);
  });

  it('loadPathwayGenerationPrompt returns content/pathway-generation-prompt.md', async () => {
    expect(await loadPathwayGenerationPrompt()).toBe(
      readFileSync(path.join(process.cwd(), 'content', 'pathway-generation-prompt.md'), 'utf-8')
    );
  });

  it('loadResourcesContent returns content/resources.md', async () => {
    expect(await loadResourcesContent()).toBe(readFileSync(path.join(process.cwd(), 'content', 'resources.md'), 'utf-8'));
  });
});

describe('datedLine', () => {
  it('uses the document’s own timestamp frontmatter', () => {
    expect(datedLine('---\ntitle: X\ntimestamp: 2026-08-31\n---\nBody', '2026-10-01T10:00:00Z')).toBe(
      'Documented as of: 2026-08-31\n\n'
    );
  });

  it('falls back to the first-published date (date part only)', () => {
    expect(datedLine('---\ntitle: X\n---\nBody', '2026-10-01T10:00:00Z')).toBe('First published: 2026-10-01\n\n');
  });

  it('is empty with neither', () => {
    expect(datedLine('Body')).toBe('');
    expect(datedLine('Body', null)).toBe('');
    expect(datedLine('Body', '')).toBe('');
  });

  it('only matches timestamp at the start of a line', () => {
    expect(datedLine('the timestamp: 2020 is inline')).toBe('');
  });
});

describe('loadWikiContext', () => {
  it('includes the index and every curated pathway with its contributor and date', async () => {
    const ctx = await loadWikiContext();
    expect(ctx.startsWith('# Pathways Index\n\n')).toBe(true);
    for (const slug of indexListedSlugs()) expect(ctx).toContain(`# Pathway: ${slug}\n\n`);
    // mahavistaar.md carries both contributor: and timestamp: frontmatter.
    expect(ctx).toContain(
      '# Pathway: mahavistaar\n\nContributed by: Department of Agriculture, Government of Maharashtra; EkStep Foundation; OpenAgriNet (OAN)\n\nDocumented as of: 2026-08-31\n\n'
    );
  });

  it('never includes an unlisted draft from the same folder', async () => {
    const ctx = await loadWikiContext();
    for (const draft of uncuratedDraftSlugs()) expect(ctx).not.toContain(`# Pathway: ${draft}\n`);
  });

  it('appends published community pathways with contributor and first-published date', async () => {
    published({
      data: [
        { slug: 'community-one', content: '---\ntitle: C1\n---\nCommunity body one', contributor_org: 'Org One', created_at: '2026-09-15T12:00:00Z' },
        { slug: 'community-two', content: '---\ntimestamp: 2025-01-01\n---\nBody two', contributor_org: null, created_at: '2026-09-16T00:00:00Z' },
      ],
    });
    const ctx = await loadWikiContext();
    expect(ctx).toContain('# Pathway: community-one\n\nContributed by: Org One\n\nFirst published: 2026-09-15\n\n---\ntitle: C1');
    expect(ctx).toContain('# Pathway: community-two\n\nDocumented as of: 2025-01-01\n\n---\ntimestamp');
    expect(ctx).not.toContain('# Pathway: community-two\n\nContributed by');
    expect(session.ops('published_pathways', 'select')[0].columns).toBe('slug, content, contributor_org, created_at');
  });

  it('separates sections with a horizontal rule', async () => {
    const ctx = await loadWikiContext();
    expect(ctx.split('\n\n---\n\n# Pathway: ').length).toBe(1 + indexListedSlugs().length);
  });

  it('still returns the curated corpus when the published query fails', async () => {
    published({ error: { message: 'down' } });
    const ctx = await loadWikiContext();
    expect(ctx).toContain('# Pathway: mahavistaar');
  });
});

describe('with a WIKI_PATH override', () => {
  let dir: string;

  async function loadWith(indexMd: string | null, files: Record<string, string> = {}) {
    dir = mkdtempSync(path.join(tmpdir(), 'wiki-loader-'));
    mkdirSync(path.join(dir, 'pathways'));
    if (indexMd !== null) writeFileSync(path.join(dir, 'pathways', 'index.md'), indexMd);
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, 'pathways', name), text);
    vi.resetModules();
    vi.stubEnv('WIKI_PATH', dir);
    return import('@/lib/wiki-loader');
  }

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('parses only lowercase slug-shaped .md links — no traversal, no index, no uppercase', async () => {
    const mod = await loadWith(
      [
        '* [Good](good-one.md) - ok',
        '* [Traversal](../secret.md) - no',
        '* [Abs](/etc/passwd.md) - no',
        '* [Upper](Upper.md) - no',
        '* [Self](index.md) - no',
        '* [Ext](not-md.txt) - no',
        '* [Two](two-2.md) - ok',
      ].join('\n')
    );
    expect([...(await mod.curatedPathwaySlugs())].sort()).toEqual(['good-one', 'two-2']);
  });

  it('a missing index means no curated slugs and an empty context', async () => {
    const mod = await loadWith(null);
    expect((await mod.curatedPathwaySlugs()).size).toBe(0);
    expect(await mod.isReservedPathwaySlug('index')).toBe(true);
    expect(await mod.loadWikiContext()).toBe('');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('skips a listed pathway whose file is missing', async () => {
    const mod = await loadWith('* [A](a.md) - x\n* [B](b.md) - y', { 'a.md': 'A body' });
    const ctx = await mod.loadWikiContext();
    expect(ctx).toContain('# Pathway: a\n\nA body');
    expect(ctx).not.toContain('# Pathway: b');
  });
});
