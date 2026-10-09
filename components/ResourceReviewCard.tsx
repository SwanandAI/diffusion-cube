'use client';

import { useRef, useState, type ReactNode } from 'react';
import { linkDomain, type ResourceReviewItem, type ResourceReviewState } from '@/lib/toolkit-assets';

type Result = { ok: boolean; error?: string };

// The contributor's resource review (see ResourceReviewState in
// lib/toolkit-assets.ts): every potentially reusable resource found in their
// material, decided one by one, then "any other resource to share?". The
// actions live in useAdoptionConversation; this card only renders the state
// and collects answers. Rendered by ChatPanel for a client-constructed
// message carrying RESOURCE_REVIEW_MARKER.
export default function ResourceReviewCard({
  review,
  busy,
  fileAvailable,
  onRememberFile,
  onDecide,
  onAttach,
  onLink,
  onFinish,
}: {
  review: ResourceReviewState;
  // A companion turn is running — attaching and finishing wait for it.
  busy: boolean;
  // False after a reload for a file only ever held in memory.
  fileAvailable: (fileName: string) => boolean;
  onRememberFile: (file: File) => void;
  onDecide: (itemKey: string, share: boolean) => Promise<Result>;
  onAttach: (itemKey: string | null, file: File) => void;
  onLink: (itemKey: string | null, url: string) => Result;
  onFinish: () => void;
}) {
  const open = review.status === 'open';
  const undecided = review.items.filter((i) => i.status === 'pending').length;

  return (
    <div className="rounded-xl border border-navy/15 bg-white px-4 py-3">
      <p className="text-sm font-medium text-navy">Files other teams can reuse</p>
      <p className="mt-0.5 text-xs text-ink-soft">
        {review.items.length > 0
          ? "We found these in your documents. Choose Share or Don't share for each one."
          : "We didn't find any reusable files (like a template, checklist or tool) in your documents."}
      </p>

      {review.items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {review.items.map((item) => (
            <ResourceRow
              key={item.key}
              item={item}
              open={open}
              busy={busy}
              fileAvailable={fileAvailable}
              onRememberFile={onRememberFile}
              onDecide={(share) => onDecide(item.key, share)}
              onAttach={(file) => onAttach(item.key, file)}
              onLink={(url) => onLink(item.key, url)}
            />
          ))}
        </ul>
      )}

      {/* Its own box: a separate question from the items above. */}
      {open && undecided === 0 && (
        <div className="mt-3 rounded-lg bg-paper-dim px-3 py-2.5">
          <p className="text-sm font-medium text-navy">Anything else to share?</p>
          <p className="mt-0.5 text-xs text-ink-soft">A template, checklist, tool or link that other teams could use.</p>
          <AttachControls
            busy={busy}
            attachLabel="Add a file"
            onAttach={(file) => onAttach(null, file)}
            onLink={(url) => onLink(null, url)}
          >
            <button
              type="button"
              onClick={onFinish}
              disabled={busy}
              className="rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white transition hover:bg-coral disabled:opacity-40"
            >
              {review.generateOnComplete ? 'No, draft my pathway' : "No, I'm done"}
            </button>
          </AttachControls>
        </div>
      )}
      {open && undecided > 0 && (
        <p className="mt-3 border-t border-navy/10 pt-3 text-xs text-ink-soft">
          {undecided} left to decide.
        </p>
      )}
      {!open && <p className="mt-3 border-t border-navy/10 pt-3 text-xs text-ink-soft">All done.</p>}
    </div>
  );
}

