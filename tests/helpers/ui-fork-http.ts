import { vi } from 'vitest';

// Minimal fetch stand-ins for component tests. No real network is ever used.

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

type Route = (call: FetchCall) => Response | Promise<Response> | undefined;

// Stubs global fetch with a router; records every call. An unrouted call
// returns 404 so a test notices it instead of hanging.
export function stubFetch(route: Route) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    let body: unknown = init?.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // leave as string
      }
    }
    const call = { url, method: (init?.method ?? 'GET').toUpperCase(), body };
    calls.push(call);
    const res = await route(call);
    return res ?? jsonResponse({ error: 'unrouted' }, 404);
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

// A promise whose resolution the test controls — for "while pending" states.
export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
