import { createHmac, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock } from '../../helpers/supabase-mock';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/email', () => ({
  sendSignupCodeEmail: vi.fn(async () => undefined),
  sendPasswordResetCodeEmail: vi.fn(async () => undefined),
  sendReauthenticationCodeEmail: vi.fn(async () => undefined),
  sendAuthLinkEmail: vi.fn(async () => undefined),
}));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  sendAuthLinkEmail,
  sendPasswordResetCodeEmail,
  sendReauthenticationCodeEmail,
  sendSignupCodeEmail,
} from '@/lib/email';
import { GENERIC_ERROR_MESSAGE } from '@/lib/error-messages';
import { POST } from '@/app/api/auth/send-email/route';

const ROUTE = 'http://localhost/api/auth/send-email';
const KEY = randomBytes(32);
const SECRET = `v1,whsec_${KEY.toString('base64')}`;

function sign(body: string, opts: { key?: Buffer; id?: string; timestamp?: number } = {}) {
  const id = opts.id ?? 'msg_1';
  const timestamp = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', opts.key ?? KEY).update(`${id}.${timestamp}.${body}`).digest('base64');
  return { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` };
}

function hookRequest(body: string, headers: Record<string, string>) {
  return new Request(ROUTE, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
}

function payload(type: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    user: { email: 'new@example.com' },
    email_data: {
      token: '123456',
      token_hash: 'hash-abc',
      redirect_to: 'https://cube.100pathways.com/auth/callback',
      email_action_type: type,
      site_url: 'https://cube.100pathways.com',
    },
    ...overrides,
  });
}

function signed(body: string) {
  return hookRequest(body, sign(body));
}

const allSenders = [sendSignupCodeEmail, sendPasswordResetCodeEmail, sendReauthenticationCodeEmail, sendAuthLinkEmail];

beforeEach(() => {
  process.env.SEND_EMAIL_HOOK_SECRET = SECRET;
  vi.mocked(createClient).mockResolvedValue(createSupabaseMock().client);
  vi.mocked(createAdminClient).mockReturnValue(createSupabaseMock().client);
});

afterEach(() => {
  delete process.env.SEND_EMAIL_HOOK_SECRET;
});

describe('POST /api/auth/send-email — signature', () => {
  it('accepts a valid signature and answers {}', async () => {
    const res = await POST(signed(payload('signup')));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it('accepts a secret configured without the v1,whsec_ prefix', async () => {
    process.env.SEND_EMAIL_HOOK_SECRET = KEY.toString('base64');
    const res = await POST(signed(payload('signup')));
    expect(res.status).toBe(200);
  });

  it('accepts when any one of several rotated signatures matches', async () => {
    const body = payload('signup');
    const headers = sign(body);
    const stale = sign(body, { key: randomBytes(32) })['webhook-signature'];
    headers['webhook-signature'] = `${stale} ${headers['webhook-signature']}`;
    const res = await POST(hookRequest(body, headers));
    expect(res.status).toBe(200);
  });

  it.each(['webhook-id', 'webhook-timestamp', 'webhook-signature'])('401s when %s is missing', async (header) => {
    const body = payload('signup');
    const headers = sign(body);
    delete (headers as Record<string, string>)[header];
    const res = await POST(hookRequest(body, headers));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { http_code: 401, message: 'Invalid signature.' } });
    for (const send of allSenders) expect(send).not.toHaveBeenCalled();
  });

  it('401s a tampered body (signature was for a different recipient)', async () => {
    const original = payload('signup');
    const headers = sign(original);
    const tampered = original.replace('new@example.com', 'attacker@example.com');
    const res = await POST(hookRequest(tampered, headers));
    expect(res.status).toBe(401);
    expect(sendSignupCodeEmail).not.toHaveBeenCalled();
  });

  it('401s a signature made with the wrong secret', async () => {
    const body = payload('signup');
    const res = await POST(hookRequest(body, sign(body, { key: randomBytes(32) })));
    expect(res.status).toBe(401);
  });

  it('401s a valid signature whose webhook-id was swapped', async () => {
    const body = payload('signup');
    const headers = { ...sign(body), 'webhook-id': 'msg_other' };
    const res = await POST(hookRequest(body, headers));
    expect(res.status).toBe(401);
  });

  it.each([
    ['older than 5 minutes', -6 * 60],
    ['more than 5 minutes in the future', 6 * 60],
  ])('401s a timestamp %s (replay window)', async (_label, offset) => {
    const body = payload('signup');
    const res = await POST(hookRequest(body, sign(body, { timestamp: Math.floor(Date.now() / 1000) + offset })));
    expect(res.status).toBe(401);
  });

  it('401s a non-numeric timestamp', async () => {
    const body = payload('signup');
    const headers = { ...sign(body), 'webhook-timestamp': 'yesterday' };
    const res = await POST(hookRequest(body, headers));
    expect(res.status).toBe(401);
  });

  it.each([
    ['an unknown version', (sig: string) => sig.replace(/^v1,/, 'v2,')],
    ['no signature after the comma', () => 'v1,'],
    ['a truncated signature', (sig: string) => sig.slice(0, 20)],
    ['garbage', () => 'not-a-signature'],
  ])('401s a signature header with %s', async (_label, mangle) => {
    const body = payload('signup');
    const headers = sign(body);
    headers['webhook-signature'] = mangle(headers['webhook-signature']);
    const res = await POST(hookRequest(body, headers));
    expect(res.status).toBe(401);
  });

  it('answers 500 in the hook\'s own error shape when the secret is not configured', async () => {
    delete process.env.SEND_EMAIL_HOOK_SECRET;
    const res = await POST(signed(payload('signup')));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { http_code: 500, message: GENERIC_ERROR_MESSAGE } });
    expect(sendSignupCodeEmail).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/send-email — payload', () => {
  it('400s a correctly signed body that is not JSON', async () => {
    const res = await POST(signed('not json'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { http_code: 400, message: 'Invalid payload.' } });
  });

  it.each([
    ['no user', { user: undefined }],
    ['a user without email', { user: {} }],
    ['no email_data', { email_data: undefined }],
  ])('400s a payload with %s', async (_label, overrides) => {
    const res = await POST(signed(payload('signup', overrides)));
    expect(res.status).toBe(400);
    for (const send of allSenders) expect(send).not.toHaveBeenCalled();
  });

  it.each(['email_change', 'something_new'])('400s the unsupported action type %s', async (type) => {
    const res = await POST(signed(payload(type)));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { http_code: 400, message: 'This type of email is not supported.' } });
    for (const send of allSenders) expect(send).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/send-email — delivery', () => {
  it('sends a signup code', async () => {
    await POST(signed(payload('signup')));
    expect(sendSignupCodeEmail).toHaveBeenCalledWith({ to: 'new@example.com', code: '123456', expiresInMinutes: 10 });
  });

  it('sends a password-reset code for recovery', async () => {
    await POST(signed(payload('recovery')));
    expect(sendPasswordResetCodeEmail).toHaveBeenCalledWith({ to: 'new@example.com', code: '123456', expiresInMinutes: 10 });
  });

  it('sends a reauthentication code', async () => {
    await POST(signed(payload('reauthentication')));
    expect(sendReauthenticationCodeEmail).toHaveBeenCalledWith({
      to: 'new@example.com',
      code: '123456',
      expiresInMinutes: 10,
    });
  });

  it('sends an invite link through Supabase\'s /verify endpoint', async () => {
    await POST(signed(payload('invite')));
    const call = vi.mocked(sendAuthLinkEmail).mock.calls[0][0];
    expect(call.to).toBe('new@example.com');
    expect(call.kind).toBe('invite');
    const url = new URL(call.url);
    expect(url.origin + url.pathname).toBe('http://supabase.test/auth/v1/verify');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      token: 'hash-abc',
      type: 'invite',
      redirect_to: 'https://cube.100pathways.com/auth/callback',
    });
  });

  it.each(['magiclink', 'email'])('sends a magic link with the code for %s', async (type) => {
    await POST(signed(payload(type)));
    const call = vi.mocked(sendAuthLinkEmail).mock.calls[0][0];
    expect(call).toMatchObject({ to: 'new@example.com', kind: 'magiclink', code: '123456' });
    expect(new URL(call.url).searchParams.get('type')).toBe('magiclink');
  });

  it('omits redirect_to from the link when none was given', async () => {
    const body = JSON.parse(payload('invite'));
    body.email_data.redirect_to = '';
    await POST(signed(JSON.stringify(body)));
    const call = vi.mocked(sendAuthLinkEmail).mock.calls[0][0];
    expect(new URL(call.url).searchParams.has('redirect_to')).toBe(false);
  });

  it('answers an SMTP failure with a 500 in the hook\'s shape, no SMTP text leaked', async () => {
    vi.mocked(sendSignupCodeEmail).mockRejectedValueOnce(new Error('535 5.7.8 Username and Password not accepted smtp.gmail.com'));
    const res = await POST(signed(payload('signup')));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: { http_code: 500, message: GENERIC_ERROR_MESSAGE } });
    expect(JSON.stringify(body)).not.toMatch(/535|smtp/i);
  });
});
