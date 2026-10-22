import type { Instrumentation } from 'next';

// Records server-side errors the route-handler wrapper can't see — Server
// Components while rendering, Server Actions, and the proxy — in sys_errors,
// with the original stack (the browser only ever gets a digest). Route
// handlers ('route') are skipped: withErrorHandling (lib/errors.ts) already
// records those.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (context.routeType === 'route') return;
  // redirect()/notFound() travel as errors too; they aren't failures.
  const digest = (err as { digest?: unknown }).digest;
  if (typeof digest === 'string' && digest.startsWith('NEXT_')) return;

  const { recordServerError } = await import('@/lib/errors');
  await recordServerError(`${context.routeType}:${context.routePath}`, err, {
    kind: 'unexpected',
    path: request.path.split('?')[0],
    method: request.method,
  });
};
