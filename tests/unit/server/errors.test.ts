import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type SupabaseMock } from '../../helpers/supabase-mock';
import { getRequest } from '../../helpers/request';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  AuthError,
  ExpectedError,
  GENERIC_ERROR_MESSAGE,
  NotFoundError,
  ValidationError,
  cleanContext,
  currentEnvironment,
  logError,
  recordServerError,
  scrub,
  sessionUserId,
  withErrorHandling,
} from '@/lib/errors';

let session: SupabaseMock;
let admin: SupabaseMock;
let rateLimitAllows: boolean;

function signIn(user: { id: string } | null) {
  session = createSupabaseMock({ user });
  vi.mocked(createClient).mockResolvedValue(session.client);
}

// Lets fire-and-forget recording (schedule() → void task()) finish.
async function settle(rounds = 10) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}

const inserts = () => admin.ops('sys_errors', 'insert').map((o) => o.payload as Record<string, unknown>);

beforeEach(() => {
  rateLimitAllows = true;
  admin = createSupabaseMock({
    rpc: { check_rate_limit: () => ({ data: rateLimitAllows }) },
  });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
  signIn({ id: 'user-1' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('error classes', () => {
  it('ExpectedError keeps message and status and names itself', () => {
    const err = new ExpectedError('nope', 409);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('nope');
    expect(err.status).toBe(409);
    expect(err.name).toBe('ExpectedError');
  });

  it('ValidationError is a 400 ExpectedError', () => {
    const err = new ValidationError('bad input');
    expect(err).toBeInstanceOf(ExpectedError);
    expect(err.status).toBe(400);
    expect(err.name).toBe('ValidationError');
  });

  it('AuthError defaults to 401 and accepts 403', () => {
    expect(new AuthError('who?').status).toBe(401);
    expect(new AuthError('forbidden', 403).status).toBe(403);
    expect(new AuthError('x').name).toBe('AuthError');
  });

  it('NotFoundError is a 404', () => {
    expect(new NotFoundError('gone').status).toBe(404);
  });
});

describe('scrub', () => {
  it.each([
    ['Anthropic key', 'key sk-ant-api03-AbC_123-xyz failed', 'sk-ant-api03', 'sk-ant-[redacted]'],
    ['Bearer token', 'Authorization: Bearer abc.def-ghi_123==', 'abc.def', 'Bearer [redacted]'],
    ['JWT', 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_part-1 bad', 'eyJzdWIiOiIxIn0', '[jwt redacted]'],
    ['password=', 'login password=hunter2 failed', 'hunter2', 'password=[redacted]'],
    ['api_key:', '{"api_key": "abc123"}', 'abc123', '[redacted]'],
    ['secret', 'secret=s3cr3t&x=1', 's3cr3t', 'secret=[redacted]'],
  ])('masks a %s', (_label, input, leaked, expected) => {
    const out = scrub(input);
    expect(out).not.toContain(leaked);
    expect(out).toContain(expected);
  });

  it('leaves ordinary text alone', () => {
    expect(scrub('relation "designs" does not exist')).toBe('relation "designs" does not exist');
  });
});

describe('cleanContext', () => {
  it('keeps only the allowed keys', () => {
    const clean = cleanContext({
      user_id: 'u1',
      mode: 'companion',
      path: '/api/chat',
      status: 500,
      message: 'the full user message',
      document: 'secret doc',
      password: 'x',
    });
    expect(clean).toEqual({ user_id: 'u1', mode: 'companion', path: '/api/chat', status: 500 });
  });

  it('drops null, undefined, empty strings and non-string/number values', () => {
    const clean = cleanContext({ user_id: null, mode: undefined, flow: '', path: { a: 1 }, method: ['GET'], status: 0 });
    expect(clean).toEqual({ status: 0 });
  });

  it('caps string values at 200 chars and scrubs secrets', () => {
    const clean = cleanContext({ path: 'x'.repeat(500), flow: 'token=abc123' });
    expect(clean.path).toHaveLength(200);
    expect(clean.flow).toBe('token=[redacted]');
  });
});

describe('currentEnvironment', () => {
  it('honours APP_ENV=prod / dev', () => {
    vi.stubEnv('APP_ENV', 'prod');
    expect(currentEnvironment()).toBe('prod');
    vi.stubEnv('APP_ENV', 'dev');
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(currentEnvironment()).toBe('dev');
  });

  it('falls back to VERCEL_ENV=production → prod', () => {
    vi.stubEnv('APP_ENV', '');
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(currentEnvironment()).toBe('prod');
  });

  it('treats previews, local dev and junk APP_ENV as dev', () => {
    vi.stubEnv('APP_ENV', 'staging');
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(currentEnvironment()).toBe('dev');
    vi.stubEnv('VERCEL_ENV', '');
    expect(currentEnvironment()).toBe('dev');
  });
});

describe('sessionUserId', () => {
  it('returns the signed-in user id', async () => {
    expect(await sessionUserId()).toBe('user-1');
  });

  it('returns null when anonymous', async () => {
    signIn(null);
    expect(await sessionUserId()).toBeNull();
  });

  it('returns null rather than throwing when the session client fails', async () => {
    vi.mocked(createClient).mockRejectedValue(new Error('cookies() outside request'));
    expect(await sessionUserId()).toBeNull();
  });
});

describe('logError', () => {
  it('writes one sys_errors row, kind unexpected by default', async () => {
    logError('lib/x', new Error('kaboom'), { user_id: 'u9', mode: 'companion' });
    await vi.waitFor(() => expect(inserts()).toHaveLength(1));
    const row = inserts()[0];
    expect(row).toMatchObject({
      source: 'lib/x',
      message: 'kaboom',
      user_id: 'u9',
      environment: 'dev',
      context: { user_id: 'u9', mode: 'companion', kind: 'unexpected' },
    });
    expect(typeof row.stack).toBe('string');
  });

  it('records a plain-object (PostgREST) error by its message, with no stack', async () => {
    logError('lib/x', { message: 'duplicate key', code: '23505' });
    await vi.waitFor(() => expect(inserts()).toHaveLength(1));
    expect(inserts()[0]).toMatchObject({ message: 'duplicate key', stack: null, user_id: null });
  });

  it('records a thrown string / empty message', async () => {
    logError('lib/x', '');
    await vi.waitFor(() => expect(inserts()).toHaveLength(1));
    expect(inserts()[0].message).toBe('(no message)');
  });

  it('respects an explicit expected kind', async () => {
    logError('lib/x', new Error('bad'), { kind: 'expected' });
    await vi.waitFor(() => expect(inserts()).toHaveLength(1));
    expect(inserts()[0].context).toMatchObject({ kind: 'expected' });
  });

  it('never throws when the admin client cannot be created', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('missing service key');
    });
    expect(() => logError('lib/x', new Error('a'))).not.toThrow();
    await settle();
  });

  it('never throws when the insert itself errors', async () => {
    admin = createSupabaseMock({ tables: { sys_errors: { error: { message: 'table missing' } } } });
    vi.mocked(createAdminClient).mockReturnValue(admin.client);
    expect(() => logError('lib/x', new Error('a'))).not.toThrow();
    await vi.waitFor(() => expect(admin.ops('sys_errors', 'insert')).toHaveLength(1));
  });

  it('scrubs secrets out of message and stack', async () => {
    const err = new Error('call failed with sk-ant-api03-SECRETKEY');
    logError('lib/x', err);
    await vi.waitFor(() => expect(inserts()).toHaveLength(1));
    const row = inserts()[0];
    expect(row.message).not.toContain('SECRETKEY');
    expect(row.stack).not.toContain('SECRETKEY');
  });
});

describe('recordServerError — sys_errors payload', () => {
  it('awaits the write and resolves the session user when none is given', async () => {
    await recordServerError('instrumentation', new Error('render failed'), { path: '/strengthen' });
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0]).toMatchObject({ user_id: 'user-1', context: { path: '/strengthen', user_id: 'user-1' } });
  });

  it('prefers an explicit user_id', async () => {
    await recordServerError('instrumentation', new Error('x'), { user_id: 'given' });
    expect(inserts()[0].user_id).toBe('given');
  });

  it('truncates message to 2000, stack to 8000 and source to 200 chars', async () => {
    const err = new Error('m'.repeat(5000));
    err.stack = 's'.repeat(20000);
    await recordServerError('x'.repeat(500), err, {});
    const row = inserts()[0];
    expect((row.message as string).length).toBe(2000);
    expect((row.stack as string).length).toBe(8000);
    expect((row.source as string).length).toBe(200);
  });

  it('drops context keys outside the allow-list', async () => {
    await recordServerError('instrumentation', new Error('x'), { routeType: 'render', digest: 'abc', path: '/p' });
    expect(Object.keys(inserts()[0].context as object).sort()).toEqual(['kind', 'path', 'user_id']);
  });

  it('records the prod environment from APP_ENV', async () => {
    vi.stubEnv('APP_ENV', 'prod');
    await recordServerError('instrumentation', new Error('x'), {});
    expect(inserts()[0].environment).toBe('prod');
  });

  it('never throws, even when the admin client throws', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(recordServerError('x', new Error('y'), {})).resolves.toBeUndefined();
  });

  it('never throws when the session lookup fails', async () => {
    vi.mocked(createClient).mockRejectedValue(new Error('no request scope'));
    await recordServerError('x', new Error('y'), {});
    expect(inserts()[0].user_id).toBeNull();
  });
});

