'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import ConfirmDialog from '@/components/ConfirmDialog';
import PasswordInput from '@/components/PasswordInput';
import { showToast } from '@/lib/toast';

// Permanent self-serve deletion — see app/api/account/delete and
// specs/ACCOUNT_DELETION_SPEC.md. The account password is the confirmation;
// the route re-verifies it server-side before deleting anything. Lives in the
// Manage Account page's Danger zone (app/account/ManageAccount.tsx).
export default function DeleteAccountButton({ variant = 'link' }: { variant?: 'link' | 'danger' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setPassword('');
    setError(null);
  }

  async function handleDelete() {
    if (!password || deleting) return;
    setDeleting(true);
    setError(null);

    let res: Response;
    try {
      res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
    } catch {
      // The request may or may not have reached the server before the
      // connection dropped, so the account's state is unknown here.
      setDeleting(false);
      setError('Network error — your account may or may not have been deleted. Reload the page to check.');
      return;
    }

    if (!res.ok) {
      setDeleting(false);
      const { error } = await res.json().catch(() => ({}));
      setError(error || 'Could not delete your account. Please try again.');
      return;
    }

    // The user no longer exists server-side; this just clears the local session.
    await createClient().auth.signOut();
    showToast('Your account has been deleted successfully.');
    router.replace('/login');
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          variant === 'danger'
            ? 'self-start rounded-lg border border-coral/40 px-5 py-2 text-sm font-medium text-coral transition-colors hover:bg-coral hover:text-white'
            : 'text-[11px] text-ink-soft/70 hover:text-coral transition-colors'
        }
      >
        Delete account
      </button>

      {open && (
        <ConfirmDialog
          title="Delete your account?"
          confirmLabel={deleting ? 'Deleting…' : 'Delete account'}
          danger
          confirmDisabled={!password}
          busy={deleting}
          error={error}
          onConfirm={handleDelete}
          onCancel={close}
        >
          <p>
            This permanently deletes your account and all your conversation history. It can&apos;t be undone.
            Anything you&apos;ve published stays live.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleDelete();
            }}
          >
            <label htmlFor="delete-password" className="mt-4 mb-1 block text-xs text-ink-soft">
              Enter your password to confirm
            </label>
            <PasswordInput
              id="delete-password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              disabled={deleting}
            />
          </form>
        </ConfirmDialog>
      )}
    </>
  );
}
