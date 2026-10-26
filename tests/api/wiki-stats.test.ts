import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type MockResponse, type MockUser, type SupabaseMock } from '../helpers/supabase-mock';
import { rolesTable } from '../helpers/chat-session';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { GET } from '@/app/api/wiki-stats/route';

const USER: MockUser = { id: 'u1', email: 'user@example.com' };
const CURATED_COUNT = 8;

let session: SupabaseMock;

function signIn(user: MockUser | null, roles: string[], published: MockResponse = { data: [] }) {
  session = createSupabaseMock({ user, tables: { user_roles: rolesTable(roles), published_pathways: published } });
  vi.mocked(createClient).mockResolvedValue(session.client);
}

beforeEach(() => {
  vi.mocked(createAdminClient).mockReturnValue(createSupabaseMock({ tables: { sys_errors: {} } }).client);
  signIn(USER, ['adopter']);
});

describe('GET /api/wiki-stats', () => {
  it('403s an anonymous caller (RLS returns no role rows)', async () => {
    signIn(null, []);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(session.ops('published_pathways')).toHaveLength(0);
  });

  it('403s a signed-in account with no roles', async () => {
    signIn(USER, []);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Your account is awaiting approval.' });
  });

  it.each([['adopter'], ['pathway_contributor'], ['admin']])('serves any role (%s)', async (role) => {
    signIn(USER, [role]);
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('counts curated + published pathways and lists unique real sectors', async () => {
    signIn(USER, ['adopter'], {
      data: [
        { slug: 'c1', title: 'C1', description: '', category: 'X', sector: 'Zeta Sector' },
        { slug: 'c2', title: 'C2', description: '', category: 'X', sector: 'Zeta Sector' },
        { slug: 'c3', title: 'C3', description: '', category: 'X', sector: 'Cross-Sector' },
        { slug: 'c4', title: 'C4', description: '', category: 'X', sector: null },
      ],
    });
    const res = await GET();
    const body = (await res.json()) as { total: number; sectors: string[] };
    expect(body.total).toBe(CURATED_COUNT + 4);
    expect(body.sectors).toContain('Zeta Sector');
    expect(body.sectors).not.toContain('Cross-Sector');
    expect(new Set(body.sectors).size).toBe(body.sectors.length);
    expect(body.sectors.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
  });
});
