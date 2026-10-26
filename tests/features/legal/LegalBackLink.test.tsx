// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';

const search = { params: new URLSearchParams() };
const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => search.params,
}));

import LegalBackLink from '@/components/LegalBackLink';

let close: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  sessionStorage.clear();
  search.params = new URLSearchParams();
  router.push.mockClear();
  close = vi.spyOn(window, 'close').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
});

const link = () => screen.getByRole('link', { name: /Back/ });

describe('LegalBackLink', () => {
  it('opened directly: a plain link to 100pathways.com', () => {
    render(<LegalBackLink />);
    expect(link()).toHaveAttribute('href', 'https://100pathways.com/');
    const notPrevented = fireEvent.click(link());
    expect(notPrevented).toBe(true);
    expect(close).not.toHaveBeenCalled();
  });

  it('ignores an unknown ?from= value', () => {
    search.params = new URLSearchParams('from=evil');
    render(<LegalBackLink />);
    expect(link()).toHaveAttribute('href', 'https://100pathways.com/');
    expect(sessionStorage.getItem('legal-back-from')).toBeNull();
  });

  it('?from=signup links back to the sign-up form and remembers it', () => {
    search.params = new URLSearchParams('from=signup');
    render(<LegalBackLink />);
    expect(link()).toHaveAttribute('href', '/login?mode=signup');
    expect(sessionStorage.getItem('legal-back-from')).toBe('signup');
  });

  it('clicking closes the tab, then falls back to navigating if still open', () => {
    vi.useFakeTimers();
    search.params = new URLSearchParams('from=contribute');
    render(<LegalBackLink />);
    const notPrevented = fireEvent.click(link());
    expect(notPrevented).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(150));
    expect(router.push).toHaveBeenCalledWith('/contribute');
  });

  it('uses the remembered origin after a Terms ↔ Privacy hop without ?from=', () => {
    vi.useFakeTimers();
    sessionStorage.setItem('legal-back-from', 'signup');
    render(<LegalBackLink />);
    // href is the site home (no param) but the click still returns to the form.
    expect(link()).toHaveAttribute('href', 'https://100pathways.com/');
    fireEvent.click(link());
    expect(close).toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(150));
    expect(router.push).toHaveBeenCalledWith('/login?mode=signup');
  });

  it('ignores a tampered stored value', () => {
    sessionStorage.setItem('legal-back-from', 'javascript:alert(1)');
    render(<LegalBackLink />);
    expect(fireEvent.click(link())).toBe(true);
    expect(close).not.toHaveBeenCalled();
  });
});
