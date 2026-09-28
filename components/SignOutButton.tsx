'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import ConfirmDialog from '@/components/ConfirmDialog';
import { showToast } from '@/lib/toast';

export default function SignOutButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      setSigningOut(false);
      setConfirming(false);
      showToast('Could not sign out. Please try again.', 'error');
      return;
    }
    showToast('Signed out successfully.');
    router.replace('/login');
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        className="text-xs text-ink-soft hover:text-coral border border-navy/15 rounded-lg px-2.5 py-1 transition-colors flex-shrink-0"
      >
        Sign out
      </button>

      {confirming && (
        <ConfirmDialog
          title="Sign out?"
          confirmLabel={signingOut ? 'Signing out…' : 'Sign out'}
          busy={signingOut}
          onConfirm={handleSignOut}
          onCancel={() => setConfirming(false)}
        >
          You&apos;ll need to sign in again to get back to your conversations.
        </ConfirmDialog>
      )}
    </>
  );
}
