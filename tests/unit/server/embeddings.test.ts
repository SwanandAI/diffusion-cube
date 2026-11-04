import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/errors', () => ({ logError: vi.fn() }));

import { logError } from '@/lib/errors';
import { EMBEDDING_DIMENSIONS, embedTexts, toPgVector } from '@/lib/embeddings';

const fetchMock = vi.fn<typeof fetch>();

function vec(seed: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => seed + i / 1000);
}

// Answers each call with one vector per text, seeded by the text itself so
// order can be checked.
function echoEmbeddings() {
  fetchMock.mockImplementation(async (_url, init) => {
    const { texts } = JSON.parse(String(init?.body)) as { texts: string[] };
    return new Response(JSON.stringify({ embeddings: texts.map((t) => vec(Number(t))) }), { status: 200 });
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('embedTexts', () => {
  it('calls the embed Edge Function with the service-role key', async () => {
    echoEmbeddings();
    await embedTexts(['1']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://supabase.test/functions/v1/embed');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-service-role-key');
  });

  it('splits 10 texts into batches of 4, 4 and 2 and keeps input order', async () => {
    echoEmbeddings();
    const texts = Array.from({ length: 10 }, (_, i) => String(i));
    const out = await embedTexts(texts);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sizes = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).texts.length);
    expect(sizes).toEqual([4, 4, 2]);
    expect(out).toHaveLength(10);
    expect(out.map((v) => v[0])).toEqual(texts.map(Number));
  });

  it('returns [] for no texts without calling the function', async () => {
    expect(await embedTexts([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries a busy / over-limit answer (546, 503) and then succeeds', async () => {
    vi.useFakeTimers();
    let calls = 0;
    fetchMock.mockImplementation(async () => {
      calls++;
      if (calls === 1) return new Response('limit', { status: 546 });
      if (calls === 2) return new Response('busy', { status: 503 });
      return new Response(JSON.stringify({ embeddings: [vec(7)] }), { status: 200 });
    });
    const promise = embedTexts(['7']);
    await vi.runAllTimersAsync();
    expect((await promise)[0][0]).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('gives up after two retries', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => new Response('limit', { status: 546 }));
    const promise = embedTexts(['1']);
    const settled = expect(promise).rejects.toThrow(/546/);
    await vi.runAllTimersAsync();
    await settled;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('throws and logs (without the text) when the function fails, without retrying a 500', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(embedTexts(['secret text'])).rejects.toThrow(/500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith('lib/embeddings', expect.any(Error), { count: 1 });
    expect(JSON.stringify(vi.mocked(logError).mock.calls)).not.toContain('secret text');
  });

  it('retries a dropped connection, and throws once the retries are used up', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(
      new Response(JSON.stringify({ embeddings: [vec(3)] }), { status: 200 })
    );
    const ok = embedTexts(['3']);
    await vi.runAllTimersAsync();
    expect((await ok)[0][0]).toBe(3);

    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const failing = embedTexts(['1']);
    const settled = expect(failing).rejects.toThrow();
    await vi.runAllTimersAsync();
    await settled;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('rejects malformed answers rather than returning partial vectors', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ embeddings: [[1, 2, 3]] }), { status: 200 }));
    await expect(embedTexts(['1'])).rejects.toThrow(/malformed/);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ embeddings: [] }), { status: 200 }));
    await expect(embedTexts(['1'])).rejects.toThrow(/malformed/);
  });
});

describe('toPgVector', () => {
  it("formats pgvector's text form", () => {
    expect(toPgVector([0.1, -2, 3])).toBe('[0.1,-2,3]');
  });
});
