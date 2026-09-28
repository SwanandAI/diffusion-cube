'use client';

import { useEffect, useState } from 'react';
import { drainToasts, TOAST_EVENT, type ToastItem } from '@/lib/toast';

const DISMISS_AFTER_MS = 4000;

// Renders toasts fired by showToast() (lib/toast.ts). Mounted once in the root
// layout so it outlives page navigations.
export default function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    // The event's own item covers blocked storage; draining covers toasts
    // queued before a full page load. Merged by id so neither path doubles up.
    function take(extra?: ToastItem) {
      const incoming = drainToasts();
      if (extra && !incoming.some((t) => t.id === extra.id)) incoming.push(extra);
      if (incoming.length === 0) return;
      setToasts((prev) => [...prev, ...incoming.filter((t) => !prev.some((p) => p.id === t.id))]);
    }
    function onToast(e: Event) {
      take((e as CustomEvent<ToastItem>).detail);
    }
    take();
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  function dismiss(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-4 z-[70] flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
    // onDismiss is a fresh closure every render; the timer should start once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isError = toast.variant === 'error';
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={`animate-fade-in-up pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl px-4 py-3 text-sm text-white shadow-xl ${
        isError ? 'bg-coral' : 'bg-navy'
      }`}
    >
      <span aria-hidden className="mt-px flex-shrink-0 font-medium">
        {isError ? '!' : '✓'}
      </span>
      <p className="flex-1 leading-snug">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="flex-shrink-0 text-white/70 transition-colors hover:text-white"
      >
        ✕
      </button>
    </div>
  );
}
