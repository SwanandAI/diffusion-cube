'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useConfirm } from '@/components/ConfirmDialog';

// Generate / Regenerate for the admin Feedback Digest
// (docs/features/feedback-digest/, FD-07). Asks for a plain confirmation
// (no cost in it — business decision D6), then calls POST /api/admin/digest.
// The previous digest stays until a new one is saved, so a failure only
// shows a message. withErrorHandling replaces any 5xx body with the generic
// text, so the wording for each outcome lives here.

export const DIGEST_MESSAGES = {
  busy: 'A digest is already being generated. Try again in a few minutes.',
  superseded: 'Another digest was generated meanwhile.',
  dailyLimit: "Today's digest limit is reached. It resets at midnight IST.",
  failed: "The digest couldn't be generated just now. The previous digest is unchanged; please try again.",
} as const;

export default function GenerateButton({ period, hasDigest }: { period: 7 | 30; hasDigest: boolean }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (busy) return;
    const ok = await confirm({
      title: `Regenerate the digest for the last ${period} days?`,
      confirmLabel: 'Regenerate',
    });
    if (!ok) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodDays: period }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      if (res.status === 409 && body.error === 'superseded') {
        setError(DIGEST_MESSAGES.superseded);
        router.refresh();
      } else if (res.status === 409) {
        setError(DIGEST_MESSAGES.busy);
      } else if (res.status === 429) {
        setError(DIGEST_MESSAGES.dailyLimit);
      } else {
        setError(DIGEST_MESSAGES.failed);
      }
    } catch {
      setError(DIGEST_MESSAGES.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <button
        type="button"
        onClick={() => void generate()}
        disabled={busy}
        className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-coral disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? 'Generating…' : hasDigest ? 'Regenerate' : 'Generate digest'}
      </button>
      {busy && <p className="text-xs text-ink-soft">Generating… this can take a minute or two.</p>}
      {error && (
        <p role="alert" className="max-w-xs text-xs text-coral sm:text-right">
          {error}
        </p>
      )}
      {dialog}
    </div>
  );
}
