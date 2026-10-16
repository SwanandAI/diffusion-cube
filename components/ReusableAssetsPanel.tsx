'use client';

import { useRef, useState } from 'react';
import { sourceLabel, type AssetShareItem, type AssetShareState } from '@/lib/toolkit-assets';

type Result = { ok: boolean; error?: string };

export interface ReusableAssetsActions {
  stageFiles: (cardId: string, itemKey: string | null, files: File[]) => Result;
  unstage: (cardId: string, itemKey: string) => void;
  rename: (cardId: string, itemKey: string, name: string) => void;
  describe: (cardId: string, itemKey: string, text: string) => void;
  remove: (cardId: string, itemKey: string) => Promise<Result>;
  deleteAsset: (cardId: string, itemKey: string) => Promise<Result>;
  confirmAll: () => Promise<Result>;
}

// The "Reusable assets" popup in a contributor's workspace header: every
// asset on the chat's asset cards (AssetShareCard) in one list, on the same
// state, so the two always agree. An asset with a file can be downloaded or
// removed; one without gets Add. Delete (asked first) takes any asset out of
// the list and its row out of Section 4. A new asset (uploaded at the bottom, onto
// the latest card) asks for its title and "What is it used for?", as the
// chat card does. Confirm here shares everything chosen on every open card.
export default function ReusableAssetsPanel({
  cards,
  fileAvailable,
  actions,
  onClose,
}: {
  cards: AssetShareState[];
  fileAvailable: (fileName: string) => boolean;
  actions: ReusableAssetsActions;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const newFileRef = useRef<HTMLInputElement>(null);

  const rows = cards.flatMap((card) =>
    card.items.filter((item) => !item.deleted).map((item) => ({ cardId: card.id, item }))
  );
  const latestCardId = cards[cards.length - 1]?.id;
  const sharedCount = rows.filter((r) => r.item.shared).length;
  const anyStaged = rows.some((r) => r.item.staged && !r.item.shared);

  async function confirm() {
    if (confirming) return;
    setConfirming(true);
    setError(null);
    const result = await actions.confirmAll();
    if (!result.ok && result.error) setError(result.error);
    setConfirming(false);
  }

  return (
    <div className="flex max-h-full min-h-0 flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-navy/10 px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-medium tracking-tight text-navy">Reusable assets</h2>
            {rows.length > 0 && (
              <p className="mt-0.5 text-xs text-ink-soft">
                <span className="font-medium text-navy">
                  {sharedCount} of {rows.length}
                </span>{' '}
                shared
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-lg px-2 py-1 text-lg leading-none text-ink-soft transition hover:bg-paper-dim hover:text-navy"
          >
            ×
          </button>
        </div>
        {rows.length > 0 && (
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-paper-dim">
            <div
              className="h-full rounded-full bg-navy transition-all"
              style={{ width: `${(sharedCount / rows.length) * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-navy/15 px-4 py-8 text-center">
            <p className="text-sm font-medium text-navy">No reusable assets yet</p>
            <p className="mt-1 text-xs text-ink-soft">Add a template, guide or dataset others could reuse.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map(({ cardId, item }) => (
              <AssetListRow
                key={`${cardId}:${item.key}`}
                item={item}
                disabled={confirming}
                fileAvailable={fileAvailable}
                onStageFiles={(files) => actions.stageFiles(cardId, item.key, files)}
                onUnstage={() => actions.unstage(cardId, item.key)}
                onRename={(name) => actions.rename(cardId, item.key, name)}
                onDescribe={(text) => actions.describe(cardId, item.key, text)}
                onRemove={() => actions.remove(cardId, item.key)}
                onDelete={() => actions.deleteAsset(cardId, item.key)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      {latestCardId && (
        <div className="shrink-0 border-t border-navy/10 bg-paper px-5 py-4">
          {anyStaged && (
            // Confirming is the consent — this line is what it agrees to.
            <p className="mb-3 text-[11px] leading-relaxed text-ink-soft">
              Anything you share here is public once an admin approves this pathway: anyone can download it. Only share
              what you have the right to share.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <input
              ref={newFileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) {
                  const result = actions.stageFiles(latestCardId, null, files);
                  setError(result.ok ? null : (result.error ?? null));
                }
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => newFileRef.current?.click()}
              disabled={confirming}
              className="rounded-lg border border-dashed border-navy/25 px-3 py-1.5 text-xs font-medium text-navy transition hover:border-coral hover:text-coral disabled:opacity-40"
            >
              + Add a new asset
            </button>
            {anyStaged && (
              <button
                type="button"
                onClick={confirm}
                disabled={confirming}
                className="rounded-lg bg-navy px-4 py-1.5 text-xs font-medium text-white transition hover:bg-coral disabled:opacity-40"
              >
                {confirming ? 'Sharing…' : 'Confirm'}
              </button>
            )}
          </div>
          {error && <p className="mt-2 text-xs text-coral">{error}</p>}
        </div>
      )}
    </div>
  );
}

function AssetListRow({
  item,
  disabled,
  fileAvailable,
  onStageFiles,
  onUnstage,
  onRename,
  onDescribe,
  onRemove,
  onDelete,
}: {
  item: AssetShareItem;
  disabled: boolean;
  fileAvailable: (fileName: string) => boolean;
  onStageFiles: (files: File[]) => Result;
  onUnstage: () => void;
  onRename: (name: string) => void;
  onDescribe: (text: string) => void;
  onRemove: () => Promise<Result>;
  onDelete: () => Promise<Result>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [askingDelete, setAskingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function remove() {
    if (removing) return;
    setRemoving(true);
    const result = await onRemove();
    setError(result.ok ? null : (result.error ?? null));
    setRemoving(false);
  }

  async function confirmDelete() {
    if (deleting) return;
    setDeleting(true);
    const result = await onDelete();
    // On success the row is gone; on failure it stays with the error.
    if (!result.ok) {
      setError(result.error ?? null);
      setDeleting(false);
      setAskingDelete(false);
    }
  }

  const { shared, staged } = item;
  const source = shared?.source ?? staged;
  const isLink = !!source && 'url' in source;
  const stagedMissing = !!staged && 'fileName' in staged && !fileAvailable(staged.fileName);
  // A new asset not shared yet: its title and "What is it used for?".
  const asking = !!staged && !shared && !item.fromSection4;
  const canAdd = !shared && (!staged || (stagedMissing && item.fromSection4));

  const status = shared
    ? { label: 'Shared', className: 'bg-blue-soft text-navy' }
    : staged
      ? stagedMissing
        ? { label: 'File lost', className: 'bg-coral-soft text-coral' }
        : { label: 'Not confirmed', className: 'bg-yellow-soft text-ink' }
      : { label: 'No file', className: 'bg-paper-dim text-ink-soft' };

  const meta = source
    ? stagedMissing
      ? `${sourceLabel(source)} — select the file again`
      : sourceLabel(source)
    : 'Upload the file so others can reuse it';

  return (
    <li
      className={`rounded-xl border bg-white px-4 py-3 transition ${
        source ? 'border-navy/10' : 'border-dashed border-navy/20'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
            source ? 'bg-paper-dim text-navy' : 'bg-paper text-ink-soft'
          }`}
        >
          {isLink ? <LinkIcon /> : <FileIcon />}
        </span>

        <div className="min-w-0 flex-1">
          {asking ? (
            <label className="block">
              <span className="text-[11px] font-medium text-ink-soft">Title</span>
              <input
                type="text"
                value={item.name}
                onChange={(e) => onRename(e.target.value)}
                disabled={disabled}
                placeholder="What is this asset called?"
                className="mt-0.5 w-full rounded-lg border border-navy/15 bg-white px-2.5 py-1.5 text-sm font-medium text-navy outline-none focus:border-navy/40"
              />
            </label>
          ) : (
            <p className="line-clamp-2 text-sm font-medium leading-snug text-navy" title={item.name}>
              {item.name}
            </p>
          )}
          <p className="mt-0.5 truncate text-xs text-ink-soft" title={meta}>
            {meta}
          </p>
        </div>

        <span
          className={`flex-shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${status.className}`}
        >
          {status.label}
        </span>
      </div>

      {asking && (
        <label className="mt-3 block pl-12">
          <span className="text-[11px] font-medium text-ink-soft">What is it used for?</span>
          <textarea
            value={item.howItHelped ?? ''}
            onChange={(e) => onDescribe(e.target.value)}
            disabled={disabled}
            rows={2}
            placeholder="e.g. Training ward officers to send misrouted complaints back in one step."
            className="mt-0.5 w-full resize-y rounded-lg border border-navy/15 bg-white px-2.5 py-1.5 text-xs text-ink outline-none focus:border-navy/40"
          />
          <span className="text-[11px] text-ink-soft">
            We use this to write its reuse condition in Section 4 of your pathway.
          </span>
        </label>
      )}

      {askingDelete ? (
        <div className="mt-2.5 ml-12 flex flex-wrap items-center gap-2 rounded-lg bg-coral-soft px-3 py-2">
          <p className="mr-auto text-xs text-ink">
            Delete this asset?{shared ? ' Its file is deleted and' : ' It is'} removed from Section 4 of your pathway.
          </p>
          <button
            type="button"
            onClick={() => setAskingDelete(false)}
            disabled={deleting}
            className="rounded-lg px-2 py-1 text-xs text-ink-soft transition hover:text-navy disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={deleting}
            className="rounded-lg bg-coral px-2.5 py-1 text-xs font-medium text-white transition hover:bg-navy disabled:opacity-40"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      ) : (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-12">
          {shared ? (
            <>
              <a
                href={`/api/toolkit-assets/${shared.assetId}/download`}
                {...(isLink ? { target: '_blank', rel: 'noopener noreferrer' } : { download: true })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-navy/15 px-2.5 py-1 text-xs font-medium text-navy transition hover:border-coral hover:text-coral"
              >
                {isLink ? <LinkIcon small /> : <DownloadIcon />}
                {isLink ? 'Open link' : 'Download'}
              </a>
              <button
                type="button"
                onClick={remove}
                disabled={removing || disabled}
                className="rounded-lg px-2 py-1 text-xs text-ink-soft transition hover:bg-coral-soft hover:text-coral disabled:opacity-40"
              >
                {removing ? 'Removing…' : 'Remove'}
              </button>
            </>
          ) : (
            <>
              {canAdd && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      if (files.length) {
                        const result = onStageFiles(files);
                        setError(result.ok ? null : (result.error ?? null));
                      }
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={disabled}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-2.5 py-1 text-xs font-medium text-white transition hover:bg-coral disabled:opacity-40"
                  >
                    <span aria-hidden>+</span> Add
                  </button>
                </>
              )}
              {staged && (
                <button
                  type="button"
                  onClick={onUnstage}
                  disabled={disabled}
                  className="rounded-lg px-2 py-1 text-xs text-ink-soft transition hover:bg-coral-soft hover:text-coral disabled:opacity-40"
                >
                  Remove
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => setAskingDelete(true)}
            disabled={disabled || removing}
            aria-label={`Delete ${item.name}`}
            className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-soft transition hover:bg-coral-soft hover:text-coral disabled:opacity-40"
          >
            <TrashIcon /> Delete
          </button>
        </div>
      )}

      {(error || item.error) && <p className="mt-1.5 pl-12 text-xs text-coral">{error ?? item.error}</p>}
    </li>
  );
}

function FileIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function LinkIcon({ small = false }: { small?: boolean }) {
  const size = small ? 12 : 16;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 4v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}
