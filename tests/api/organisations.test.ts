import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createSupabaseMock, type MockResponse, type SupabaseMock } from '../helpers/supabase-mock';
import { getRequest } from '../helpers/request';
import { routeOps, sessionMock } from '../helpers/routes-auth';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { GET } from '@/app/api/organisations/route';

const ORGS = [
  { id: 'o1', name: 'Agri Dept', canonical_role: 'Program Owner', url: 'https://agri.example' },
  { id: 'o2', name: 'Agri Labs', canonical_role: null, url: null },
];

let admin: SupabaseMock;

function get(query = '') {
  return GET(new NextRequest(getRequest(`http://localhost/api/organisations${query}`)));
}

function signIn(user: { id: string; email: string } | null, roles: string[] = []) {
  vi.mocked(createClient).mockResolvedValue(sessionMock(user, roles).client);
}

function useAdmin(orgs: MockResponse = { data: ORGS }) {
  admin = createSupabaseMock({ tables: { organisations: orgs } });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

beforeEach(() => useAdmin());

describe('GET /api/organisations', () => {
  it('401s an anonymous caller without querying', async () => {
    signIn(null);
    const res = await get('?q=agri');
    expect(res.status).toBe(401);
    expect(routeOps(admin)).toHaveLength(0);
  });

  it('401s a signed-in account holding no role at all', async () => {
    signIn({ id: 'u1', email: 'x@example.com' }, []);
    const res = await get('?q=agri');
    expect(res.status).toBe(401);
    expect(routeOps(admin)).toHaveLength(0);
  });

  it.each([[['adopter']], [['pathway_contributor']], [['admin']]])('serves an account holding %j', async (roles) => {
    signIn({ id: 'u1', email: 'x@example.com' }, roles);
    const res = await get('?q=agri');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ORGS);
  });

  it('searches by substring, sorted by name, capped at 10', async () => {
    signIn({ id: 'u1', email: 'x@example.com' }, ['adopter']);
    await get('?q=Agri');
    const [op] = admin.ops('organisations', 'select');
    expect(op.columns).toBe('id, name, canonical_role, url');
    expect(op.filters).toEqual([
      ['ilike', 'name', '%Agri%'],
      ['order', 'name', { ascending: true }],
      ['limit', 10],
    ]);
  });

  it('treats a missing q as an empty search', async () => {
    signIn({ id: 'u1', email: 'x@example.com' }, ['adopter']);
    const res = await get();
    expect(res.status).toBe(200);
    expect(admin.ops('organisations', 'select')[0].filters[0]).toEqual(['ilike', 'name', '%%']);
  });

  it('passes an injection-looking query only as the ilike value', async () => {
    signIn({ id: 'u1', email: 'x@example.com' }, ['adopter']);
    const q = "x'),name.neq.(";
    const res = await get(`?q=${encodeURIComponent(q)}`);
    expect(res.status).toBe(200);
    expect(admin.ops('organisations', 'select')[0].filters[0]).toEqual(['ilike', 'name', `%${q}%`]);
  });

  it('500s with the generic message (not an empty list) when the lookup fails', async () => {
    signIn({ id: 'u1', email: 'x@example.com' }, ['adopter']);
    useAdmin({ error: { message: 'relation "organisations" does not exist' } });
    const res = await get('?q=a');
    expect(res.status).toBe(500);
    expect((await res.json()).error).not.toContain('relation');
  });
});
