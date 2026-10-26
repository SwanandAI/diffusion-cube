import { describe, expect, it, vi } from 'vitest';
import { RedirectError } from '../../helpers/pages-server-mocks';

vi.mock('next/navigation', async () => (await import('../../helpers/pages-server-mocks')).navigationModule());

import HomePage from '@/app/(app)/page';
import NavigateRedirect from '@/app/navigate/page';

function redirectOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof RedirectError) return e.path;
    throw e;
  }
  return undefined;
}

describe('app/(app)/page.tsx', () => {
  it('sends the landing page to the Library at /explore', () => {
    expect(redirectOf(() => HomePage())).toBe('/explore');
  });
});

describe('app/navigate/page.tsx', () => {
  it('forwards the old Navigate path to /analyse', () => {
    expect(redirectOf(() => NavigateRedirect())).toBe('/analyse');
  });
});