function ResourceRow({
  item,
  open,
  busy,
  fileAvailable,
  onRememberFile,
  onDecide,
  onAttach,
  onLink,
}: {
  item: ResourceReviewItem;
  open: boolean;
  busy: boolean;
  fileAvailable: (fileName: string) => boolean;
  onRememberFile: (file: File) => void;
  onDecide: (share: boolean) => Promise<Result>;
  onAttach: (file: File) => void;
  onLink: (url: string) => Result;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reattached, setReattached] = useState(false);
  const reattachRef = useRef<HTMLInputElement>(null);

  const candidate = item.candidate;
  const isFile = candidate ? 'fileName' in candidate.source : false;
  const sourceLabel = candidate
    ? 'fileName' in candidate.source
      ? candidate.source.fileName
      : (linkDomain(candidate.source.url) ?? candidate.source.url)
    : item.mentionedIn
      ? `Named in ${item.mentionedIn}, but not attached`
      : 'Named in your message, but not attached';
  const missingFile =
    candidate && 'fileName' in candidate.source && !reattached && !fileAvailable(candidate.source.fileName);

  async function decide(share: boolean) {
    if (working) return;
    setWorking(true);
    setError(null);
    const result = await onDecide(share);
    if (!result.ok && result.error) setError(result.error);
    setWorking(false);
  }

  function reattach(file: File | undefined) {
    if (!file || !candidate || !('fileName' in candidate.source)) return;
    if (file.name !== candidate.source.fileName) {
      setError(`Choose the same file: ${candidate.source.fileName}`);
      return;
    }
    onRememberFile(file);
    setReattached(true);
    setError(null);
  }

  return (
    <li className="rounded-lg border border-navy/10 px-3 py-2">
      <div className="flex items-start gap-2">
        <span aria-hidden className="text-base">{candidate ? (isFile ? '📎' : '🔗') : '📝'}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-navy">{item.name}</p>
          <p className="truncate text-xs text-ink-soft">{sourceLabel}</p>
          {candidate?.purpose && <p className="mt-1 text-xs text-ink">{candidate.purpose}</p>}
          {candidate?.sensitiveNote && item.status === 'pending' && (
            <p className="mt-1 rounded bg-yellow/20 px-2 py-1 text-xs text-navy">
              ⚠ This may contain personal or private data: {candidate.sensitiveNote} Remove it before sharing if it
              shouldn&apos;t be public.
            </p>
          )}
        </div>
        {item.status !== 'pending' && (
          <span className="flex-shrink-0 rounded-full bg-paper-dim px-2 py-0.5 text-[11px] text-ink-soft">
            {item.status === 'shared'
              ? 'Shared · public after approval'
              : item.status === 'declined'
                ? 'Not shared'
                : 'Used for the pathway only'}
          </span>
        )}
      </div>

      {open && item.status === 'pending' && (
        <div className="mt-2">
          {item.attachedSource ? (
            <p className="animate-pulse text-xs text-ink-soft">Checking the file…</p>
          ) : candidate ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {missingFile ? (
                  <>
                    <input
                      ref={reattachRef}
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        reattach(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => reattachRef.current?.click()}
                      className="rounded-lg border border-navy/15 px-3 py-1.5 text-xs font-medium text-navy transition hover:border-navy/40"
                    >
                      Select the file again to share it
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => decide(true)}
                    disabled={working}
                    className="rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white transition hover:bg-coral disabled:opacity-40"
                  >
                    {working ? 'Sharing…' : 'Share'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => decide(false)}
                  disabled={working}
                  className="rounded-lg border border-navy/15 px-3 py-1.5 text-xs font-medium text-navy transition hover:border-navy/40 disabled:opacity-40"
                >
                  Don&apos;t share
                </button>
              </div>
              {/* Clicking Share is the consent — this line is what it agrees to. */}
              <p className="mt-1.5 text-[11px] text-ink-soft">
                Once an admin approves this pathway, anyone can download what you share. Only share files
                you&apos;re allowed to share.
              </p>
            </>
          ) : (
            <AttachControls busy={busy} attachLabel="Add the file" onAttach={onAttach} onLink={onLink}>
              <button
                type="button"
                onClick={() => decide(false)}
                disabled={working}
                className="rounded-lg border border-navy/15 px-3 py-1.5 text-xs font-medium text-navy transition hover:border-navy/40 disabled:opacity-40"
              >
                Don&apos;t share
              </button>
            </AttachControls>
          )}
          {error && <p className="mt-1 text-xs text-coral">{error}</p>}
        </div>
      )}
    </li>
  );
}

// Attach a file / paste an https link, plus whatever the caller adds (the
// decline or finish button).
function AttachControls({
  busy,
  attachLabel,
  onAttach,
  onLink,
  children,
}: {
  busy: boolean;
  attachLabel: string;
  onAttach: (file: File) => void;
  onLink: (url: string) => Result;
  children?: ReactNode;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submitLink() {
    const result = onLink(url);
    if (!result.ok) {
      setError(result.error ?? null);
      return;
    }
    setUrl('');
    setLinking(false);
    setError(null);
  }

  return (
    <div className="mt-2">
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onAttach(file);
          e.target.value = '';
        }}
      />
      {linking ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitLink();
            }}
            placeholder="https://…"
            className="min-w-0 flex-1 rounded-lg border border-navy/15 bg-white px-2 py-1.5 text-xs text-ink"
          />
          <button
            type="button"
            onClick={submitLink}
            disabled={busy || !url.trim()}
            className="rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white transition hover:bg-coral disabled:opacity-40"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setLinking(false)}
            className="text-xs text-ink-soft hover:text-navy"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="rounded-lg border border-navy/15 px-3 py-1.5 text-xs font-medium text-navy transition hover:border-navy/40 disabled:opacity-40"
          >
            {attachLabel}
          </button>
          <button
            type="button"
            onClick={() => setLinking(true)}
            disabled={busy}
            className="rounded-lg border border-navy/15 px-3 py-1.5 text-xs font-medium text-navy transition hover:border-navy/40 disabled:opacity-40"
          >
            Add a link
          </button>
          {children}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-coral">{error}</p>}
    </div>
  );
}
