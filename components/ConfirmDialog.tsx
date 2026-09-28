'use client';

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  // Coral confirm button for destructive actions instead of navy.
  danger?: boolean;
  // Confirm disabled (e.g. until typed confirmation matches).
  confirmDisabled?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

// In-app replacement for window.confirm — same card treatment as ChatPanel's
// source popup. Rendered only while open (callers mount it conditionally), and
// portalled to <body> because the Sidebar's mobile drawer uses a transform,
// which would otherwise trap a `fixed` overlay inside the drawer.
export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger,
  confirmDisabled,
  busy,
  error,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-navy/40 px-4 backdrop-blur-sm"
      onClick={() => !busy && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-sm rounded-2xl border border-navy/10 bg-paper p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="font-display text-lg font-medium text-navy">
          {title}
        </h2>

        {children && <div className="mt-2 text-sm leading-relaxed text-ink">{children}</div>}

        {error && <p className="mt-3 text-xs text-coral">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-navy/15 px-4 py-2 text-sm text-ink-soft transition-colors hover:text-navy disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            autoFocus={!confirmDisabled}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
              danger ? 'bg-coral hover:bg-coral/90' : 'bg-navy hover:bg-coral'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
}

// Promise-returning drop-in for `window.confirm` in handlers that only need a
// yes/no: `if (!(await confirm({...}))) return;` — render `dialog` once in the
// component's output.
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    resolveRef.current?.(false);
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    resolveRef.current?.(ok);
    resolveRef.current = null;
    setOptions(null);
  }, []);

  const cancel = useCallback(() => settle(false), [settle]);

  const dialog = options ? (
    <ConfirmDialog
      title={options.title}
      confirmLabel={options.confirmLabel}
      danger={options.danger}
      onConfirm={() => settle(true)}
      onCancel={cancel}
    >
      {options.message}
    </ConfirmDialog>
  ) : null;

  return { confirm, dialog };
}
