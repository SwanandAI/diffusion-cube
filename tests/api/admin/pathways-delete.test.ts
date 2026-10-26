import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type SupabaseMock, type TableHandler } from '../../helpers/supabase-mock';
import { jsonRequest } from '../../helpers/request';
import { routeOps, sessionMock } from '../../helpers/routes-auth';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { GENERIC_ERROR_MESSAGE } from '@/lib/error-messages';
import { POST } from '@/app/api/admin/pathways/delete/route';

const URL = 'http://localhost/api/admin/pathways/delete';

let admin: SupabaseMock;

function signInAs(email: string | null, roles: string[] = []) {
  const sb = email === null ? sessionMock(null) : sessionMock({ id: 'caller', email }, roles);
  vi.mocked(createClient).mockResolvedValue(sb.client);
}

function useAdmin(tables: Record<string, TableHandler> = {}) {
  admin = createSupabaseMock({ tables });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

beforeEach(() => {
  useAdmin({
    contribution_units: { data: [{ storage_path: 'p1/a/file.pdf' }, { storage_path: 'p1/b/deck.pptx' }] },
  });
});

describe('POST /api/admin/pathways/delete', () => {
  it('403s an anonymous caller and deletes nothing', async () => {
    signInAs(null);
    const res = await POST(jsonRequest(URL, { pathway_id: 'p1' }));
    expect(res.status).toBe(403);
    expect(routeOps(admin)).toHaveLength(0);
    expect(admin.storageBucket.remove).not.toHaveBeenCalled();
  });

  it.each([[[]], [['adopter']], [['adopter', 'pathway_contributor']]])(
    '403s a signed-in non-admin holding %j',
    async (roles) => {
      signInAs('someone@example.com', roles);
      const res = await POST(jsonRequest(URL, { pathway_id: 'p1' }));
      expect(res.status).toBe(403);
      expect(routeOps(admin)).toHaveLength(0);
    }
  );

  it('lets an ADMIN_EMAILS address in', async () => {
    signInAs('env-admin@example.com');
    const res = await POST(jsonRequest(URL, { pathway_id: 'p1' }));
    expect(res.status).toBe(200);
  });

  it('lets an admin role row in', async () => {
    signInAs('db-admin@example.com', ['admin']);
    const res = await POST(jsonRequest(URL, { pathway_id: 'p1' }));
    expect(res.status).toBe(200);
  });

  it('removes the pathway\'s toolkit asset files, then deletes the pathway row', async () => {
    signInAs('env-admin@example.com');
    const res = await POST(jsonRequest(URL, { pathway_id: 'p1' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const [assets] = admin.ops('contribution_units', 'select');
    expect(assets.columns).toBe('storage_path');
    expect(assets.filters).toEqual([
      ['eq', 'pathway_id', 'p1'],
      ['eq', 'unit_type', 'toolkit-asset'],
      ['not', 'storage_path', 'is', null],
    ]);
    expect(admin.client.storage.from).toHaveBeenCalledWith('toolkit-assets');
    expect(admin.storageBucket.remove).toHaveBeenCalledWith(['p1/a/file.pdf', 'p1/b/deck.pptx']);

    const [del] = admin.ops('pathways', 'delete');
    expect(del.filters).toEqual([['eq', 'id', 'p1']]);
    // contribution_units/pathway_contributors cascade in the database — the
    // route itself deletes nothing else.
    expect(routeOps(admin).filter((o) => o.action === 'delete')).toHaveLength(1);
  });

  it('skips the storage call when the pathway has no asset files', async () => {
    signInAs('env-admin@example.com');
    useAdmin({ contribution_units: { data: [] } });
    const res = await POST(jsonRequest(URL, { pathway_id: 'p1' }));
    expect(res.status).toBe(200);
    expect(admin.storageBucket.remove).not.toHaveBeenCalled();
    expect(admin.ops('pathways', 'delete')).toHaveLength(1);
  });

  it('still deletes the pathway when removing the files fails', async () => {
    signInAs('env-admin@example.com');
    admin.storageBucket.remove.mockResolvedValueOnce({ data: null, error: { message: 'bucket gone' } } as never);
    const res = await POST(jsonRequest(URL, { pathway_id: 'p1' }));
    expect(res.status).toBe(200);
    expect(admin.ops('pathways', 'delete')).toHaveLength(1);
  });

  it('is idempotent — deleting an already-deleted pathway still answers ok', async () => {
    signInAs('env-admin@example.com');
    useAdmin({ contribution_units: { data: [] }, pathways: { data: null } });
    const res = await POST(jsonRequest(URL, { pathway_id: 'gone' }));
    expect(res.status).toBe(200);
  });

  it.each([
    ['missing pathway_id', {}],
    ['numeric pathway_id', { pathway_id: 1 }],
    ['null pathway_id', { pathway_id: null }],
    ['object pathway_id', { pathway_id: { in: ['p1', 'p2'] } }],
  ])('400s %s without touching data', async (_label, body) => {
    signInAs('env-admin@example.com');
    const res = await POST(jsonRequest(URL, body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid request.' });
    expect(routeOps(admin)).toHaveLength(0);
  });

  it('passes a filter-injection-looking id only as an eq value', async () => {
    signInAs('env-admin@example.com');
    const res = await POST(jsonRequest(URL, { pathway_id: 'p1,id.neq.null' }));
    expect(res.status).toBe(200);
    expect(admin.ops('pathways', 'delete')[0].filters).toEqual([['eq', 'id', 'p1,id.neq.null']]);
  });

  // Regression: a malformed JSON body is a 400, not an unexpected 500.
  it('answers a malformed JSON body with 400, not 500', async () => {
    signInAs('env-admin@example.com');
    const res = await POST(jsonRequest(URL, 'nope'));
    expect(res.status).toBe(400);
  });

  it('hides the database error behind the generic 500 message', async () => {
    signInAs('env-admin@example.com');
    useAdmin({
      contribution_units: { data: [] },
      pathways: { error: { message: 'update or delete on table "pathways" violates foreign key constraint' } },
    });
    const res = await POST(jsonRequest(URL, { pathway_id: 'p1' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: GENERIC_ERROR_MESSAGE });
  });
});
