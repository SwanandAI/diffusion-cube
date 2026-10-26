// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { createSupabaseMock, type QueryOp, type SupabaseMock } from '../../helpers/supabase-mock';
import { indexListedSlugs, readPathwayFile, uncuratedDraftSlugs } from '../../helpers/server-corpus';
import { NotFoundError } from '../../helpers/pages-server-mocks';

vi.mock('next/navigation', async () => (await import('../../helpers/pages-server-mocks')).navigationModule());
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
// Real implementation by default; individual tests override listWikiPathways
// once (restoreMocks puts the real one back afterwards).
vi.mock('@/lib/wiki-content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wiki-content')>();
  return { ...actual, listWikiPathways: vi.fn(actual.listWikiPathways) };
});

import { createClient } from '@/lib/supabase/server';
import { listWikiPathways } from '@/lib/wiki-content';
import WikiIndexPage from '@/app/(app)/wiki/page';
import WikiPathwayPage from '@/app/(app)/wiki/[slug]/page';

let sb: SupabaseMock;

function publishedTable(handler: (op: QueryOp) => { data?: unknown; error?: { message: string } | null }) {
  sb = createSupabaseMock({ user: { id: 'u1' }, tables: { published_pathways: handler } });
  vi.mocked(createClient).mockResolvedValue(sb.client);
}

beforeEach(() => publishedTable(() => ({ data: null })));

function frontmatterField(raw: string, field: string): string {
  return raw.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? '';
}

describe('app/(app)/wiki/page.tsx (index)', () => {
  it('lists every curated pathway as a link to /wiki/<slug>', async () => {
    render(await WikiIndexPage());
    expect(screen.getByRole('heading', { level: 1, name: 'The Wiki' })).toBeInTheDocument();
    const slugs = indexListedSlugs();
    expect(slugs.length).toBeGreaterThan(0);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(slugs.map((s) => `/wiki/${s}`));
  });

  it('groups pathways under their index.md category headings, in index order', async () => {
    render(await WikiIndexPage());
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toBe('Voice AI');
    expect(headings).toContain('Data Infrastructure');
    expect(new Set(headings).size).toBe(headings.length); // one section per category
    const voice = screen.getByRole('heading', { level: 2, name: 'Voice AI' }).parentElement!;
    expect(within(voice).getByRole('link', { name: /MahaVISTAAR/ })).toHaveAttribute('href', '/wiki/mahavistaar');
  });

  it('never lists an uncurated draft from the folder', async () => {
    render(await WikiIndexPage());
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    for (const draft of uncuratedDraftSlugs()) expect(hrefs).not.toContain(`/wiki/${draft}`);
  });

  it('appends community-published pathways under their own category, or alongside a matching static one', async () => {
    publishedTable(() => ({
      data: [
        { slug: 'community-one', title: 'Community One', description: 'From the field.', category: 'From Adopters', sector: null },
        { slug: 'voice-extra', title: 'Voice Extra', description: 'More voice.', category: 'Voice AI', sector: 'Health' },
      ],
    }));
    render(await WikiIndexPage());
    const adopters = screen.getByRole('heading', { level: 2, name: 'From Adopters' }).parentElement!;
    expect(within(adopters).getByRole('link', { name: /Community One/ })).toHaveAttribute('href', '/wiki/community-one');
    expect(within(adopters).getByText('From the field.')).toBeInTheDocument();
    const voice = screen.getByRole('heading', { level: 2, name: 'Voice AI' }).parentElement!;
    expect(within(voice).getByRole('link', { name: /Voice Extra/ })).toHaveAttribute('href', '/wiki/voice-extra');
    expect(screen.getAllByRole('heading', { level: 2, name: 'Voice AI' })).toHaveLength(1);
  });

  it('still lists the curated corpus when the published_pathways query errors', async () => {
    publishedTable(() => ({ error: { message: 'db down' } }));
    render(await WikiIndexPage());
    expect(screen.getAllByRole('link')).toHaveLength(indexListedSlugs().length);
  });

  it('shows "No pathways found." when there are none at all', async () => {
    vi.mocked(listWikiPathways).mockResolvedValueOnce([]);
    render(await WikiIndexPage());
    expect(screen.getByText('No pathways found.')).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
  });
});

