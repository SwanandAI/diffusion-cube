import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type MockResponse, type SupabaseMock } from '../helpers/supabase-mock';
import { jsonRequest } from '../helpers/request';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/errors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/errors')>()),
  logError: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors';
import { POST } from '@/app/api/feedback/route';

const URL = 'http://localhost/api/feedback';
const MSG = '3f1c2a9e-1b2c-4d5e-8f90-123456789abc';
const CONV = '11111111-2222-4333-8444-555555555555';

let admin: SupabaseMock;

function useAdmin(opts: { allowed?: boolean; table?: MockResponse } = {}) {
  admin = createSupabaseMock({
    rpc: { check_rate_limit: { data: opts.allowed ?? true } },
    tables: { message_feedback: opts.table ?? {} },
  });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

function signIn(user: { id: string; email: string } | null) {
  vi.mocked(createClient).mockResolvedValue(createSupabaseMock({ user }).client);
}

const body = (over: Record<string, unknown> = {}) => ({
  messageId: MSG,
  surface: 'analyse',
  vote: 'up',
  conversationId: CONV,
  excerpt: 'Here is the closest match.',
  ...over,
});

beforeEach(() => {
  useAdmin();
  signIn({ id: 'u1', email: 'me@example.com' });
});

describe('POST /api/feedback — recording votes', () => {
  it('upserts a thumbs up for a signed-in user, keyed by reply and voter', async () => {
    const res = await POST(jsonRequest(URL, body()));
    expect(res.status).toBe(204);
    const [op] = admin.ops('message_feedback', 'upsert');
    expect(op.payload).toMatchObject({
      message_id: MSG,
      voter_key: 'user:u1',
      user_id: 'u1',
      surface: 'analyse',
      conversation_id: CONV,
      pathway_slug: null,
      vote: 1,
      message_excerpt: 'Here is the closest match.',
    });
    expect(op.options).toEqual({ onConflict: 'message_id,voter_key' });
  });

  it('records a thumbs down as -1 (changing a vote is the same upsert)', async () => {
    await POST(jsonRequest(URL, body({ vote: 'down', surface: 'contribute' })));
    expect(admin.ops('message_feedback', 'upsert')[0].payload).toMatchObject({ vote: -1, surface: 'contribute' });
  });

  it('deletes the voter\'s row when the vote is removed (null)', async () => {
    const res = await POST(jsonRequest(URL, body({ vote: null })));
    expect(res.status).toBe(204);
    expect(admin.ops('message_feedback', 'upsert')).toHaveLength(0);
    const [op] = admin.ops('message_feedback', 'delete');
    expect(op.filters).toEqual([
      ['eq', 'message_id', MSG],
      ['eq', 'voter_key', 'user:u1'],
    ]);
  });

  it('lets a signed-out visitor rate an /explore reply, keyed by a hashed IP', async () => {
    signIn(null);
    const res = await POST(
      jsonRequest(URL, body({ surface: 'explore', conversationId: null, pathwaySlug: 'mahavistaar' }), { ip: '9.9.9.9' })
    );
    expect(res.status).toBe(204);
    const payload = admin.ops('message_feedback', 'upsert')[0].payload as Record<string, unknown>;
    expect(payload).toMatchObject({ user_id: null, surface: 'explore', pathway_slug: 'mahavistaar', conversation_id: null });
    expect(payload.voter_key).toMatch(/^anon:[0-9a-f]{64}$/);
    expect(JSON.stringify(admin.queryOps)).not.toContain('9.9.9.9');
  });

  it('collapses whitespace in the excerpt and keeps at most 500 characters', async () => {
    await POST(jsonRequest(URL, body({ excerpt: `a\n\n  b ${'x'.repeat(900)}` })));
    const excerpt = (admin.ops('message_feedback', 'upsert')[0].payload as { message_excerpt: string }).message_excerpt;
    expect(excerpt.startsWith('a b x')).toBe(true);
    expect(excerpt).toHaveLength(500);
  });

  it('accepts a missing excerpt as empty', async () => {
    const { excerpt: _excerpt, ...rest } = body();
    await POST(jsonRequest(URL, rest));
    expect(admin.ops('message_feedback', 'upsert')[0].payload).toMatchObject({ message_excerpt: '' });
  });
});

describe('POST /api/feedback — rejections', () => {
  it('requires a session for Analyse and Contribute replies (401, nothing written)', async () => {
    signIn(null);
    for (const surface of ['analyse', 'contribute']) {
      const res = await POST(jsonRequest(URL, body({ surface })));
      expect(res.status).toBe(401);
    }
    expect(admin.ops('message_feedback')).toHaveLength(0);
  });

  it('is rate-limited first (429, nothing written)', async () => {
    useAdmin({ allowed: false });
    const res = await POST(jsonRequest(URL, body()));
    expect(res.status).toBe(429);
    expect(admin.ops('message_feedback')).toHaveLength(0);
    expect(admin.rpc).toHaveBeenCalledWith('check_rate_limit', expect.objectContaining({ p_per_min: 30, p_per_day: 500 }));
  });

  it('rejects an oversized body with 413', async () => {
    const res = await POST(jsonRequest(URL, body({ excerpt: 'x'.repeat(10_000) })));
    expect(res.status).toBe(413);
    expect(admin.ops('message_feedback')).toHaveLength(0);
  });

  it.each([
    ['malformed JSON', '{not json'],
    ['a non-object', '[1,2]'],
    ['a null body', 'null'],
  ])('rejects %s with 400', async (_label, raw) => {
    const res = await POST(jsonRequest(URL, raw));
    expect(res.status).toBe(400);
  });

  it.each([
    ['a missing messageId', { messageId: undefined }],
    ['a messageId with odd characters', { messageId: 'abc def;drop' }],
    ['an overlong messageId', { messageId: 'a'.repeat(65) }],
    ['an unknown surface', { surface: 'admin' }],
    ['an unknown vote', { vote: 'meh' }],
    ['a numeric vote', { vote: 1 }],
    ['a non-uuid conversationId', { conversationId: 'abc' }],
    ['an overlong pathwaySlug', { pathwaySlug: 'p'.repeat(201) }],
    ['a non-string excerpt', { excerpt: 42 }],
  ])('rejects %s with 400 and writes nothing', async (_label, over) => {
    const res = await POST(jsonRequest(URL, body(over)));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid feedback.' });
    expect(admin.ops('message_feedback')).toHaveLength(0);
  });

  it('answers a database failure with the generic 500 message', async () => {
    useAdmin({ table: { error: { message: 'relation "message_feedback" does not exist' } } });
    const res = await POST(jsonRequest(URL, body()));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: GENERIC_ERROR_MESSAGE });
  });
});
