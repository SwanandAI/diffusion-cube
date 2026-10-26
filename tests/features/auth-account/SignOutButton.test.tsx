// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createSupabaseMock, type SupabaseMock } from '../../helpers/supabase-mock';
import { deferred } from '../../helpers/ui-fork-http';

const router = { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { showToast } from '@/lib/toast';
import SignOutButton from '@/components/SignOutButton';

let sb: SupabaseMock;
beforeEach(() => {
  sb = createSupabaseMock({ user: { id: 'u1', email: 'a@b.c' } });
  vi.mocked(createClient).mockReturnValue(sb.client);
  router.replace.mockClear();
  router.refresh.mockClear();
  vi.mocked(showToast).mockClear();
});

async function openConfirm() {
  const user = userEvent.setup();
  render(<SignOutButton />);
  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  return { user, dialog: screen.getByRole('dialog', { name: 'Sign out?' }) };
}

describe('SignOutButton', () => {
  it('asks for confirmation before signing out', async () => {
    const { dialog } = await openConfirm();
    expect(within(dialog).getByText(/sign in again to get back to your conversations/)).toBeInTheDocument();
    expect(sb.auth.signOut).not.toHaveBeenCalled();
  });

  it('cancel closes the dialog without signing out', async () => {
    const { user, dialog } = await openConfirm();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(sb.auth.signOut).not.toHaveBeenCalled();
  });

  it('confirm signs out, toasts and goes to /login', async () => {
    const { user, dialog } = await openConfirm();
    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
    expect(sb.auth.signOut).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('Signed out successfully.');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('on failure closes the dialog, shows an error toast and stays put', async () => {
    sb.auth.signOut.mockResolvedValueOnce({ error: { message: 'network' } } as never);
    const { user, dialog } = await openConfirm();
    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not sign out. Please try again.', 'error'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
    // Can try again.
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows Signing out… and blocks buttons/Escape while in flight', async () => {
    const gate = deferred<{ error: null }>();
    sb.auth.signOut.mockReturnValueOnce(gate.promise as never);
    const { user, dialog } = await openConfirm();
    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }));
    const busy = within(dialog).getByRole('button', { name: 'Signing out…' });
    expect(busy).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(busy);
    expect(sb.auth.signOut).toHaveBeenCalledTimes(1);
    gate.resolve({ error: null });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
  });
});
