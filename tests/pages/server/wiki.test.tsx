// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { NotFoundError } from '../../helpers/pages-server-mocks';

vi.mock('next/navigation', async () => (await import('../../helpers/pages-server-mocks')).navigationModule());
// /wiki reads published pathways from the app's store
// (docs/features/pathway-storage/) — nothing from disk.
vi.mock('@/lib/pathway-store', () => ({ listPublished: vi.fn(), getPublishedDocument: vi.fn() }));

import { getPublishedDocument, listPublished, type PublishedCard } from '@/lib/pathway-store';
import WikiIndexPage from '@/app/(app)/wiki/page';
import WikiPathwayPage from '@/app/(app)/wiki/[slug]/page';

const card = (over: Partial<PublishedCard>): PublishedCard => ({
  slug: 's', title: 'T', description: '', category: 'Community', sector: '', stage: '', location: '', tags: [],
  contributor_org: null, created_at: '2026-01-01', ...over,
});

const PATHWAY = 'bhili-language-enablement';
const DOC = {
  slug: PATHWAY,
  title: 'Bhili Language Enablement',
  contributor_org: 'Org B',
  created_at: '2026-01-01',
  content:
    '---\ntitle: Bhili Language Enablement\ncontributor: Org B\n---\n## 0. Reading Guide\n\nBody text here.\n\n## Source Trace\n\nsecret notes',
};

beforeEach(() => {
  vi.mocked(listPublished).mockReset();
  vi.mocked(listPublished).mockResolvedValue([
    card({ slug: 'mahavistaar', title: 'MahaVISTAAR', description: 'Voice line.', category: 'Voice AI · Agri' }),
    card({ slug: 'community-one', title: 'Community One', description: 'From the field.', category: 'Community' }),
    card({ slug: 'voice-extra', title: 'Voice Extra', description: 'More voice.', category: 'Voice AI · Agri' }),
  ]);
  vi.mocked(getPublishedDocument).mockReset();
  vi.mocked(getPublishedDocument).mockImplementation(async (slug: string) => (slug === PATHWAY ? DOC : null));
});

describe('app/(app)/wiki/page.tsx (index)', () => {
  it('lists every published pathway as a link to /wiki/<slug>', async () => {
    render(await WikiIndexPage());
    expect(screen.getByRole('heading', { level: 1, name: 'The Wiki' })).toBeInTheDocument();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs.sort()).toEqual(['/wiki/community-one', '/wiki/mahavistaar', '/wiki/voice-extra']);
  });

  it('groups pathways under their category, one section each', async () => {
    render(await WikiIndexPage());
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Voice AI · Agri', 'Community']);
    const voice = screen.getByRole('heading', { level: 2, name: 'Voice AI · Agri' }).parentElement!;
    expect(within(voice).getByRole('link', { name: /MahaVISTAAR/ })).toHaveAttribute('href', '/wiki/mahavistaar');
    expect(within(voice).getByRole('link', { name: /Voice Extra/ })).toHaveAttribute('href', '/wiki/voice-extra');
    const community = screen.getByRole('heading', { level: 2, name: 'Community' }).parentElement!;
    expect(within(community).getByText('From the field.')).toBeInTheDocument();
  });

  it('shows "No pathways found." when nothing is published', async () => {
    vi.mocked(listPublished).mockResolvedValue([]);
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
  const curated = PATHWAY;

  it('renders a published pathway without its frontmatter or Source Trace appendix', async () => {
    render(await WikiPathwayPage(pageProps(PATHWAY)));
    expect(screen.getByRole('heading', { name: '0. Reading Guide' })).toBeInTheDocument();
    expect(screen.getByText('Body text here.')).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('contributor: Org B');
    expect(text).not.toMatch(/Source Trace|secret notes/i);
    expect(getPublishedDocument).toHaveBeenCalledWith(PATHWAY);
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

  it('404s a slug that is not published (draft, retired or unknown)', async () => {
    await expect(WikiPathwayPage(pageProps('no-such-pathway'))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404s a path-traversal slug without a lookup', async () => {
    await expect(WikiPathwayPage(pageProps('../../package'))).rejects.toBeInstanceOf(NotFoundError);
    expect(getPublishedDocument).not.toHaveBeenCalled();
  });

  it('lets a database error through to the error page instead of a 404', async () => {
    vi.mocked(getPublishedDocument).mockRejectedValue(new Error('db down'));
    await expect(WikiPathwayPage(pageProps(PATHWAY))).rejects.toThrow('db down');
  });
});
