import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createSupabaseMock, type MockResponse, type SupabaseMock } from '../../helpers/supabase-mock';
import { routeParams } from '../../helpers/request';
import { assetId, memberTable, routeOps, sessionMock } from '../../helpers/routes-auth';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { GENERIC_ERROR_MESSAGE } from '@/lib/error-messages';
import { DELETE } from '@/app/api/toolkit-assets/[id]/route';

const ID = assetId();

let admin: SupabaseMock;

function remove(id = ID) {
  const req = new NextRequest(`http://localhost/api/toolkit-assets/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return DELETE(req, routeParams({ id }));
}

function assetRow(overrides: Record<string, unknown> = {}) {
  return {
    unit_internal_id: ID,
    pathway_id: 'p1',
    user_id: 'u1',
    asset_kind: 'file',
    asset_name: 'Call script',
    storage_path: 'p1/x/a.pdf',
    file_name: 'a.pdf',
    published_at: null,
    ...overrides,
  };
}

function useAdmin(opts: { asset?: MockResponse; deleted?: MockResponse } = {}) {
  admin = createSupabaseMock({
    tables: {
      contribution_units: (op) =>
        op.action === 'delete'
          ? opts.deleted ?? { data: [{ storage_path: 'p1/x/a.pdf' }] }
          : op.single === 'maybeSingle'
            ? opts.asset ?? { data: assetRow() }
            : { data: [] },
      pathways: { data: { content_cache: null } },
    },
  });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

function signIn(
  user: { id: string; email: string } | null = { id: 'u1', email: 'c@example.com' },
  roles: string[] = ['adopter', 'pathway_contributor'],
  memberOf: string[] = ['p1']
) {
  vi.mocked(createClient).mockResolvedValue(
    sessionMock(user, roles, { pathway_contributors: memberTable(memberOf) }).client
  );
}

function deletes() {
  return admin.ops('contribution_units', 'delete');
}

beforeEach(() => {
  useAdmin();
  signIn();
});

describe('DELETE /api/toolkit-assets/[id]', () => {
  it.each([
    ['not an asset id', 'u-123'],
    ['a traversal', '../../pathways/p1'],
    ['an uppercase uuid', `asset-${'A'.repeat(8)}-0000-0000-0000-000000000000`],
    ['a filter-injection string', `${ID},unit_type.neq.x`],
  ])('404s %s without touching the database', async (_label, id) => {
    const res = await remove(id);
    expect(res.status).toBe(404);
    expect(routeOps(admin)).toHaveLength(0);
  });

  it('404s an asset that does not exist', async () => {
    useAdmin({ asset: { data: null } });
    const res = await remove();
    expect(res.status).toBe(404);
    expect(deletes()).toHaveLength(0);
  });

  it('401s an anonymous caller', async () => {
    signIn(null);
    const res = await remove();
    expect(res.status).toBe(401);
    expect(deletes()).toHaveLength(0);
  });

  it('404s (not 403) a signed-in caller without the contributor role', async () => {
    signIn(undefined, ['adopter']);
    const res = await remove();
    expect(res.status).toBe(404);
    expect(deletes()).toHaveLength(0);
  });

  it('404s an admin — admins cannot remove a contributor\'s asset here', async () => {
    signIn({ id: 'a1', email: 'env-admin@example.com' }, ['adopter', 'admin']);
    const res = await remove();
    expect(res.status).toBe(404);
    expect(deletes()).toHaveLength(0);
  });

  it('404s a contributor who is not on the asset\'s pathway', async () => {
    signIn(undefined, undefined, ['p2']);
    const res = await remove();
    expect(res.status).toBe(404);
    expect(deletes()).toHaveLength(0);
  });

  it('404s a co-contributor on the same pathway who did not upload it', async () => {
    signIn({ id: 'u2', email: 'co@example.com' });
    const res = await remove();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
    expect(deletes()).toHaveLength(0);
  });

  it('409s a live (published) asset', async () => {
    useAdmin({ asset: { data: assetRow({ published_at: '2026-01-01T00:00:00Z' }) } });
    const res = await remove();
    expect(res.status).toBe(409);
    expect(deletes()).toHaveLength(0);
    expect(admin.storageBucket.remove).not.toHaveBeenCalled();
  });

  it('deletes the uploader\'s own unpublished asset row, guarded on published_at, then its file', async () => {
    const res = await remove();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [op] = deletes();
    expect(op.filters).toEqual([
      ['eq', 'unit_internal_id', ID],
      ['eq', 'unit_type', 'toolkit-asset'],
      ['is', 'published_at', null],
    ]);
    expect(op.columns).toBe('storage_path');
    expect(admin.storageBucket.remove).toHaveBeenCalledWith(['p1/x/a.pdf']);
  });

  it('skips storage for a link asset', async () => {
    useAdmin({ deleted: { data: [{ storage_path: null }] } });
    const res = await remove();
    expect(res.status).toBe(200);
    expect(admin.storageBucket.remove).not.toHaveBeenCalled();
  });

  it('409s when a publish won the race (nothing left to delete)', async () => {
    useAdmin({ deleted: { data: [] } });
    const res = await remove();
    expect(res.status).toBe(409);
    expect(admin.storageBucket.remove).not.toHaveBeenCalled();
  });

  it('is not repeatable — a second remove of the same id is a 404', async () => {
    expect((await remove()).status).toBe(200);
    useAdmin({ asset: { data: null } });
    expect((await remove()).status).toBe(404);
  });

  it('answers a delete failure with the generic 500', async () => {
    useAdmin({ deleted: { error: { message: 'permission denied for table contribution_units' } } });
    const res = await remove();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: GENERIC_ERROR_MESSAGE });
    expect(admin.storageBucket.remove).not.toHaveBeenCalled();
  });

  it('still succeeds when the storage removal fails', async () => {
    admin.storageBucket.remove.mockResolvedValueOnce({ data: null, error: { message: 'storage down' } } as never);
    const res = await remove();
    expect(res.status).toBe(200);
  });
});