describe('sys_errors purge', () => {
  it('purges old rows at most once per hour per instance', async () => {
    vi.resetModules();
    const fresh = await import('@/lib/errors');
    const now = vi.spyOn(Date, 'now').mockReturnValue(10 * 60 * 60 * 1000);
    await fresh.recordServerError('x', new Error('1'), { user_id: 'u' });
    await fresh.recordServerError('x', new Error('2'), { user_id: 'u' });
    const purges = () => admin.rpc.mock.calls.filter(([name]) => name === 'purge_old_sys_errors');
    expect(purges()).toHaveLength(1);
    expect(purges()[0][1]).toEqual({ days: 30 });

    now.mockReturnValue(11 * 60 * 60 * 1000 + 1);
    await fresh.recordServerError('x', new Error('3'), { user_id: 'u' });
    expect(purges()).toHaveLength(2);
  });
});

describe('withErrorHandling', () => {
  const URL = 'http://localhost/api/thing';

  it('passes a 2xx response through untouched and records nothing', async () => {
    const res = Response.json({ ok: true });
    const wrapped = withErrorHandling<[Request]>('api/thing', async () => res);
    expect(await wrapped(getRequest(URL))).toBe(res);
    await settle();
    expect(inserts()).toHaveLength(0);
  });

  it('passes a 3xx redirect through untouched', async () => {
    const res = new Response(null, { status: 302, headers: { location: '/x' } });
    const wrapped = withErrorHandling<[Request]>('api/thing', () => res);
    expect(await wrapped(getRequest(URL))).toBe(res);
  });

  it('passes a streamed 200 through untouched', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('hi'));
        c.close();
      },
    });
    const res = new Response(stream);
    const wrapped = withErrorHandling<[Request]>('api/thing', async () => res);
    const out = await wrapped(getRequest(URL));
    expect(out).toBe(res);
    expect(await out.text()).toBe('hi');
  });

  it('passes a returned 4xx through untouched and records it as expected', async () => {
    const res = Response.json({ error: 'Title is required.' }, { status: 400 });
    const wrapped = withErrorHandling<[Request]>('api/thing', async () => res);
    const out = await wrapped(getRequest(URL, { method: 'GET' }));
    expect(out).toBe(res);
    expect(await out.json()).toEqual({ error: 'Title is required.' });
    await vi.waitFor(() => expect(inserts()).toHaveLength(1));
    expect(inserts()[0]).toMatchObject({
      source: 'api/thing',
      message: 'Title is required.',
      stack: null,
      user_id: 'user-1',
      context: { kind: 'expected', status: 400, path: '/api/thing', method: 'GET', user_id: 'user-1' },
    });
  });

  it("reads the Auth hook's { error: { message } } shape", async () => {
    const wrapped = withErrorHandling<[Request]>('api/hook', async () =>
      Response.json({ error: { http_code: 401, message: 'bad signature' } }, { status: 401 })
    );
    await wrapped(getRequest(URL));
    await vi.waitFor(() => expect(inserts()).toHaveLength(1));
    expect(inserts()[0].message).toBe('bad signature');
  });

  it('records a non-JSON 4xx as "HTTP <status>"', async () => {
    const wrapped = withErrorHandling<[Request]>('api/thing', async () => new Response('nope', { status: 404 }));
    await wrapped(getRequest(URL));
    await vi.waitFor(() => expect(inserts()).toHaveLength(1));
    expect(inserts()[0].message).toBe('HTTP 404');
  });

  it('records a JSON 4xx with no error field as "HTTP <status>"', async () => {
    const wrapped = withErrorHandling<[Request]>('api/thing', async () => Response.json({ detail: 'x' }, { status: 409 }));
    await wrapped(getRequest(URL));
    await vi.waitFor(() => expect(inserts()).toHaveLength(1));
    expect(inserts()[0].message).toBe('HTTP 409');
  });

  it('does not record a 429 and does not touch the session', async () => {
    const res = Response.json({ error: 'Too many requests' }, { status: 429 });
    const wrapped = withErrorHandling<[Request]>('api/thing', async () => res);
    expect(await wrapped(getRequest(URL))).toBe(res);
    await settle();
    expect(inserts()).toHaveLength(0);
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(session.auth.getUser).not.toHaveBeenCalled();
  });

  it('replaces a returned 5xx body with the generic message and records it as unexpected', async () => {
    const wrapped = withErrorHandling<[Request]>('api/thing', async () =>
      Response.json({ error: 'relation "designs" does not exist' }, { status: 503 })
    );
    const out = await wrapped(getRequest(URL));
    expect(out.status).toBe(503);
    expect(await out.json()).toEqual({ error: GENERIC_ERROR_MESSAGE });
    await vi.waitFor(() => expect(inserts()).toHaveLength(1));
    expect(inserts()[0]).toMatchObject({
      message: 'relation "designs" does not exist',
      context: { kind: 'unexpected', status: 503 },
    });
  });

  it('turns a thrown ExpectedError into its own status and message', async () => {
    const wrapped = withErrorHandling<[Request]>('api/thing', async () => {
      throw new AuthError('Admin only', 403);
    });
    const out = await wrapped(getRequest(URL));
    expect(out.status).toBe(403);
    expect(await out.json()).toEqual({ error: 'Admin only' });
    await vi.waitFor(() => expect(inserts()).toHaveLength(1));
    expect(inserts()[0].context).toMatchObject({ kind: 'expected', status: 403 });
  });

  it('turns a thrown ValidationError into a 400', async () => {
    const wrapped = withErrorHandling<[Request]>('api/thing', () => {
      throw new ValidationError('slug invalid');
    });
    const out = await wrapped(getRequest(URL));
    expect(out.status).toBe(400);
    expect(await out.json()).toEqual({ error: 'slug invalid' });
  });

  it('turns any other thrown error into a 500 with the generic message, recording its stack', async () => {
    const wrapped = withErrorHandling<[Request]>('api/thing', async () => {
      throw new Error('ECONNREFUSED db.internal:5432');
    });
    const out = await wrapped(getRequest(URL));
    expect(out.status).toBe(500);
    const body = await out.json();
    expect(body).toEqual({ error: GENERIC_ERROR_MESSAGE });
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    await vi.waitFor(() => expect(inserts()).toHaveLength(1));
    expect(inserts()[0]).toMatchObject({ message: 'ECONNREFUSED db.internal:5432', context: { kind: 'unexpected', status: 500 } });
    expect(inserts()[0].stack).toContain('ECONNREFUSED');
  });

  it('handles a thrown non-Error value', async () => {
    const wrapped = withErrorHandling<[Request]>('api/thing', async () => {
      throw 'just a string';
    });
    const out = await wrapped(getRequest(URL));
    expect(out.status).toBe(500);
    await vi.waitFor(() => expect(inserts()).toHaveLength(1));
    expect(inserts()[0].message).toBe('just a string');
  });

  it('uses a custom errorBody for thrown errors, ExpectedErrors and returned 5xx', async () => {
    const errorBody = vi.fn((status: number, message: string) =>
      Response.json({ error: { http_code: status, message } }, { status })
    );
    const thrown = withErrorHandling<[Request]>('hook', async () => { throw new Error('x'); }, { errorBody });
    const out1 = await thrown(getRequest(URL));
    expect(await out1.json()).toEqual({ error: { http_code: 500, message: GENERIC_ERROR_MESSAGE } });

    const expected = withErrorHandling<[Request]>('hook', async () => { throw new ExpectedError('bad', 422); }, { errorBody });
    const out2 = await expected(getRequest(URL));
    expect(out2.status).toBe(422);
    expect(await out2.json()).toEqual({ error: { http_code: 422, message: 'bad' } });

    const returned = withErrorHandling<[Request]>('hook', async () => new Response('x', { status: 502 }), { errorBody });
    const out3 = await returned(getRequest(URL));
    expect(await out3.json()).toEqual({ error: { http_code: 502, message: GENERIC_ERROR_MESSAGE } });
    expect(errorBody).toHaveBeenCalledTimes(3);
  });

  it('does not use errorBody for a returned 4xx', async () => {
    const errorBody = vi.fn();
    const res = Response.json({ error: 'x' }, { status: 400 });
    const wrapped = withErrorHandling<[Request]>('hook', async () => res, { errorBody });
    expect(await wrapped(getRequest(URL))).toBe(res);
    expect(errorBody).not.toHaveBeenCalled();
  });

  it('works when the first argument is not a Request (no path/method in context)', async () => {
    const wrapped = withErrorHandling<[string]>('action', async () => {
      throw new Error('y');
    });
    const out = await wrapped('not a request');
    expect(out.status).toBe(500);
    await vi.waitFor(() => expect(inserts()).toHaveLength(1));
    const ctx = inserts()[0].context as Record<string, unknown>;
    expect(ctx.path).toBeUndefined();
    expect(ctx.method).toBeUndefined();
  });

  it('forwards every argument to the handler', async () => {
    const handler = vi.fn(async () => Response.json({}));
    const wrapped = withErrorHandling<[Request, unknown]>('api/thing', handler);
    const req = getRequest(URL);
    const ctx = { params: Promise.resolve({ id: '1' }) };
    await wrapped(req, ctx);
    expect(handler).toHaveBeenCalledWith(req, ctx);
  });

  describe('anonymous 4xx', () => {
    beforeEach(() => signIn(null));

    it('is recorded while the IP is within the anon-error allowance', async () => {
      rateLimitAllows = true;
      const wrapped = withErrorHandling<[Request]>('api/thing', async () => Response.json({ error: 'bad' }, { status: 400 }));
      await wrapped(getRequest(URL, { ip: '203.0.113.7' }));
      await vi.waitFor(() => expect(inserts()).toHaveLength(1));
      expect(inserts()[0].user_id).toBeNull();
      const call = admin.rpc.mock.calls.find(([name]) => name === 'check_rate_limit');
      expect(call).toBeDefined();
      expect(JSON.stringify(call)).not.toContain('203.0.113.7');
    });

    it('is not recorded once the IP is over the anon-error allowance', async () => {
      rateLimitAllows = false;
      const wrapped = withErrorHandling<[Request]>('api/thing', async () => Response.json({ error: 'bad' }, { status: 400 }));
      const out = await wrapped(getRequest(URL, { ip: '203.0.113.7' }));
      expect(out.status).toBe(400);
      await vi.waitFor(() =>
        expect(admin.rpc.mock.calls.some(([name]) => name === 'check_rate_limit')).toBe(true)
      );
      await settle();
      expect(inserts()).toHaveLength(0);
    });

    it('a thrown ExpectedError from an anonymous caller goes through the same allowance', async () => {
      rateLimitAllows = false;
      const wrapped = withErrorHandling<[Request]>('api/thing', async () => {
        throw new ValidationError('bad body');
      });
      const out = await wrapped(getRequest(URL));
      expect(out.status).toBe(400);
      await vi.waitFor(() =>
        expect(admin.rpc.mock.calls.some(([name]) => name === 'check_rate_limit')).toBe(true)
      );
      await settle();
      expect(inserts()).toHaveLength(0);
    });

    // A public route that keeps failing must not flood sys_errors either.
    it('an unexpected error from an anonymous caller goes through the same allowance', async () => {
      rateLimitAllows = false;
      const wrapped = withErrorHandling<[Request]>('api/thing', async () => {
        throw new Error('db down');
      });
      const out = await wrapped(getRequest(URL));
      expect(out.status).toBe(500);
      await vi.waitFor(() =>
        expect(admin.rpc.mock.calls.some(([name]) => name === 'check_rate_limit')).toBe(true)
      );
      await settle();
      expect(inserts()).toHaveLength(0);
    });

    it('an unexpected error from an anonymous caller within the allowance is recorded', async () => {
      const wrapped = withErrorHandling<[Request]>('api/thing', async () => {
        throw new Error('db down');
      });
      await wrapped(getRequest(URL));
      await vi.waitFor(() => expect(inserts()).toHaveLength(1));
    });

    it('a signed-in caller’s 4xx skips the allowance check', async () => {
      signIn({ id: 'user-2' });
      const wrapped = withErrorHandling<[Request]>('api/thing', async () => Response.json({ error: 'bad' }, { status: 400 }));
      await wrapped(getRequest(URL));
      await vi.waitFor(() => expect(inserts()).toHaveLength(1));
      expect(admin.rpc.mock.calls.some(([name]) => name === 'check_rate_limit')).toBe(false);
    });
  });

  it('still answers the caller when recording fails', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('no service key');
    });
    const wrapped = withErrorHandling<[Request]>('api/thing', async () => {
      throw new Error('x');
    });
    const out = await wrapped(getRequest(URL));
    expect(out.status).toBe(500);
    await settle();
  });
});
