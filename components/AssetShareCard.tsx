'use client';

import { useRef, useState } from 'react';
import { sourceLabel, type AssetShareItem, type AssetShareState, type AssetSource } from '@/lib/toolkit-assets';

type Result = { ok: boolean; error?: string };

export interface AssetShareActions {
  stageFiles: (cardId: string, itemKey: string | null, files: File[]) => Result;
  stageLink: (cardId: string, itemKey: string | null, url: string) => Result;
  takeSuggested: (cardId: string, itemKey: string) => Result;
  unstage: (cardId: string, itemKey: string) => void;
  rename: (cardId: string, itemKey: string, name: string) => void;
  describe: (cardId: string, itemKey: string, text: string) => void;
  remove: (cardId: string, itemKey: string) => Promise<Result>;
  confirm: (cardId: string) => Promise<Result>;
  reopen: (cardId: string) => void;
}

// The asset card under a contributor's pathway draft (see AssetShareState in
// lib/toolkit-assets.ts): each reusable asset Section 4 lists, with an
// upload or a link for it — or, when Section 4 lists none, "do you have
// any?" — then Confirm. A file goes straight onto its row; nothing is shared
// until Confirm, which the note above the button makes the consent. An asset
// the contributor adds asks for its title and "What is it used for?",
// which becomes its reuse condition in Section 4. The actions live in
// useAdoptionConversation; this card renders the state.
export default function AssetShareCard({
  card,
  fileAvailable,
  actions,
}: {
  card: AssetShareState;
  // False after a reload for a chosen file only ever held in memory.
  fileAvailable: (fileName: string) => boolean;
  actions: AssetShareActions;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = card.status === 'open';
  // An asset deleted in the Reusable assets popup is gone from here too.
  const items = card.items.filter((i) => !i.deleted);

  async function confirm() {
    if (confirming) return;
    setConfirming(true);
    setError(null);
    const result = await actions.confirm(card.id);
    if (!result.ok && result.error) setError(result.error);
    setConfirming(false);
  }

  return (
    <div className="rounded-xl border border-navy/15 bg-white px-4 py-3">
      <p className="text-sm font-medium text-navy">Reusable assets</p>
      <p className="mt-0.5 text-xs text-ink-soft">
        {card.noneInSection4
          ? 'Do you have any reusable assets that can be shared with others? If yes, please upload them and confirm.'
          : 'These are the reusable assets in Section 4 of your pathway. Upload the file or add a link for each one you can share.'}
      </p>

      {items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <AssetRow
              key={item.key}
              item={item}
              open={open && !confirming}
              fileAvailable={fileAvailable}
              onStageFiles={(files) => actions.stageFiles(card.id, item.key, files)}
              onStageLink={(url) => actions.stageLink(card.id, item.key, url)}
              onUseSuggested={() => actions.takeSuggested(card.id, item.key)}
              onUnstage={() => actions.unstage(card.id, item.key)}
              onRename={(name) => actions.rename(card.id, item.key, name)}
              onDescribe={(text) => actions.describe(card.id, item.key, text)}
              onRemove={() => actions.remove(card.id, item.key)}
            />
          ))}
        </ul>
      )}

      {open ? (
        <>
          <div className="mt-3 rounded-lg bg-paper-dim px-3 py-2.5">
            <p className="text-xs font-medium text-navy">
              {card.noneInSection4 ? 'Add your assets' : 'Any other reusable asset?'}
            </p>
            <UploadControls
              disabled={confirming}
              uploadLabel="Upload files"
              multiple
              onFiles={(files) => actions.stageFiles(card.id, null, files)}
              onLink={(url) => actions.stageLink(card.id, null, url)}
            />
          </div>
          <div className="mt-3 border-t border-navy/10 pt-3">
            {/* Confirming is the consent — this line is what it agrees to. */}
            <p className="text-[11px] text-ink-soft">
              Anything you share here is public once an admin approves this pathway: anyone can download it. Only
              share what you have the right to share.
            </p>
            <p className="mt-2 text-sm text-navy">Please confirm once you have shared all the reusable assets.</p>
            {card.noneInSection4 && items.length === 0 && (
              <p className="mt-0.5 text-xs text-ink-soft">Nothing to share? Just click Confirm.</p>
            )}
            <button
              type="button"
              onClick={confirm}
              disabled={confirming}
              className="mt-2 rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white transition hover:bg-coral disabled:opacity-40"
            >
              {confirming ? 'Sharing…' : 'Confirm'}
            </button>
            {error && <p className="mt-1 text-xs text-coral">{error}</p>}
          </div>
        </>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-navy/10 pt-3">
          <p className="text-xs text-ink-soft">Confirmed.</p>
          <button
            type="button"
            onClick={() => actions.reopen(card.id)}
            className="text-xs font-medium text-navy/70 transition hover:text-coral"
          >
            Add more assets
          </button>
        </div>
      )}
    </div>
  );
}

