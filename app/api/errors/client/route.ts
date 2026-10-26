import { logError, sessionUserId, withErrorHandling } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';

const MAX_BODY_BYTES = 16 * 1024;

// Receives errors that app/error.tsx / app/global-error.tsx caught in the
// browser (lib/client-error-report.ts) and records them in sys_errors as
// `client:<path>`. Public — a crash can happen before or without sign-in — so
// it's rate-limited per IP first and size-capped, and only message, stack
// and path are read from the body.
async function handlePOST(req: Request) {
  if (!(await checkRateLimit(req, 'client-error'))) {
    return Response.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  // Counted in UTF-8 bytes: raw.length counts UTF-16 characters, which would
  // let ~48KB of multi-byte text through a 16KB cap.
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return Response.json({ error: 'Report too large.' }, { status: 400 });
  }

  let body: { message?: unknown; stack?: unknown; path?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Invalid report.' }, { status: 400 });
  }
  // Valid JSON that isn't an object (null, a number, an array) is just as
  // malformed a report.
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Invalid report.' }, { status: 400 });
  }
  const message = typeof body.message === 'string' ? body.message : '';
  const stack = typeof body.stack === 'string' ? body.stack : '';
  const path = typeof body.path === 'string' && body.path.startsWith('/') ? body.path.split('?')[0] : '/';

  const error = new Error(message || '(no message)');
  error.stack = stack || undefined;
  logError(`client:${path}`, error, { kind: 'unexpected', path, user_id: await sessionUserId() });

  return new Response(null, { status: 204 });
}

export const POST = withErrorHandling('api/errors/client', handlePOST);
