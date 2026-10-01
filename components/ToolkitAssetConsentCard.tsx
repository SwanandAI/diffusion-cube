'use client';

import { useState } from 'react';
import { linkDomain, type ToolkitAssetConsentState } from '@/lib/toolkit-assets';

// The single question a contributor answers before a toolkit asset file (or
// link) is stored: public sharing. Rendered by ChatPanel for a
// client-constructed message carrying TOOLKIT_ASSET_CONSENT_MARKER; the
// actual upload/register happens in useAdoptionConversation's
// answerToolkitAssetConsent. Nothing is stored on "No".
export default function ToolkitAssetConsentCard({
  consent,
  fileAvailable,
  onAnswer,
}: {
  consent: ToolkitAssetConsentState;
  // False after a reload: the file was only ever held in memory, so it has
  // to be attached again before it can be shared.
  fileAvailable: boolean;
  onAnswer: (share: boolean) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { candidate, status } = consent;
  const isFile = 'fileName' in candidate.source;
  const where = 'fileName' in candidate.source ? candidate.source.fileName : linkDomain(candidate.source.url) ?? candidate.source.url;

  async function answer(share: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await onAnswer(share);
    if (!result.ok && result.error) setError(result.error);
    setBusy(false);
  }

  return (
    <div className="rounded-xl border border-navy/15 bg-white px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="text-xl" aria-hidden>
          {isFile ? '📎' : '🔗'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-navy">{candidate.name}</p>
          <p className="truncate text-xs text-ink-soft">{where}</p>
          {candidate.purpose && <p className="mt-1 text-sm text-ink">{candidate.purpose}</p>}
        </div>
      </div>

      {status === 'pending' ? (
        <div className="mt-3 border-t border-navy/10 pt-3">
          <p className="text-sm text-navy">
            This looks like a reusable toolkit asset. <span className="font-medium">OK to share this publicly?</span>{' '}
            Anyone using 100 Pathways, including visitors who aren&apos;t signed in, will be able to download it once
            this pathway is approved.
          </p>
          {isFile && !fileAvailable && (
            <p className="mt-2 text-xs text-coral">Attach the file again to share it — it has to be re-selected after the page reloads.</p>
          )}
          {error && <p className="mt-2 text-xs text-coral">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => answer(true)}
              disabled={busy || (isFile && !fileAvailable)}
              className="rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white transition hover:bg-coral disabled:opacity-40"
            >
              {busy ? 'Sharing…' : 'Yes, share'}
            </button>
            <button
              type="button"
              onClick={() => answer(false)}
              disabled={busy}
              className="rounded-lg border border-navy/15 px-3 py-1.5 text-xs font-medium text-navy transition hover:border-navy/40 disabled:opacity-40"
            >
              No
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-3 border-t border-navy/10 pt-3 text-xs text-ink-soft">
          {status === 'shared'
            ? 'Added. It will go live when this pathway is approved.'
            : 'Not shared.'}
        </p>
      )}
    </div>
  );
}
