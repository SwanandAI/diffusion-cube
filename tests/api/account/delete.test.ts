import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type SupabaseMock } from '../../helpers/supabase-mock';
import { jsonRequest } from '../../helpers/request';
import { sessionMock } from '../../helpers/routes-auth';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createStatelessClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/account-deletion-server', () => ({ deleteAccount: vi.fn(async () => true) }));

import { createClient, createStatelessClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { deleteAccount } from '@/lib/account-deletion-server';
import { GENERIC_ERROR_MESSAGE } from '@/lib/error-messages';
import { POST } from '@/app/api/account/delete/route';

const URL = 'http://localhost/api/account/delete';

let stateless: SupabaseMock;
let session: SupabaseMock;

function signIn(user: { id: string; email: string | null } | null = { id: 'u1', email: 'me@example.com' }) {
  session = sessionMock(user, ['adopter']);
  vi.mocked(createClient).mockResolvedValue(session.client);
}

function passwordCheck(error: { message: string; code?: string } | null) {
  stateless.auth.signInWithPassword.mockResolvedValueOnce({ data: { user: null, session: null }, error } as never);
}

beforeEach(() => {
  vi.mocked(createAdminClient).mockReturnValue(createSupabaseMock().client);
  stateless = createSupabaseMock();
  vi.mocked(createStatelessClient).mockReturnValue(stateless.client);
  signIn();
});

describe('POST /api/account/delete', () => {
  it('401s an anonymous caller and verifies nothing', async () => {
    signIn(null);
    const res = await POST(jsonRequest(URL, { password: 'pw' }));
    expect(res.status).toBe(401);
    expect(stateless.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('401s a session without an email', async () => {
    signIn({ id: 'u1', email: null });
    const res = await POST(jsonRequest(URL, { password: 'pw' }));
    expect(res.status).toBe(401);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it.each([
    ['missing password', {}],
    ['empty password', { password: '' }],
    ['numeric password', { password: 1234 }],
    ['object password', { password: { $gt: '' } }],
  ])('400s %s', async (_label, body) => {
    const res = await POST(jsonRequest(URL, body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Enter your password.' });
    expect(stateless.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('400s a malformed JSON body', async () => {
    const res = await POST(jsonRequest(URL, 'password=pw'));
    expect(res.status).toBe(400);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('re-verifies the password against the session email on a stateless client, then deletes', async () => {
    const res = await POST(jsonRequest(URL, { password: 'correct horse' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(createStatelessClient).toHaveBeenCalled();
    expect(stateless.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'me@example.com', password: 'correct horse' });
    // The caller's own session client is never used to sign in.
    expect(session.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(deleteAccount).toHaveBeenCalledWith('u1', 'account/delete');
  });

  it('can only ever delete the caller — body-supplied ids and emails are ignored', async () => {
    const res = await POST(
      jsonRequest(URL, { password: 'pw', email: 'victim@example.com', user_id: 'victim', userId: 'victim' })
    );
    expect(res.status).toBe(200);
    expect(stateless.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'me@example.com', password: 'pw' });
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(deleteAccount).toHaveBeenCalledWith('u1', 'account/delete');
  });

  it('403s a wrong password and deletes nothing', async () => {
    passwordCheck({ message: 'Invalid login credentials', code: 'invalid_credentials' });
    const res = await POST(jsonRequest(URL, { password: 'wrong' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Incorrect password.' });
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('429s when Supabase rate-limits the password guesses', async () => {
    passwordCheck({ message: 'Request rate limit reached', code: 'over_request_rate_limit' });
    const res = await POST(jsonRequest(URL, { password: 'guess' }));
    expect(res.status).toBe(429);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('answers any other auth failure with the generic 500 and deletes nothing', async () => {
    passwordCheck({ message: 'upstream connect error to auth.internal:9999', code: 'unexpected_failure' });
    const res = await POST(jsonRequest(URL, { password: 'pw' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: GENERIC_ERROR_MESSAGE });
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('answers a failed deletion with the generic 500', async () => {
    vi.mocked(deleteAccount).mockResolvedValueOnce(false);
    const res = await POST(jsonRequest(URL, { password: 'pw' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: GENERIC_ERROR_MESSAGE });
  });

  it('answers a thrown deletion error with the generic 500', async () => {
    vi.mocked(deleteAccount).mockRejectedValueOnce(new Error('auth.admin.deleteUser: Database error deleting user'));
    const res = await POST(jsonRequest(URL, { password: 'pw' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: GENERIC_ERROR_MESSAGE });
  });
});
