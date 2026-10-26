import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type MockResponse, type QueryOp, type SupabaseMock } from '../../helpers/supabase-mock';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/toolkit-assets-server', () => ({ removeAssetObjects: vi.fn(async () => {}) }));

import { createAdminClient } from '@/lib/supabase/admin';
import { removeAssetObjects } from '@/lib/toolkit-assets-server';
import { deleteAccount } from '@/lib/account-deletion-server';

let admin: SupabaseMock;

function setup(responses: { update?: MockResponse; select?: MockResponse; delete?: MockResponse } = {}) {
  admin = createSupabaseMock({
    tables: {
      contribution_units: (op: QueryOp) => responses[op.action as 'update' | 'select' | 'delete'] ?? {},
    },
  });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

beforeEach(() => setup());

describe('deleteAccount', () => {
  it('detaches published units, removes draft asset files and drafts, then deletes the user', async () => {
    setup({ select: { data: [{ storage_path: 'p1/a/file.pdf' }, { storage_path: 'p1/b/x.png' }] } });
    expect(await deleteAccount('u1', 'test')).toBe(true);

    const [update] = admin.ops('contribution_units', 'update');
    expect(update.payload).toEqual({ user_id: null });
    expect(update.filters).toEqual([
      ['eq', 'user_id', 'u1'],
      ['not', 'published_at', 'is', null],
    ]);

    const [select] = admin.ops('contribution_units', 'select');
    expect(select.filters).toEqual([
      ['eq', 'user_id', 'u1'],
      ['eq', 'unit_type', 'toolkit-asset'],
      ['is', 'published_at', null],
      ['not', 'storage_path', 'is', null],
    ]);
    expect(removeAssetObjects).toHaveBeenCalledWith(['p1/a/file.pdf', 'p1/b/x.png']);

    const [del] = admin.ops('contribution_units', 'delete');
    expect(del.filters).toEqual([
      ['eq', 'user_id', 'u1'],
      ['is', 'published_at', null],
    ]);
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith('u1');
  });

  it('runs the steps in a safe order: detach → files → drafts → auth user', async () => {
    const order: string[] = [];
    admin = createSupabaseMock({
      tables: {
        contribution_units: (op) => {
          order.push(op.action);
          return {};
        },
      },
    });
    vi.mocked(createAdminClient).mockReturnValue(admin.client);
    vi.mocked(removeAssetObjects).mockImplementation(async () => {
      order.push('remove-files');
    });
    admin.auth.admin.deleteUser.mockImplementation(async () => {
      order.push('deleteUser');
      return { data: {}, error: null };
    });
    await deleteAccount('u1', 'test');
    expect(order).toEqual(['update', 'select', 'remove-files', 'delete', 'deleteUser']);
  });

  it('passes an empty list when there are no draft files', async () => {
    setup({ select: { data: null } });
    expect(await deleteAccount('u1', 'test')).toBe(true);
    expect(removeAssetObjects).toHaveBeenCalledWith([]);
  });

  it('stops before anything is lost when detaching published units fails', async () => {
    setup({ update: { error: { message: 'null value in column "user_id" violates not-null constraint' } } });
    expect(await deleteAccount('u1', 'tag')).toBe(false);
    expect(admin.ops('contribution_units', 'delete')).toHaveLength(0);
    expect(removeAssetObjects).not.toHaveBeenCalled();
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[tag]'), expect.anything());
  });

  it('does not delete the auth user when deleting drafts fails', async () => {
    setup({ delete: { error: { message: 'rls' } } });
    expect(await deleteAccount('u1', 'tag')).toBe(false);
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('continues when the draft-file lookup errors (files are best-effort)', async () => {
    setup({ select: { error: { message: 'timeout' } } });
    expect(await deleteAccount('u1', 'tag')).toBe(true);
    expect(removeAssetObjects).toHaveBeenCalledWith([]);
    expect(admin.auth.admin.deleteUser).toHaveBeenCalled();
  });

  it('treats an already-deleted user (user_not_found) as success', async () => {
    admin.auth.admin.deleteUser.mockResolvedValue({ data: {}, error: { code: 'user_not_found', message: 'gone' } } as never);
    expect(await deleteAccount('u1', 'tag')).toBe(true);
  });

  it('returns false on any other deleteUser error', async () => {
    admin.auth.admin.deleteUser.mockResolvedValue({ data: {}, error: { code: 'unexpected_failure', message: 'x' } } as never);
    expect(await deleteAccount('u1', 'tag')).toBe(false);
  });

  it('only ever touches the given user’s rows', async () => {
    await deleteAccount('victim-id', 'tag');
    for (const op of admin.ops('contribution_units')) {
      expect(op.filters).toContainEqual(['eq', 'user_id', 'victim-id']);
    }
  });
});
