// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportClientError } from '@/lib/client-error-report';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState(null, '', '/strengthen?open=abc');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1]?.body as string);

describe('reportClientError', () => {
  it('posts a browser error to /api/errors/client with keepalive', () => {
    const err = new Error('Cannot read properties of undefined');
    reportClientError(err);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/errors/client');
    expect(init).toMatchObject({ method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' } });
    expect(sentBody()).toEqual({ message: err.message, stack: err.stack, path: '/strengthen' });
  });

  it('sends the pathname only — never the query string', () => {
    reportClientError(new Error('x'));
    expect(sentBody().path).toBe('/strengthen');
    expect(JSON.stringify(sentBody())).not.toContain('open=abc');
  });

  it('does not send a server error (one that carries a digest)', () => {
    reportClientError(Object.assign(new Error('server'), { digest: '12345' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('truncates message to 2000 and stack to 8000 chars', () => {
    const err = new Error('m'.repeat(5000));
    err.stack = 's'.repeat(20000);
    reportClientError(err);
    expect(sentBody().message).toHaveLength(2000);
    expect(sentBody().stack).toHaveLength(8000);
  });

  it('sends empty strings for a missing message/stack', () => {
    const err = new Error();
    err.stack = undefined;
    reportClientError(err);
    expect(sentBody()).toMatchObject({ message: '', stack: '' });
  });

  it('swallows a rejected fetch', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    expect(() => reportClientError(new Error('x'))).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('swallows a synchronous throw from fetch', () => {
    fetchMock.mockImplementation(() => {
      throw new TypeError('keepalive body too large');
    });
    expect(() => reportClientError(new Error('x'))).not.toThrow();
  });
});
