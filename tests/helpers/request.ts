// Builders for the Request objects route handlers receive.

export function jsonRequest(url: string, body: unknown, init: RequestInit & { ip?: string } = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (init.ip) headers.set('x-forwarded-for', init.ip);
  return new Request(url, {
    method: 'POST',
    ...init,
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export function getRequest(url: string, init: RequestInit & { ip?: string } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.ip) headers.set('x-forwarded-for', init.ip);
  return new Request(url, { method: 'GET', ...init, headers });
}

// Route handlers for dynamic segments get their params as a promise (Next 16).
export function routeParams<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}
