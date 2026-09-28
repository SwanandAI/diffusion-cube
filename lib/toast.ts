// App-wide success/error toasts, rendered by components/Toaster.tsx (mounted
// once in app/layout.tsx). Most toasts are fired right before a navigation
// (sign-in → /explore, sign-out → /login), so each one is queued in
// sessionStorage as well as announced by event: the root layout survives
// client-side navigation and the event is enough, but if a navigation turns
// into a full page load the new Toaster drains the queue on mount instead.
// Plain module, no React — callable from any handler.

export type ToastVariant = 'success' | 'error';

export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

const STORAGE_KEY = 'dc:toasts';
export const TOAST_EVENT = 'dc:toast';

export function showToast(message: string, variant: ToastVariant = 'success') {
  if (typeof window === 'undefined') return;
  const item: ToastItem = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, message, variant };
  try {
    const queued = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]') as ToastItem[];
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...queued, item]));
  } catch {
    // Storage blocked (private mode etc.) — the event below still delivers it
    // as long as the page isn't fully reloaded.
  }
  window.dispatchEvent(new CustomEvent<ToastItem>(TOAST_EVENT, { detail: item }));
}

// Takes every queued toast and clears the queue — called by the Toaster only.
export function drainToasts(): ToastItem[] {
  try {
    const queued = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]') as ToastItem[];
    sessionStorage.removeItem(STORAGE_KEY);
    return Array.isArray(queued) ? queued : [];
  } catch {
    return [];
  }
}
