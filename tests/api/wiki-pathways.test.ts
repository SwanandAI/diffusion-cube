import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type MockResponse, type SupabaseMock } from '../helpers/supabase-mock';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { GENERIC_ERROR_MESSAGE } from '@/lib/error-messages';
import { GET } from '@/app/api/wiki-pathways/route';

// Every published pathway, from the app's store (the published_pathways view,
// read with the service role — docs/features/pathway-storage/).
const KEYS = ['slug', 'title', 'description', 'sector', 'stage', 'timestamp', 'contributor'];

let admin: SupabaseMock;

function withPublished(published: MockResponse) {
  admin = createSupabaseMock({ tables: { published_pathways: published, sys_errors: {} } });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

beforeEach(() => withPublished({ data: [] }));

describe('GET /api/wiki-pathways (public)', () => {
  it('lists every published pathway to an anonymous caller, newest first', async () => {
    withPublished({
      data: [
        { slug: 'community-b', title: 'B', description: 'b', category: 'X', sector: 'Health', stage: 'Pilot', tags: [], contributor_org: 'Org B', created_at: '2026-02-01' },
        { slug: 'community-a', title: 'A', description: 'a', category: 'X', sector: null, stage: null, tags: null, contributor_org: null, created_at: '2026-01-01' },
      ],
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { slug: 'community-b', title: 'B', description: 'b', sector: 'Health', stage: 'Pilot', timestamp: '2026-02-01', contributor: 'Org B' },
      { slug: 'community-a', title: 'A', description: 'a', timestamp: '2026-01-01' },
    ]);
    const [op] = admin.ops('published_pathways', 'select');
    expect(op.filters).toEqual([['order', 'created_at', { ascending: false }]]);
  });

  it('exposes only the summary fields — no category, content or other columns', async () => {
    withPublished({
      data: [{ slug: 'community-x', title: 'Community X', description: 'Desc', category: 'Health', sector: 'Health', content: 'FULL BODY', created_at: '2026-01-01' }],
    });
    const body = (await (await GET()).json()) as Record<string, unknown>[];
    for (const entry of body) {
      expect(Object.keys(entry).every((k) => KEYS.includes(k))).toBe(true);
    }
    expect(JSON.stringify(body)).not.toContain('FULL BODY');
  });

  it('is an empty list when nothing is published', async () => {
    expect(await (await GET()).json()).toEqual([]);
  });

  it('hides a database failure behind the generic 500', async () => {
    withPublished({ error: { message: 'connection terminated' } });
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: GENERIC_ERROR_MESSAGE });
  });
});
