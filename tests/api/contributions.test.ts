import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createSupabaseMock, type MockResponse, type QueryOp, type SupabaseMock } from '../helpers/supabase-mock';
import { routeParams } from '../helpers/request';
import { assetId, routeOps, sessionMock } from '../helpers/routes-auth';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { GENERIC_ERROR_MESSAGE } from '@/lib/error-messages';
import { DELETE } from '@/app/api/contributions/[designId]/route';

const A1 = assetId();
const A2 = assetId();

let session: SupabaseMock;
let admin: SupabaseMock;

function del(designId = 'd1') {
  const req = new NextRequest(`http://localhost/api/contributions/${designId}`, { method: 'DELETE' });
  return DELETE(req, routeParams({ designId }));
}

function signIn(design: MockResponse = { data: { id: 'd1', pathway_id: 'p1' } }, designDelete: MockResponse = {}) {
  session = sessionMock({ id: 'u1', email: 'me@example.com' }, ['adopter', 'pathway_contributor'], {
    designs: (op: QueryOp) => (op.action === 'delete' ? designDelete : design),
  });
  vi.mocked(createClient).mockResolvedValue(session.client);
}

interface AdminSetup {
  removed?: MockResponse;
  docs?: MockResponse;
  pathway?: MockResponse;
  pathwayUpdate?: MockResponse;
}

function useAdmin(setup: AdminSetup = {}) {
  admin = createSupabaseMock({
    tables: {
      contribution_units: (op) =>
        op.action === 'delete'
          ? setup.removed ?? {
              data: [
                { unit_internal_id: A1, storage_path: 'p1/x/a.pdf' },
                { unit_internal_id: A2, storage_path: null },
              ],
            }
          : { data: [] },
      design_documents: setup.docs ?? { data: [{ id: 'doc-a' }, { id: 'doc-b' }] },
      pathways: (op) => {
        if (op.action === 'update') return setup.pathwayUpdate ?? {};
        // dropAssetsFromReviewCopy reads content_cache — no review copy here.
        if (op.columns === 'content_cache') return { data: { content_cache: null } };
        return setup.pathway ?? {
          data: { assembled_design_doc_id: 'doc-a', published_design_doc_id: 'doc-b', review_requested: true },
        };
      },
    },
  });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

beforeEach(() => {
  useAdmin();
  signIn();
});

describe('DELETE /api/contributions/[designId]', () => {
  it('401s an anonymous caller', async () => {
    session = sessionMock(null);
    vi.mocked(createClient).mockResolvedValue(session.client);
    const res = await del();
    expect(res.status).toBe(401);
    expect(routeOps(admin)).toHaveLength(0);
  });

  it('404s a design the caller cannot see (someone else\'s, via RLS) and touches nothing', async () => {
    signIn({ data: null });
    const res = await del('someone-elses');
    expect(res.status).toBe(404);
    expect(routeOps(admin)).toHaveLength(0);
    expect(session.ops('designs', 'delete')).toHaveLength(0);
    expect(admin.storageBucket.remove).not.toHaveBeenCalled();
  });

  it('reads the design through the caller\'s own session', async () => {
    await del('d1');
    const [read] = session.ops('designs', 'select');
    expect(read.filters).toEqual([['eq', 'id', 'd1']]);
  });

  it('deletes only the caller\'s own unpublished assets from this workspace, and their files', async () => {
    const res = await del('d1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const [assets] = admin.ops('contribution_units', 'delete');
    expect(assets.filters).toEqual([
      ['eq', 'design_id', 'd1'],
      ['eq', 'user_id', 'u1'],
      ['eq', 'unit_type', 'toolkit-asset'],
      ['is', 'published_at', null],
    ]);
    expect(admin.storageBucket.remove).toHaveBeenCalledWith(['p1/x/a.pdf']);
  });

  it('clears the pathway\'s pointers to this workspace\'s drafts and withdraws the review request', async () => {
    await del('d1');
    expect(admin.ops('design_documents', 'select')[0].filters).toEqual([['eq', 'design_id', 'd1']]);
    const [update] = admin.ops('pathways', 'update');
    expect(update.payload).toEqual({
      assembled_design_doc_id: null,
      review_requested: false,
      published_design_doc_id: null,
    });
    expect(update.filters).toEqual([['eq', 'id', 'p1']]);
  });

  it('leaves the pathway alone when its pointers name another contributor\'s drafts', async () => {
    useAdmin({
      pathway: { data: { assembled_design_doc_id: 'other-doc', published_design_doc_id: 'other-pub', review_requested: true } },
    });
    const res = await del('d1');
    expect(res.status).toBe(200);
    expect(admin.ops('pathways', 'update')).toHaveLength(0);
  });

  it('deletes the design itself through the session client (owner-only RLS), not the admin client', async () => {
    await del('d1');
    const [designDelete] = session.ops('designs', 'delete');
    expect(designDelete.filters).toEqual([['eq', 'id', 'd1']]);
    expect(admin.ops('designs')).toHaveLength(0);
  });

  it('skips all pathway clean-up for a workspace not linked to a pathway', async () => {
    signIn({ data: { id: 'd1', pathway_id: null } });
    const res = await del('d1');
    expect(res.status).toBe(200);
    expect(routeOps(admin)).toHaveLength(0);
    expect(session.ops('designs', 'delete')).toHaveLength(1);
  });

  it('answers an asset clean-up failure with the generic 500 and keeps the design', async () => {
    useAdmin({ removed: { error: { message: 'permission denied for relation contribution_units' } } });
    const res = await del('d1');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: GENERIC_ERROR_MESSAGE });
    expect(session.ops('designs', 'delete')).toHaveLength(0);
    expect(admin.storageBucket.remove).not.toHaveBeenCalled();
  });

  it('answers a pathway-pointer failure with the generic 500 and keeps the design', async () => {
    useAdmin({ pathwayUpdate: { error: { message: 'deadlock detected' } } });
    const res = await del('d1');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: GENERIC_ERROR_MESSAGE });
    expect(session.ops('designs', 'delete')).toHaveLength(0);
  });

  it('answers a design delete failure with the generic 500', async () => {
    signIn({ data: { id: 'd1', pathway_id: 'p1' } }, { error: { message: 'violates foreign key constraint "pathways_assembled_fk"' } });
    const res = await del('d1');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: GENERIC_ERROR_MESSAGE });
  });

  it('still succeeds when removing the asset files from storage fails', async () => {
    admin.storageBucket.remove.mockResolvedValueOnce({ data: null, error: { message: 'storage down' } } as never);
    const res = await del('d1');
    expect(res.status).toBe(200);
  });

  it('is effectively idempotent — a second delete of the same design is a 404', async () => {
    expect((await del('d1')).status).toBe(200);
    signIn({ data: null });
    expect((await del('d1')).status).toBe(404);
  });
});
