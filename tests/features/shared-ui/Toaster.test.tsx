// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Toaster from '@/components/Toaster';
import { showToast } from '@/lib/toast';

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Toaster', () => {
  it('renders an empty live region with no toasts', () => {
    const { container } = render(<Toaster />);
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).toBeEmptyDOMElement();
  });

  it('shows a success toast as status and an error toast as alert', () => {
    render(<Toaster />);
    act(() => {
      showToast('Pathway published successfully.');
      showToast('Could not update that role. Please try again.', 'error');
    });
    expect(screen.getByRole('status')).toHaveTextContent('Pathway published successfully.');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not update that role. Please try again.');
  });

  it('does not show the same toast twice (event + queued copy)', () => {
    render(<Toaster />);
    act(() => showToast('Once only'));
    expect(screen.getAllByText('Once only')).toHaveLength(1);
    expect(sessionStorage.getItem('dc:toasts')).toBeNull();
  });

  it('drains toasts queued before mount (fired before a full page load)', () => {
    showToast('Signed out successfully.');
    render(<Toaster />);
    expect(screen.getByText('Signed out successfully.')).toBeInTheDocument();
  });

  it('dismisses a toast via its close button', async () => {
    const user = userEvent.setup();
    render(<Toaster />);
    act(() => showToast('Dismiss me'));
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Dismiss me')).not.toBeInTheDocument();
  });

  it('auto-dismisses after 4 seconds', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => showToast('Temporary'));
    act(() => vi.advanceTimersByTime(3999));
    expect(screen.getByText('Temporary')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Temporary')).not.toBeInTheDocument();
  });

  it('survives corrupt queued storage', () => {
    sessionStorage.setItem('dc:toasts', '{not json');
    render(<Toaster />);
    act(() => showToast('Still works'));
    expect(screen.getByText('Still works')).toBeInTheDocument();
  });

  it('stops listening after unmount', () => {
    const { unmount } = render(<Toaster />);
    unmount();
    expect(() => act(() => showToast('after unmount'))).not.toThrow();
  });
});
