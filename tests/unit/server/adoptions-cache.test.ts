import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type MockResponse, type SupabaseMock } from '../../helpers/supabase-mock';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
// The real module pulls in React hooks and ChatPanel; only rowToConversation
// matters here.
vi.mock('@/lib/adoption-conversation', () => ({
  rowToConversation: vi.fn((row: { id: string; updated_at: string }) => ({ id: row.id, updatedAt: row.updated_at, converted: true })),
}));

import { createClient } from '@/lib/supabase/client';
import type { AdoptionConversation } from '@/lib/adoption-conversation';

let sb: SupabaseMock;

function designs(response: MockResponse) {
  sb = createSupabaseMock({ tables: { designs: response } });
  vi.mocked(createClient).mockReturnValue(sb.client);
}

// The cache is module-level; every test starts from an empty one.
async function load() {
  vi.resetModules();
  return import('@/lib/adoptions-cache');
}

const ROWS = [
  { id: 'd2', updated_at: '2026-10-02' },
  { id: 'd1', updated_at: '2026-10-01' },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T10:00:00Z'));
  designs({ data: ROWS });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchAdoptionsList', () => {
  it('loads designs newest-first and converts each row', async () => {
    const { fetchAdoptionsList } = await load();
    const list = await fetchAdoptionsList();
    expect(list).toEqual([
      { id: 'd2', updatedAt: '2026-10-02', converted: true },
      { id: 'd1', updatedAt: '2026-10-01', converted: true },
    ]);
    const [op] = sb.ops('designs', 'select');
    expect(op.columns).toBe('*');
    expect(op.filters).toEqual([['order', 'updated_at', { ascending: false }]]);
  });

  it('serves a second call within 60s from memory', async () => {
    const { fetchAdoptionsList } = await load();
    const first = await fetchAdoptionsList();
    vi.advanceTimersByTime(59_999);
    expect(await fetchAdoptionsList()).toBe(first);
    expect(sb.ops('designs')).toHaveLength(1);
  });

  it('re-fetches once the 60s TTL has passed', async () => {
    const { fetchAdoptionsList } = await load();
    await fetchAdoptionsList();
    vi.advanceTimersByTime(60_000);
    await fetchAdoptionsList();
    expect(sb.ops('designs')).toHaveLength(2);
  });

  it('throws the Supabase error and caches nothing', async () => {
    designs({ error: { message: 'JWT expired' } });
    const { fetchAdoptionsList } = await load();
    await expect(fetchAdoptionsList()).rejects.toMatchObject({ message: 'JWT expired' });
    designs({ data: ROWS });
    expect(await fetchAdoptionsList()).toHaveLength(2);
  });
});

describe('setAdoptionsListCache', () => {
  it('replaces the cached list immediately, without waiting out the TTL', async () => {
    const { fetchAdoptionsList, setAdoptionsListCache } = await load();
    await fetchAdoptionsList();
    const next = [{ id: 'new' }] as unknown as AdoptionConversation[];
    setAdoptionsListCache(next);
    expect(await fetchAdoptionsList()).toBe(next);
    expect(sb.ops('designs')).toHaveLength(1);
  });

  it('primes an empty cache and restarts the TTL', async () => {
    const { fetchAdoptionsList, setAdoptionsListCache } = await load();
    const next = [] as AdoptionConversation[];
    setAdoptionsListCache(next);
    vi.advanceTimersByTime(30_000);
    expect(await fetchAdoptionsList()).toBe(next);
    expect(sb.ops('designs')).toHaveLength(0);
  });
});

describe('fetchAdoption', () => {
  it('reads one design fresh by id, ignoring a warm list cache', async () => {
    const { fetchAdoptionsList, fetchAdoption } = await load();
    await fetchAdoptionsList();
    designs({ data: { id: 'd9', updated_at: '2026-10-26' } });
    expect(await fetchAdoption('d9')).toEqual({ id: 'd9', updatedAt: '2026-10-26', converted: true });
    const [op] = sb.ops('designs', 'select');
    expect(op.filters).toEqual([['eq', 'id', 'd9']]);
    expect(op.single).toBe('maybeSingle');
  });

  it('is null when the row does not exist', async () => {
    designs({ data: null });
    const { fetchAdoption } = await load();
    expect(await fetchAdoption('missing')).toBeNull();
  });

  it('is null on error', async () => {
    designs({ error: { message: 'rls' } });
    const { fetchAdoption } = await load();
    expect(await fetchAdoption('d1')).toBeNull();
  });
});
