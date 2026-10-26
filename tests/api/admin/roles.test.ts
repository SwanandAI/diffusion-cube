import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type SupabaseMock } from '../../helpers/supabase-mock';
import { jsonRequest } from '../../helpers/request';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/contributor-registration-server', () => ({
  approveContributor: vi.fn(async () => ({ ok: true })),
  revokeContributor: vi.fn(async () => ({ ok: true })),
}));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { approveContributor, revokeContributor } from '@/lib/contributor-registration-server';
import { POST } from '@/app/api/admin/roles/route';

const URL = 'http://localhost/api/admin/roles';

let session: SupabaseMock;
let admin: SupabaseMock;

function signInAs(email: string, roles: string[] = []) {
  session = createSupabaseMock({
    user: { id: 'caller', email },
    tables: {
      user_roles: (op) => {
        const wanted = op.filters.find((f) => f[0] === 'eq' && f[1] === 'role')?.[2];
        return { data: wanted && roles.includes(wanted as string) ? { role: wanted } : null };
      },
    },
  });
  vi.mocked(createClient).mockResolvedValue(session.client);
}

beforeEach(() => {
  admin = createSupabaseMock();
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
});

describe('POST /api/admin/roles', () => {
  it('403s a signed-in non-admin', async () => {
    signInAs('someone@example.com', ['adopter']);
    const res = await POST(jsonRequest(URL, { user_id: 'u2', role: 'admin', action: 'add' }));
    expect(res.status).toBe(403);
    expect(admin.queryOps).toHaveLength(0);
  });

  it('403s an anonymous caller', async () => {
    session = createSupabaseMock({ user: null });
    vi.mocked(createClient).mockResolvedValue(session.client);
    const res = await POST(jsonRequest(URL, { user_id: 'u2', role: 'admin', action: 'add' }));
    expect(res.status).toBe(403);
  });

  it('lets an ADMIN_EMAILS address in without an admin role row', async () => {
    signInAs('env-admin@example.com');
    const res = await POST(jsonRequest(URL, { user_id: 'u2', role: 'admin', action: 'add' }));
    expect(res.status).toBe(200);
  });

  it('upserts an admin grant so a repeat grant is a no-op', async () => {
    signInAs('db-admin@example.com', ['admin']);
    const res = await POST(jsonRequest(URL, { user_id: 'u2', role: 'admin', action: 'add' }));
    expect(res.status).toBe(200);
    const [op] = admin.ops('user_roles', 'upsert');
    expect(op.payload).toEqual({ user_id: 'u2', role: 'admin' });
    expect(op.options).toEqual({ onConflict: 'user_id,role' });
  });

  it('removes an admin grant', async () => {
    signInAs('env-admin@example.com');
    const res = await POST(jsonRequest(URL, { user_id: 'u2', role: 'admin', action: 'remove' }));
    expect(res.status).toBe(200);
    const [op] = admin.ops('user_roles', 'delete');
    expect(op.filters).toEqual([
      ['eq', 'user_id', 'u2'],
      ['eq', 'role', 'admin'],
    ]);
  });

  it('routes a contributor grant through approveContributor', async () => {
    signInAs('env-admin@example.com');
    const res = await POST(jsonRequest(URL, { user_id: 'u2', role: 'pathway_contributor', action: 'add' }));
    expect(res.status).toBe(200);
    expect(approveContributor).toHaveBeenCalledWith({ userId: 'u2' });
  });

  it('routes a contributor removal through revokeContributor', async () => {
    signInAs('env-admin@example.com');
    const res = await POST(jsonRequest(URL, { user_id: 'u2', role: 'pathway_contributor', action: 'remove' }));
    expect(res.status).toBe(200);
    expect(revokeContributor).toHaveBeenCalledWith({ userId: 'u2' });
  });

  it('passes through approveContributor failures with their status', async () => {
    signInAs('env-admin@example.com');
    vi.mocked(approveContributor).mockResolvedValueOnce({ ok: false, error: 'No such user.', status: 404 } as never);
    const res = await POST(jsonRequest(URL, { user_id: 'u2', role: 'pathway_contributor', action: 'add' }));
    expect(res.status).toBe(404);
  });

  // Every account is an adopter from signup (migration 0039) — not an
  // admin-managed role any more, and general_user no longer exists.
  it.each(['adopter', 'general_user', 'superuser', '', null])('rejects role %s with 400', async (role) => {
    signInAs('env-admin@example.com');
    const res = await POST(jsonRequest(URL, { user_id: 'u2', role, action: 'add' }));
    expect(res.status).toBe(400);
    expect(admin.queryOps).toHaveLength(0);
  });

  it.each([
    ['missing user_id', { role: 'admin', action: 'add' }],
    ['numeric user_id', { user_id: 7, role: 'admin', action: 'add' }],
    ['unknown action', { user_id: 'u2', role: 'admin', action: 'toggle' }],
  ])('rejects %s with 400', async (_label, body) => {
    signInAs('env-admin@example.com');
    const res = await POST(jsonRequest(URL, body));
    expect(res.status).toBe(400);
  });

  it('hides a database error behind the generic 500 message', async () => {
    signInAs('env-admin@example.com');
    admin = createSupabaseMock({ tables: { user_roles: { error: { message: 'relation "x" does not exist' } } } });
    vi.mocked(createAdminClient).mockReturnValue(admin.client);
    const res = await POST(jsonRequest(URL, { user_id: 'u2', role: 'admin', action: 'add' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain('relation');
  });

  it('no longer touches app_metadata on removal', async () => {
    signInAs('env-admin@example.com');
    await POST(jsonRequest(URL, { user_id: 'u2', role: 'admin', action: 'remove' }));
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });
});
