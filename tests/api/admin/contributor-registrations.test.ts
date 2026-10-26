import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock } from '../../helpers/supabase-mock';
import { jsonRequest } from '../../helpers/request';
import { sessionMock } from '../../helpers/routes-auth';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/contributor-registration-server', () => ({
  approveContributor: vi.fn(async () => ({ ok: true })),
  revokeContributor: vi.fn(async () => ({ ok: true })),
}));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { approveContributor, revokeContributor } from '@/lib/contributor-registration-server';
import { GENERIC_ERROR_MESSAGE } from '@/lib/error-messages';
import { POST as approvePOST } from '@/app/api/admin/contributor-registrations/approve/route';
import { POST as rejectPOST } from '@/app/api/admin/contributor-registrations/reject/route';

function signInAs(email: string | null, roles: string[] = []) {
  const sb = email === null ? sessionMock(null) : sessionMock({ id: 'caller', email }, roles);
  vi.mocked(createClient).mockResolvedValue(sb.client);
}

beforeEach(() => {
  vi.mocked(createAdminClient).mockReturnValue(createSupabaseMock().client);
});

const cases = [
  {
    name: 'approve',
    url: 'http://localhost/api/admin/contributor-registrations/approve',
    POST: approvePOST,
    action: approveContributor,
    other: revokeContributor,
  },
  {
    name: 'reject',
    url: 'http://localhost/api/admin/contributor-registrations/reject',
    POST: rejectPOST,
    action: revokeContributor,
    other: approveContributor,
  },
] as const;

describe.each(cases)('POST /api/admin/contributor-registrations/$name', ({ url, POST, action, other }) => {
  it('403s an anonymous caller without touching the registration', async () => {
    signInAs(null);
    const res = await POST(jsonRequest(url, { registration_id: 'r1' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Not authorized.' });
    expect(action).not.toHaveBeenCalled();
  });

  it.each([[[]], [['adopter']], [['adopter', 'pathway_contributor']]])(
    '403s a signed-in non-admin holding %j',
    async (roles) => {
      signInAs('someone@example.com', roles);
      const res = await POST(jsonRequest(url, { registration_id: 'r1' }));
      expect(res.status).toBe(403);
      expect(action).not.toHaveBeenCalled();
    }
  );

  it('lets an ADMIN_EMAILS address in (case-insensitive) without a role row', async () => {
    signInAs('ENV-Admin@Example.com');
    const res = await POST(jsonRequest(url, { registration_id: 'r1' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('lets an admin role row in and calls the action with the registration id only', async () => {
    signInAs('db-admin@example.com', ['admin']);
    const res = await POST(jsonRequest(url, { registration_id: 'r1', user_id: 'someone-else' }));
    expect(res.status).toBe(200);
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith({ registrationId: 'r1' });
    expect(other).not.toHaveBeenCalled();
  });

  it.each([
    ['missing registration_id', {}],
    ['numeric registration_id', { registration_id: 42 }],
    ['null registration_id', { registration_id: null }],
    ['array registration_id', { registration_id: ['r1'] }],
    ['object registration_id', { registration_id: { $ne: '' } }],
  ])('400s %s', async (_label, body) => {
    signInAs('env-admin@example.com');
    const res = await POST(jsonRequest(url, body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid request.' });
    expect(action).not.toHaveBeenCalled();
  });

  // Regression: a malformed JSON body is a 400, not an unexpected 500.
  it('answers a malformed JSON body with 400, not 500', async () => {
    signInAs('env-admin@example.com');
    const res = await POST(jsonRequest(url, '{not json'));
    expect(res.status).toBe(400);
  });

  it('never leaks the parse error text for a malformed body', async () => {
    signInAs('env-admin@example.com');
    const res = await POST(jsonRequest(url, '{not json'));
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/JSON|position|token/i);
  });

  it('passes a 4xx failure from the action through with its status and message', async () => {
    signInAs('env-admin@example.com');
    vi.mocked(action).mockResolvedValueOnce({ ok: false, error: 'Registration not found.', status: 404 } as never);
    const res = await POST(jsonRequest(url, { registration_id: 'missing' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Registration not found.' });
  });

  it('replaces a 5xx failure message from the action with the generic one', async () => {
    signInAs('env-admin@example.com');
    vi.mocked(action).mockResolvedValueOnce({
      ok: false,
      error: 'duplicate key value violates unique constraint "user_roles_pkey"',
      status: 500,
    } as never);
    const res = await POST(jsonRequest(url, { registration_id: 'r1' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: GENERIC_ERROR_MESSAGE });
  });

  it('answers a thrown action error with the generic 500', async () => {
    signInAs('env-admin@example.com');
    vi.mocked(action).mockRejectedValueOnce(new Error('connection refused at 10.0.0.5'));
    const res = await POST(jsonRequest(url, { registration_id: 'r1' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: GENERIC_ERROR_MESSAGE });
  });

  it('is repeatable — a second identical call gets the same answer', async () => {
    signInAs('env-admin@example.com');
    const first = await POST(jsonRequest(url, { registration_id: 'r1' }));
    const second = await POST(jsonRequest(url, { registration_id: 'r1' }));
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(action).toHaveBeenCalledTimes(2);
  });
});
