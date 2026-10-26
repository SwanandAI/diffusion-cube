import { createElement, type ReactNode } from 'react';

// Shared fakes for async Server Component (page/layout) tests under
// tests/pages/server/. vi.mock factories are hoisted above imports, so each
// test file pulls these in with a dynamic import inside the factory:
//
//   vi.mock('next/navigation', async () => (await import('../../helpers/pages-server-mocks')).navigationModule());
//   vi.mock('next/headers', async () => (await import('../../helpers/pages-server-mocks')).headersModule());
//   vi.mock('@/components/AppShell', async () => ({
//     default: (await import('../../helpers/pages-server-mocks')).propsStub('AppShell'),
//   }));
//
// The module instance is shared with the test file's own static import, so
// `requestState` set in a test is what the mocked headers() returns.

// redirect()/notFound() really throw in Next too (control-flow errors), so
// the fakes throw a recognisable error the test can assert on. Plain
// functions, not vi.fn — restoreMocks would wipe a vi.fn's implementation.
export class RedirectError extends Error {
  constructor(readonly path: string) {
    super(`REDIRECT:${path}`);
  }
}

export class NotFoundError extends Error {
  constructor() {
    super('NOT_FOUND');
  }
}

export function navigationModule() {
  const noop = () => {};
  return {
    redirect: (path: string) => {
      throw new RedirectError(path);
    },
    permanentRedirect: (path: string) => {
      throw new RedirectError(path);
    },
    notFound: () => {
      throw new NotFoundError();
    },
    useRouter: () => ({ push: noop, replace: noop, refresh: noop, back: noop, prefetch: noop }),
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
  };
}

// What proxy.ts would have forwarded on this request.
export const requestState: { email: string | null } = { email: null };

export function headersModule() {
  return {
    headers: async () => {
      const h = new Headers();
      if (requestState.email) h.set('x-user-email', requestState.email);
      return h;
    },
    cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => {} }),
  };
}

// A stand-in for a heavy client component: renders its children inside a
// div carrying its other (serialisable) props as JSON, so a test can assert
// exactly what the page handed it.
export function propsStub(testId: string) {
  return function Stub(props: Record<string, unknown>) {
    const { children, ...rest } = props;
    return createElement(
      'div',
      { 'data-testid': testId, 'data-props': JSON.stringify(rest) },
      children as ReactNode
    );
  };
}

export function stubProps<T = Record<string, unknown>>(el: HTMLElement): T {
  return JSON.parse(el.getAttribute('data-props') ?? '{}') as T;
}
