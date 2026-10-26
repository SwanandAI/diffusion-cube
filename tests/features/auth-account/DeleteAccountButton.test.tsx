// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createSupabaseMock, type SupabaseMock } from '../../helpers/supabase-mock';
import { deferred, jsonResponse, stubFetch } from '../../helpers/ui-fork-http';

const router = { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { showToast } from '@/lib/toast';
import DeleteAccountButton from '@/components/DeleteAccountButton';

let sb: SupabaseMock;

beforeEach(() => {
  sb = createSupabaseMock({ user: { id: 'u1', email: 'a@b.c' } });
  vi.mocked(createClient).mockReturnValue(sb.client);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openDialog() {
  const user = userEvent.setup();
  render(<DeleteAccountButton />);
  await user.click(screen.getByRole('button', { name: 'Delete account' }));
  const dialog = screen.getByRole('dialog');
  return { user, dialog, password: within(dialog).getByLabelText('Enter your password to confirm') };
}

function confirmButton(dialog: HTMLElement) {
  // The trigger behind the overlay has the same label; scope to the dialog.
  return within(dialog).getByRole('button', { name: /Delete account|Deleting…/ });
}

describe('DeleteAccountButton', () => {
  it('renders the link variant by default and the danger variant on request', () => {
    const { unmount } = render(<DeleteAccountButton />);
    expect(screen.getByRole('button', { name: 'Delete account' }).className).toContain('text-[11px]');
    unmount();
    render(<DeleteAccountButton variant="danger" />);
    expect(screen.getByRole('button', { name: 'Delete account' }).className).toContain('border-coral/40');
  });

  it('opens a confirm dialog with the confirm button disabled until a password is typed', async () => {
    const { user, dialog, password } = await openDialog();
    expect(within(dialog).getByText('Delete your account?')).toBeInTheDocument();
    expect(password).toHaveAttribute('type', 'password');
    expect(confirmButton(dialog)).toBeDisabled();
    await user.type(password, 'secret');
    expect(confirmButton(dialog)).toBeEnabled();
  });

  it('does not call the API when submitted with an empty password', async () => {
    const { fn } = stubFetch(() => jsonResponse({ ok: true }));
    const { user, password } = await openDialog();
    await user.click(password);
    await user.keyboard('{Enter}');
    expect(fn).not.toHaveBeenCalled();
  });

  it('deletes with the password, signs out locally, toasts and goes to /login', async () => {
    const { calls } = stubFetch(() => jsonResponse({ ok: true }));
    const { user, dialog, password } = await openDialog();
    await user.type(password, 'hunter2');
    await user.click(confirmButton(dialog));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
    expect(calls).toEqual([{ url: '/api/account/delete', method: 'POST', body: { password: 'hunter2' } }]);
    expect(sb.auth.signOut).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('Your account has been deleted successfully.');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('submits via Enter in the password field', async () => {
    const { calls } = stubFetch(() => jsonResponse({ ok: true }));
    const { user, password } = await openDialog();
    await user.type(password, 'pw{Enter}');
    await waitFor(() => expect(calls).toHaveLength(1));
  });

  it('shows Deleting…, disables everything and ignores repeat clicks while pending', async () => {
    const pending = deferred<Response>();
    const { fn } = stubFetch(() => pending.promise);
    const { user, dialog, password } = await openDialog();
    await user.type(password, 'pw');
    await user.click(confirmButton(dialog));
    const busy = within(dialog).getByRole('button', { name: 'Deleting…' });
    expect(busy).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(password).toBeDisabled();
    await user.click(busy);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(fn).toHaveBeenCalledTimes(1);
    pending.resolve(jsonResponse({ ok: true }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
  });

  it('shows the server error (e.g. wrong password) and keeps the dialog open', async () => {
    stubFetch(() => jsonResponse({ error: 'Incorrect password.' }, 401));
    const { user, dialog, password } = await openDialog();
    await user.type(password, 'wrong');
    await user.click(confirmButton(dialog));
    expect(await within(dialog).findByText('Incorrect password.')).toBeInTheDocument();
    expect(sb.auth.signOut).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(confirmButton(dialog)).toBeEnabled();
  });

  it('clears the error as soon as the password is edited', async () => {
    stubFetch(() => jsonResponse({ error: 'Incorrect password.' }, 401));
    const { user, dialog, password } = await openDialog();
    await user.type(password, 'wrong');
    await user.click(confirmButton(dialog));
    await within(dialog).findByText('Incorrect password.');
    await user.type(password, 'x');
    expect(within(dialog).queryByText('Incorrect password.')).not.toBeInTheDocument();
  });

  it('falls back to a generic error when the failure body is not JSON', async () => {
    stubFetch(() => new Response('gateway', { status: 502 }));
    const { user, dialog, password } = await openDialog();
    await user.type(password, 'pw');
    await user.click(confirmButton(dialog));
    expect(await within(dialog).findByText('Could not delete your account. Please try again.')).toBeInTheDocument();
  });

  it('warns that the account state is unknown after a network error', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const { user, dialog, password } = await openDialog();
    await user.type(password, 'pw');
    await user.click(confirmButton(dialog));
    expect(await within(dialog).findByText(/may or may not have been deleted/)).toBeInTheDocument();
    expect(sb.auth.signOut).not.toHaveBeenCalled();
  });

  it('Cancel closes the dialog and resets password and error', async () => {
    stubFetch(() => jsonResponse({ error: 'Incorrect password.' }, 401));
    const { user, dialog, password } = await openDialog();
    await user.type(password, 'wrong');
    await user.click(confirmButton(dialog));
    await within(dialog).findByText('Incorrect password.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    const reopened = screen.getByRole('dialog');
    expect(within(reopened).getByLabelText('Enter your password to confirm')).toHaveValue('');
    expect(within(reopened).queryByText('Incorrect password.')).not.toBeInTheDocument();
  });

  it('the Show toggle reveals the password', async () => {
    const { user, dialog, password } = await openDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
  });
});
