import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type SupabaseMock } from '../../helpers/supabase-mock';
import { getRequest } from '../../helpers/request';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/errors', () => ({ logError: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/errors';
import { checkRateLimit, clientIp, type RateLimitScope } from '@/lib/rate-limit';

const URL = 'http://localhost/api/chat';
let admin: SupabaseMock;
let allow: unknown;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const lastArgs = () => admin.rpc.mock.calls.at(-1)?.[1] as { p_key: string; p_per_min: number; p_per_day: number };

beforeEach(() => {
  allow = true;
  admin = createSupabaseMock({ rpc: { check_rate_limit: () => ({ data: allow }) } });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('clientIp', () => {
  it('takes the first hop of x-forwarded-for, trimmed', () => {
    const req = getRequest(URL, { headers: { 'x-forwarded-for': ' 203.0.113.9 , 10.0.0.1, 10.0.0.2' } });
    expect(clientIp(req)).toBe('203.0.113.9');
  });

  it('handles a single address', () => {
    expect(clientIp(getRequest(URL, { ip: '198.51.100.4' }))).toBe('198.51.100.4');
  });

  it('handles IPv6', () => {
    expect(clientIp(getRequest(URL, { ip: '2001:db8::1, 10.0.0.1' }))).toBe('2001:db8::1');
  });

  it('falls back to x-real-ip', () => {
    const req = getRequest(URL, { headers: { 'x-real-ip': ' 192.0.2.5 ' } });
    expect(clientIp(req)).toBe('192.0.2.5');
  });

  it('falls back to x-real-ip when x-forwarded-for has an empty first hop', () => {
    const req = getRequest(URL, { headers: { 'x-forwarded-for': ' , 10.0.0.1', 'x-real-ip': '192.0.2.5' } });
    expect(clientIp(req)).toBe('192.0.2.5');
  });

  it('is "unknown" with neither header', () => {
    expect(clientIp(getRequest(URL))).toBe('unknown');
  });
});

describe('checkRateLimit', () => {
  it('allows when check_rate_limit returns true', async () => {
    expect(await checkRateLimit(getRequest(URL, { ip: '1.2.3.4' }), 'explore')).toBe(true);
    expect(admin.rpc).toHaveBeenCalledWith('check_rate_limit', expect.any(Object));
  });

  it('blocks when check_rate_limit returns false', async () => {
    allow = false;
    expect(await checkRateLimit(getRequest(URL, { ip: '1.2.3.4' }), 'explore')).toBe(false);
  });

  it('allows when check_rate_limit returns null (only an explicit false blocks)', async () => {
    allow = null;
    expect(await checkRateLimit(getRequest(URL, { ip: '1.2.3.4' }), 'explore')).toBe(true);
  });

  it.each<[RateLimitScope, number, number]>([
    ['explore', 20, 200],
    ['client-error', 20, 200],
    ['anon-error', 20, 200],
    ['chat-user', 30, 300],
  ])('uses the default limits for %s', async (scope, perMin, perDay) => {
    await checkRateLimit(getRequest(URL, { ip: '1.2.3.4' }), scope);
    expect(lastArgs()).toMatchObject({ p_per_min: perMin, p_per_day: perDay });
  });

  it('applies EXPLORE_RATE_LIMIT_* overrides to every per-IP scope', async () => {
    vi.stubEnv('EXPLORE_RATE_LIMIT_PER_MIN', '5');
    vi.stubEnv('EXPLORE_RATE_LIMIT_PER_DAY', '50');
    for (const scope of ['explore', 'client-error', 'anon-error'] as const) {
      await checkRateLimit(getRequest(URL, { ip: '1.2.3.4' }), scope);
      expect(lastArgs()).toMatchObject({ p_per_min: 5, p_per_day: 50 });
    }
    await checkRateLimit(getRequest(URL), 'chat-user', 'u1');
    expect(lastArgs()).toMatchObject({ p_per_min: 30, p_per_day: 300 });
  });

  it('applies CHAT_USER_RATE_LIMIT_* overrides to chat-user only', async () => {
    vi.stubEnv('CHAT_USER_RATE_LIMIT_PER_MIN', '100');
    vi.stubEnv('CHAT_USER_RATE_LIMIT_PER_DAY', '1000');
    await checkRateLimit(getRequest(URL), 'chat-user', 'u1');
    expect(lastArgs()).toMatchObject({ p_per_min: 100, p_per_day: 1000 });
    await checkRateLimit(getRequest(URL, { ip: '1.2.3.4' }), 'explore');
    expect(lastArgs()).toMatchObject({ p_per_min: 20, p_per_day: 200 });
  });

  it.each(['abc', '0', '-5', ''])('ignores an invalid override %j and uses the default', async (value) => {
    vi.stubEnv('EXPLORE_RATE_LIMIT_PER_MIN', value);
    await checkRateLimit(getRequest(URL, { ip: '1.2.3.4' }), 'explore');
    expect(lastArgs().p_per_min).toBe(20);
  });

  it('keys by subject when given, ignoring the IP', async () => {
    await checkRateLimit(getRequest(URL, { ip: '1.2.3.4' }), 'chat-user', 'user-42');
    const a = lastArgs().p_key;
    await checkRateLimit(getRequest(URL, { ip: '5.6.7.8' }), 'chat-user', 'user-42');
    expect(lastArgs().p_key).toBe(a);
    expect(a).toBe(sha('test-salt:chat-user:user-42'));
  });

  it('keys by client IP when no subject is given', async () => {
    await checkRateLimit(getRequest(URL, { ip: '1.2.3.4, 10.0.0.1' }), 'explore');
    expect(lastArgs().p_key).toBe(sha('test-salt:explore:1.2.3.4'));
  });

  it('different IPs get different keys', async () => {
    await checkRateLimit(getRequest(URL, { ip: '1.2.3.4' }), 'explore');
    const a = lastArgs().p_key;
    await checkRateLimit(getRequest(URL, { ip: '1.2.3.5' }), 'explore');
    expect(lastArgs().p_key).not.toBe(a);
  });

  it('scopes keys, so one scope does not use up another', async () => {
    const req = getRequest(URL, { ip: '1.2.3.4' });
    await checkRateLimit(req, 'explore');
    const a = lastArgs().p_key;
    await checkRateLimit(req, 'client-error');
    expect(lastArgs().p_key).not.toBe(a);
  });

  it('stores a salted SHA-256 hex hash, never the raw IP', async () => {
    await checkRateLimit(getRequest(URL, { ip: '203.0.113.77' }), 'explore');
    const key = lastArgs().p_key;
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('203.0.113.77');
    expect(JSON.stringify(admin.rpc.mock.calls)).not.toContain('203.0.113.77');
    // Salted: not the unsalted hash an attacker could precompute.
    expect(key).not.toBe(sha(':explore:203.0.113.77'));
  });

  it('a different salt gives a different key', async () => {
    await checkRateLimit(getRequest(URL, { ip: '1.2.3.4' }), 'explore');
    const a = lastArgs().p_key;
    vi.stubEnv('RATE_LIMIT_SALT', 'other-salt');
    await checkRateLimit(getRequest(URL, { ip: '1.2.3.4' }), 'explore');
    expect(lastArgs().p_key).not.toBe(a);
  });

  it('fails open and records the failure when the rpc returns an error', async () => {
    admin = createSupabaseMock({ rpc: { check_rate_limit: { error: { message: 'function missing' } } } });
    vi.mocked(createAdminClient).mockReturnValue(admin.client);
    expect(await checkRateLimit(getRequest(URL, { ip: '1.2.3.4' }), 'explore')).toBe(true);
    expect(logError).toHaveBeenCalledWith(
      'lib/rate-limit',
      { message: 'function missing' },
      { kind: 'unexpected', path: '/api/chat' }
    );
  });

  it('fails open and records the failure when the rpc throws', async () => {
    admin.rpc.mockRejectedValueOnce(new Error('network'));
    expect(await checkRateLimit(getRequest(URL), 'explore')).toBe(true);
    expect(logError).toHaveBeenCalledWith('lib/rate-limit', expect.any(Error), expect.objectContaining({ kind: 'unexpected' }));
  });

  it('fails open when the admin client cannot be created', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('missing env');
    });
    expect(await checkRateLimit(getRequest(URL), 'chat-user', 'u1')).toBe(true);
    expect(logError).toHaveBeenCalledTimes(1);
  });
});

describe('RATE_LIMIT_SALT unset', () => {
  it('warns exactly once per instance and still hashes', async () => {
    vi.resetModules();
    vi.stubEnv('RATE_LIMIT_SALT', '');
    const fresh = await import('@/lib/rate-limit');
    const warn = vi.mocked(console.warn);
    await fresh.checkRateLimit(getRequest(URL, { ip: '1.2.3.4' }), 'explore');
    await fresh.checkRateLimit(getRequest(URL, { ip: '1.2.3.4' }), 'explore');
    const saltWarnings = warn.mock.calls.filter(([m]) => String(m).includes('RATE_LIMIT_SALT'));
    expect(saltWarnings).toHaveLength(1);
    expect(lastArgs().p_key).toBe(sha(':explore:1.2.3.4'));
    expect(lastArgs().p_key).not.toContain('1.2.3.4');
  });

  it('does not warn when the salt is set', async () => {
    vi.resetModules();
    const fresh = await import('@/lib/rate-limit');
    await fresh.checkRateLimit(getRequest(URL, { ip: '1.2.3.4' }), 'explore');
    expect(vi.mocked(console.warn).mock.calls.some(([m]) => String(m).includes('RATE_LIMIT_SALT'))).toBe(false);
  });
});
