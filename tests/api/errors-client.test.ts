import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock';
import { jsonRequest } from '../helpers/request';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
// Keep withErrorHandling/sessionUserId real; capture what the route records.
vi.mock('@/lib/errors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/errors')>()),
  logError: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/errors';
import { POST } from '@/app/api/errors/client/route';

const URL = 'http://localhost/api/errors/client';

let admin: SupabaseMock;

function useAdmin(allowed: boolean | 'error' = true) {
  admin = createSupabaseMock({
    rpc: {
      check_rate_limit: allowed === 'error' ? { error: { message: 'function does not exist' } } : { data: allowed },
    },
  });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

function signIn(user: { id: string; email: string } | null) {
  vi.mocked(createClient).mockResolvedValue(createSupabaseMock({ user }).client);
}

function recorded() {
  expect(logError).toHaveBeenCalledTimes(1);
  const [source, error, context] = vi.mocked(logError).mock.calls[0];
  return { source, error: error as Error, context: context as Record<string, unknown> };
}

beforeEach(() => {
  useAdmin(true);
  signIn(null);
});

describe('POST /api/errors/client', () => {
  it('records the report as client:<path> and answers 204 with no body', async () => {
    const res = await POST(
      jsonRequest(URL, { message: 'Cannot read properties of undefined', stack: 'at Grid (grid.tsx:10)', path: '/analyse' }, { ip: '1.2.3.4' })
    );
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    const { source, error, context } = recorded();
    expect(source).toBe('client:/analyse');
    expect(error.message).toBe('Cannot read properties of undefined');
    expect(error.stack).toBe('at Grid (grid.tsx:10)');
    expect(context).toEqual({ kind: 'unexpected', path: '/analyse', user_id: null });
  });

  it('attaches the signed-in user id', async () => {
    signIn({ id: 'u1', email: 'me@example.com' });
    await POST(jsonRequest(URL, { message: 'boom', path: '/contribute' }));
    expect(recorded().context).toMatchObject({ user_id: 'u1' });
  });

  it('rate-limits per IP first — over the limit is a 429 and nothing is recorded', async () => {
    useAdmin(false);
    const res = await POST(jsonRequest(URL, { message: 'boom', path: '/' }, { ip: '9.9.9.9' }));
    expect(res.status).toBe(429);
    expect(logError).not.toHaveBeenCalled();
    expect(admin.rpc).toHaveBeenCalledWith('check_rate_limit', expect.objectContaining({ p_per_min: 20, p_per_day: 200 }));
    // The IP is only ever sent hashed.
    expect(JSON.stringify(admin.rpc.mock.calls)).not.toContain('9.9.9.9');
  });

  it('checks the rate limit before reading the body (an oversize body still gets 429)', async () => {
    useAdmin(false);
    const res = await POST(jsonRequest(URL, JSON.stringify({ message: 'x'.repeat(20_000) })));
    expect(res.status).toBe(429);
  });

  it('fails open when the rate-limit check itself errors', async () => {
    useAdmin('error');
    const res = await POST(jsonRequest(URL, { message: 'boom', path: '/' }));
    expect(res.status).toBe(204);
  });

  it('400s a body over 16KB without recording it', async () => {
    const res = await POST(jsonRequest(URL, JSON.stringify({ message: 'x'.repeat(16 * 1024) })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Report too large.' });
    expect(logError).not.toHaveBeenCalled();
  });

  it('accepts a body of exactly 16KB', async () => {
    const shell = JSON.stringify({ message: '' });
    const body = JSON.stringify({ message: 'x'.repeat(16 * 1024 - shell.length) });
    expect(body.length).toBe(16 * 1024);
    const res = await POST(jsonRequest(URL, body));
    expect(res.status).toBe(204);
  });

  it('400s invalid JSON', async () => {
    const res = await POST(jsonRequest(URL, '{"message": '));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid report.' });
    expect(logError).not.toHaveBeenCalled();
  });

  it('strips the query string from the path (no tokens or search terms recorded)', async () => {
    await POST(jsonRequest(URL, { message: 'boom', path: '/login?token=abc&next=/admin' }));
    const { source, context } = recorded();
    expect(source).toBe('client:/login');
    expect(context.path).toBe('/login');
  });

  it.each([
    ['an absolute URL', 'https://evil.example/phish'],
    ['a relative path', 'admin/errors'],
    ['a number', 42],
    ['nothing', undefined],
  ])('falls back to "/" for %s', async (_label, path) => {
    await POST(jsonRequest(URL, { message: 'boom', path }));
    const { source, context } = recorded();
    expect(source).toBe('client:/');
    expect(context.path).toBe('/');
  });

  it('records "(no message)" and no stack for a non-string message/stack', async () => {
    await POST(jsonRequest(URL, { message: { nested: true }, stack: ['a'], path: '/' }));
    const { error } = recorded();
    expect(error.message).toBe('(no message)');
    expect(error.stack).toBeUndefined();
  });

  it('reads only message, stack and path from the body', async () => {
    await POST(jsonRequest(URL, { message: 'boom', path: '/x', user_id: 'forged', kind: 'expected', source: 'server' }));
    const { source, context } = recorded();
    expect(source).toBe('client:/x');
    expect(context).toEqual({ kind: 'unexpected', path: '/x', user_id: null });
  });

  // Regression: valid JSON that is not an object (null) is a malformed report, not a server error.
  it('answers a JSON null body with 400, not 500', async () => {
    const res = await POST(jsonRequest(URL, 'null'));
    expect(res.status).toBe(400);
  });

  // Regression: the cap counts UTF-8 bytes, so multi-byte text cannot slip ~3x past it.
  it('caps the body at 16KB of bytes, not 16K characters', async () => {
    const body = JSON.stringify({ message: '\u20ac'.repeat(16 * 1024 - 20) });
    expect(new TextEncoder().encode(body).length).toBeGreaterThan(16 * 1024 * 2);
    const res = await POST(jsonRequest(URL, body));
    expect(res.status).toBe(400);
  });
});