function pageProps(slug: string, search: { from?: string; designId?: string } = {}) {
  return { params: Promise.resolve({ slug }), searchParams: Promise.resolve(search) };
}

describe('app/(app)/wiki/[slug]/page.tsx', () => {
  const curated = 'bhili-language-enablement';

  it('renders a curated pathway without its frontmatter or Source Trace appendix', async () => {
    expect(indexListedSlugs()).toContain(curated);
    const raw = readPathwayFile(curated);
    render(await WikiPathwayPage(pageProps(curated)));
    expect(screen.getByRole('heading', { name: '0. Reading Guide' })).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    expect(text).not.toContain(`contributor: ${frontmatterField(raw, 'contributor')}`);
    expect(text).not.toMatch(/Source Trace|Provenance/i);
    // Static files are read from disk, never looked up in Supabase.
    expect(sb.ops('published_pathways')).toHaveLength(0);
  });

  it('every index-listed slug resolves', async () => {
    for (const slug of indexListedSlugs()) {
      await expect(WikiPathwayPage(pageProps(slug))).resolves.toBeTruthy();
    }
  });

  it('back link defaults to the wiki index', async () => {
    render(await WikiPathwayPage(pageProps(curated)));
    expect(screen.getByRole('link', { name: '← The Wiki' })).toHaveAttribute('href', '/wiki');
  });

  it('back link returns to the specific Contribute chat with from=contribute&designId', async () => {
    render(await WikiPathwayPage(pageProps(curated, { from: 'contribute', designId: 'd-42' })));
    expect(screen.getByRole('link', { name: '← Back to Contributions' })).toHaveAttribute('href', '/contribute?open=d-42');
  });

  it('back link goes to the Contribute grid with from=contribute and no designId', async () => {
    render(await WikiPathwayPage(pageProps(curated, { from: 'contribute' })));
    expect(screen.getByRole('link', { name: '← Back to Contributions' })).toHaveAttribute('href', '/contribute');
  });

  it('ignores designId and any other from value', async () => {
    render(await WikiPathwayPage(pageProps(curated, { from: 'analyse', designId: 'd-42' })));
    expect(screen.getByRole('link', { name: '← The Wiki' })).toHaveAttribute('href', '/wiki');
  });

  it('renders a community-published pathway from Supabase, appendix stripped', async () => {
    publishedTable((op) =>
      op.filters.some((f) => f[0] === 'eq' && f[1] === 'slug' && f[2] === 'community-one')
        ? {
            data: {
              title: 'Community One',
              content: '---\ntitle: Community One\n---\n# Community One\n\nBody text here.\n\n## Source Trace\nsecret notes',
            },
          }
        : { data: null }
    );
    render(await WikiPathwayPage(pageProps('community-one')));
    expect(screen.getByRole('heading', { name: 'Community One' })).toBeInTheDocument();
    expect(screen.getByText('Body text here.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('secret notes');
    expect(sb.ops('published_pathways')[0].single).toBe('maybeSingle');
  });

  it('404s an unknown slug that is not published either', async () => {
    await expect(WikiPathwayPage(pageProps('no-such-pathway'))).rejects.toBeInstanceOf(NotFoundError);
    expect(sb.ops('published_pathways')).toHaveLength(1);
  });

  it('404s an assembled-but-unpublished draft sitting in the folder', async () => {
    const drafts = uncuratedDraftSlugs();
    if (drafts.length === 0) return; // nothing uncurated committed right now
    for (const draft of drafts) {
      await expect(WikiPathwayPage(pageProps(draft))).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it('404s a path-traversal slug without touching disk or Supabase', async () => {
    await expect(WikiPathwayPage(pageProps('../../package'))).rejects.toBeInstanceOf(NotFoundError);
    await expect(WikiPathwayPage(pageProps('index'))).rejects.toBeInstanceOf(NotFoundError);
    expect(sb.ops('published_pathways').map((o) => o.filters)).toEqual([[['eq', 'slug', 'index']]]);
  });

  it('404s when the published_pathways lookup errors', async () => {
    publishedTable(() => ({ error: { message: 'db down' } }));
    await expect(WikiPathwayPage(pageProps('community-one'))).rejects.toBeInstanceOf(NotFoundError);
  });
});
