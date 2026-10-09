'use client';

import { useState } from 'react';
import { useConfirm } from '@/components/ConfirmDialog';
import type { PublishConsentState } from '@/lib/toolkit-assets';

type Choice = 'send' | 'keep' | 'delete';

// "May this pathway be published?" — asked before every Send for Review
// (useAdoptionConversation's requestPublishConsent), from the document pane's
// button or when the contributor asks in chat. Yes sends it for review; No
// either keeps it as a private draft or deletes the contribution (workspace,
// drafts and every not-yet-live toolkit asset file shared from it).
// Rendered by ChatPanel for a client-constructed message carrying
// PUBLISH_CONSENT_MARKER.
export default function PublishConsentCard({
  consent,
  onAnswer,
}: {
  consent: PublishConsentState;
  onAnswer: (choice: Choice) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [working, setWorking] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function answer(choice: Choice) {
    if (working) return;
    if (choice === 'delete') {
      const ok = await confirm({
        title: 'Delete this contribution?',
        message:
          "This deletes this workspace, its pathway drafts, and every toolkit asset file you shared from it that isn't live yet. Anything already published stays. This can't be undone.",
        confirmLabel: 'Delete contribution',
        danger: true,
      });
      if (!ok) return;
    }
    setWorking(choice);
    setError(null);
    const result = await onAnswer(choice);
    setWorking(null);
    if (!result.ok) {
      if (result.error) setError(result.error);
      return;
    }
    if (choice === 'delete') window.location.assign('/contribute');
  }

  return (
    <div className="rounded-xl border border-navy/15 bg-white px-4 py-3">
      {dialog}
      <p className="text-sm font-medium text-navy">Ready to send for review?</p>
      {consent.status === 'pending' ? (
        <>
          <p className="mt-1 text-sm text-ink">
            Please confirm that the current version of the pathway is accurate, and that it may be published on 100
            Pathways to help future adopters once an administrator has reviewed and approved it.
          </p>
          {error && <p className="mt-2 text-xs text-coral">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => answer('send')}
              disabled={working !== null}
              className="rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white transition hover:bg-coral disabled:opacity-40"
            >
              {working === 'send' ? 'Sending…' : 'Yes, send for review'}
            </button>
            <button
              type="button"
              onClick={() => answer('keep')}
              disabled={working !== null}
              className="rounded-lg border border-navy/15 px-3 py-1.5 text-xs font-medium text-navy transition hover:border-navy/40 disabled:opacity-40"
            >
              No, keep it as a private draft
            </button>
            <button
              type="button"
              onClick={() => answer('delete')}
              disabled={working !== null}
              className="rounded-lg border border-coral/30 px-3 py-1.5 text-xs font-medium text-coral transition hover:bg-coral hover:text-white disabled:opacity-40"
            >
              {working === 'delete' ? 'Deleting…' : 'No, delete this contribution'}
            </button>
          </div>
        </>
      ) : (
        <p className="mt-1 text-xs text-ink-soft">
          {consent.status === 'sent'
            ? 'Confirmed and sent for review.'
            : consent.status === 'kept'
              ? 'Kept as a private draft. You can send it for review whenever you like.'
              : 'This contribution was deleted.'}
        </p>
      )}
    </div>
  );
}