function AssetRow({
  item,
  open,
  fileAvailable,
  onStageFiles,
  onStageLink,
  onUseSuggested,
  onUnstage,
  onRename,
  onDescribe,
  onRemove,
}: {
  item: AssetShareItem;
  open: boolean;
  fileAvailable: (fileName: string) => boolean;
  onStageFiles: (files: File[]) => Result;
  onStageLink: (url: string) => Result;
  onUseSuggested: () => Result;
  onUnstage: () => void;
  onRename: (name: string) => void;
  onDescribe: (text: string) => void;
  onRemove: () => Promise<Result>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const reselectRef = useRef<HTMLInputElement>(null);

  function show(result: Result) {
    setError(result.ok ? null : (result.error ?? null));
  }

  async function remove() {
    if (removing) return;
    setRemoving(true);
    show(await onRemove());
    setRemoving(false);
  }

  const staged = item.staged;
  const stagedMissing = staged && 'fileName' in staged && !fileAvailable(staged.fileName);
  const renamable = open && !item.fromSection4 && !item.shared;

  return (
    <li className="rounded-lg border border-navy/10 px-3 py-2">
      <div className="flex items-start gap-2">
        <span aria-hidden className="text-base">{icon(item.shared?.source ?? staged)}</span>
        <div className="min-w-0 flex-1">
          {renamable ? (
            <label className="block">
              <span className="text-[11px] font-medium text-ink-soft">Title</span>
              <input
                type="text"
                value={item.name}
                onChange={(e) => onRename(e.target.value)}
                placeholder="What is this asset called?"
                className="mt-0.5 w-full rounded border border-navy/15 bg-white px-2 py-1 text-sm font-medium text-navy"
              />
            </label>
          ) : (
            <p className="text-sm font-medium text-navy">{item.name}</p>
          )}
          {item.shared ? (
            <p className="truncate text-xs text-ink-soft">{sourceLabel(item.shared.source)}</p>
          ) : staged ? (
            <p className="truncate text-xs text-ink-soft">{sourceLabel(staged)}</p>
          ) : !open ? (
            <p className="text-xs text-ink-soft">Not shared</p>
          ) : null}
          {renamable && (
            <label className="mt-2 block">
              <span className="text-[11px] font-medium text-ink-soft">What is it used for?</span>
              <textarea
                value={item.howItHelped ?? ''}
                onChange={(e) => onDescribe(e.target.value)}
                rows={2}
                placeholder="e.g. Training ward officers to send misrouted complaints back in one step."
                className="mt-0.5 w-full resize-y rounded border border-navy/15 bg-white px-2 py-1 text-xs text-ink"
              />
              <span className="text-[11px] text-ink-soft">
                We use this to write its reuse condition in Section 4 of your pathway.
              </span>
            </label>
          )}
          {!item.fromSection4 && item.shared && item.reuseCondition && (
            <p className="mt-1 text-xs text-ink-soft">Reuse condition: {item.reuseCondition}</p>
          )}
        </div>
        {item.shared && (
          <span className="flex-shrink-0 rounded-full bg-paper-dim px-2 py-0.5 text-[11px] text-ink-soft">
            Shared · public after approval
          </span>
        )}
      </div>

      {item.shared && (
        <button
          type="button"
          onClick={remove}
          disabled={removing}
          className="mt-1.5 text-xs text-ink-soft transition hover:text-coral disabled:opacity-40"
        >
          {removing ? 'Removing…' : 'Remove'}
        </button>
      )}

      {open && !item.shared && staged && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {stagedMissing && (
            <>
              <input
                ref={reselectRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) show(onStageFiles(files));
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => reselectRef.current?.click()}
                className="rounded-lg border border-navy/15 px-3 py-1.5 text-xs font-medium text-navy transition hover:border-navy/40"
              >
                Select the file again
              </button>
            </>
          )}
          <button type="button" onClick={onUnstage} className="text-xs text-ink-soft transition hover:text-coral">
            {item.fromSection4 ? 'Change' : 'Remove'}
          </button>
        </div>
      )}

      {open && !item.shared && !staged && (
        <div className="mt-2">
          {item.suggestedFile && (
            <button
              type="button"
              onClick={() => show(onUseSuggested())}
              className="mb-2 rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white transition hover:bg-coral"
            >
              Use the file you already uploaded: {item.suggestedFile}
            </button>
          )}
          <UploadControls
            uploadLabel="Upload file"
            onFiles={(files) => show(onStageFiles(files))}
            onLink={(url) => {
              const result = onStageLink(url);
              show(result);
              return result;
            }}
          />
        </div>
      )}

      {(error || item.error) && <p className="mt-1 text-xs text-coral">{error ?? item.error}</p>}
    </li>
  );
}

function icon(source: AssetSource | undefined): string {
  if (!source) return '📝';
  return 'fileName' in source ? '📎' : '🔗';
}

// Upload a file (or several, with `multiple`) / add an https link.
function UploadControls({
  uploadLabel,
  multiple = false,
  disabled = false,
  onFiles,
  onLink,
}: {
  uploadLabel: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => Result | void;
  onLink: (url: string) => Result;
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
    <div className="mt-1.5">
      <input
        ref={fileRef}
        type="file"
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) {
            const result = onFiles(files);
            setError(result && !result.ok ? (result.error ?? null) : null);
          }
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
            disabled={!url.trim()}
            className="rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white transition hover:bg-coral disabled:opacity-40"
          >
            Add
          </button>
          <button type="button" onClick={() => setLinking(false)} className="text-xs text-ink-soft hover:text-navy">
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
            className="rounded-lg border border-navy/15 px-3 py-1.5 text-xs font-medium text-navy transition hover:border-navy/40 disabled:opacity-40"
          >
            {uploadLabel}
          </button>
          <button
            type="button"
            onClick={() => setLinking(true)}
            disabled={disabled}
            className="rounded-lg border border-navy/15 px-3 py-1.5 text-xs font-medium text-navy transition hover:border-navy/40 disabled:opacity-40"
          >
            Add link
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-coral">{error}</p>}
    </div>
  );
}
