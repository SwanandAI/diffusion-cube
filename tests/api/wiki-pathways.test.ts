import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type MockResponse, type SupabaseMock } from '../helpers/supabase-mock';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { GET } from '@/app/api/wiki-pathways/route';

// The curated corpus: exactly what content/wiki/pathways/index.md lists.
const CURATED = [
  'african-voice-ai',
  'bhili-language-enablement',
  'blue-dots',
  'ceew-climate-intelligence',
  'data-dhara',
  'mahavistaar',
  'voice-ai-adoption-barriers',
  'voice-ai-for-inclusion',
];
const KEYS = ['slug', 'title', 'description', 'sector', 'stage', 'timestamp', 'contributor'];

let session: SupabaseMock;

function withPublished(published: MockResponse) {
  session = createSupabaseMock({ user: null, tables: { published_pathways: published } });
  vi.mocked(createClient).mockResolvedValue(session.client);
}

beforeEach(() => {
  vi.mocked(createAdminClient).mockReturnValue(createSupabaseMock().client);
  withPublished({ data: [] });
});

describe('GET /api/wiki-pathways (public)', () => {
  it('lists every curated pathway to an anonymous caller', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>[];
    expect(body.map((p) => p.slug).sort()).toEqual(CURATED);
  });

  it('exposes only the summary fields — no category, content or other columns', async () => {
    withPublished({
      data: [{ slug: 'community-x', title: 'Community X', description: 'Desc', category: 'Health', sector: 'Health', content: 'FULL BODY' }],
    });
    const body = (await (await GET()).json()) as Record<string, unknown>[];
    for (const entry of body) {
      expect(Object.keys(entry).every((k) => KEYS.includes(k))).toBe(true);
    }
    expect(JSON.stringify(body)).not.toContain('FULL BODY');
  });

  it("reads each curated pathway's frontmatter", async () => {
    const body = (await (await GET()).json()) as Record<string, unknown>[];
    const maha = body.find((p) => p.slug === 'mahavistaar');
    expect(maha).toMatchObject({ slug: 'mahavistaar', title: 'MahaVISTAAR' });
    expect(typeof maha?.sector).toBe('string');
    expect(typeof maha?.description).toBe('string');
  });

  it('appends community-published pathways, newest first', async () => {
    withPublished({
      data: [
        { slug: 'community-b', title: 'B', description: 'b', category: 'X', sector: 'Health' },
        { slug: 'community-a', title: 'A', description: 'a', category: 'X', sector: null },
      ],
    });
    const body = (await (await GET()).json()) as Record<string, unknown>[];
    expect(body.slice(-2)).toEqual([
      { slug: 'community-b', title: 'B', description: 'b', sector: 'Health' },
      { slug: 'community-a', title: 'A', description: 'a' },
    ]);
    const [op] = session.ops('published_pathways', 'select');
    expect(op.filters).toEqual([['order', 'created_at', { ascending: false }]]);
  });

  it('never lists an assembled-but-unpublished draft sitting in the pathways folder', async () => {
    const body = (await (await GET()).json()) as Record<string, unknown>[];
    expect(body.map((p) => p.slug)).not.toContain('citizen-help');
    expect(body.map((p) => p.slug)).not.toContain('index');
  });

  it('still serves the curated list when published_pathways fails', async () => {
    withPublished({ error: { message: 'connection terminated' } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(((await res.json()) as unknown[]).length).toBe(CURATED.length);
  });
});
