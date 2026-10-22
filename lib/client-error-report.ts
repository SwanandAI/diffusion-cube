// Sends an error caught by app/error.tsx or app/global-error.tsx to
// /api/errors/client so it lands in sys_errors. Only errors raised in the
// browser are sent: a server error reaches these boundaries carrying just a
// digest, and instrumentation.ts has already recorded it with its real stack.
// Best-effort — a failed report is dropped silently.
export function reportClientError(error: Error & { digest?: string }) {
  if (error.digest) return;
  try {
    void fetch('/api/errors/client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        message: String(error.message ?? '').slice(0, 2_000),
        stack: String(error.stack ?? '').slice(0, 8_000),
        path: window.location.pathname,
      }),
    }).catch(() => {});
  } catch {
    // Nothing to do — the error page still renders.
  }
}
