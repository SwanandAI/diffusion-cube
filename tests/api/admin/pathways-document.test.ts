import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type SupabaseMock, type TableHandler } from '../../helpers/supabase-mock';
import { getRequest } from '../../helpers/request';
import { routeOps, sessionMock } from '../../helpers/routes-auth';
import { eqValue } from '../../helpers/chat-session';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { GENERIC_ERROR_MESSAGE } from '@/lib/error-messages';
import { GET } from '@/app/api/admin/pathways/document/route';

const URL = 'http://localhost/api/admin/pathways/document';
const DOC = '# Kisan Voice\n\nUnder review.';

let admin: SupabaseMock;

function signInAs(email: string | null, roles: string[] = []) {
  const sb = email === null ? sessionMock(null) : sessionMock({ id: 'caller', email }, roles);
  vi.mocked(createClient).mockResolvedValue(sb.client);
}

function useAdmin(pathways: TableHandler = { data: { content_cache: DOC } }) {
  admin = createSupabaseMock({ tables: { pathways, sys_errors: {} } });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

const get = (query = '?pathway_id=p1') => GET(new NextRequest(getRequest(`${URL}${query}`)));

beforeEach(() => useAdmin());

describe('GET /api/admin/pathways/document', () => {
  it('403s an anonymous caller without reading anything', async () => {
    signInAs(null);
    const res = await get();
    expect(res.status).toBe(403);
    expect(routeOps(admin)).toHaveLength(0);
  });

  // The unpublished document is exactly what migration 0040 hides from
  // everyone but the pathway's members and admins.
  it.each([[[]], [['adopter']], [['adopter', 'pathway_contributor']]])(
    '403s a signed-in non-admin holding %j',
    async (roles) => {
      signInAs('someone@example.com', roles);
      const res = await get();
      expect(res.status).toBe(403);
      expect(routeOps(admin)).toHaveLength(0);
    }
  );

  it('serves an ADMIN_EMAILS admin, who has no role row for RLS to see', async () => {
    signInAs('env-admin@example.com');
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ content: DOC });
  });

  it('serves an admin role holder', async () => {
    signInAs('db-admin@example.com', ['admin']);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ content: DOC });
  });

  it('reads only content_cache, for the requested pathway', async () => {
    signInAs('env-admin@example.com');
    await get('?pathway_id=pw-42');
    const [op] = admin.ops('pathways', 'select');
    expect(op.columns).toBe('content_cache');
    expect(eqValue(op.filters, 'id')).toBe('pw-42');
  });

  it('answers an empty string for a pathway with no assembled document', async () => {
    signInAs('env-admin@example.com');
    useAdmin({ data: { content_cache: null } });
    const res = await get();
    expect(await res.json()).toEqual({ content: '' });
  });

  it.each([['missing', ''], ['empty', '?pathway_id=']])('400s a %s pathway_id', async (_label, query) => {
    signInAs('env-admin@example.com');
    const res = await get(query);
    expect(res.status).toBe(400);
    expect(routeOps(admin)).toHaveLength(0);
  });

  it('404s an unknown pathway', async () => {
    signInAs('env-admin@example.com');
    useAdmin({ data: null });
    const res = await get('?pathway_id=nope');
    expect(res.status).toBe(404);
  });

  it('hides a database error behind the generic 500', async () => {
    signInAs('env-admin@example.com');
    useAdmin({ error: { message: 'relation "pathways" does not exist' } });
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: GENERIC_ERROR_MESSAGE });
  });
});
