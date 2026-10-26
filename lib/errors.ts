import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { GENERIC_ERROR_MESSAGE } from '@/lib/error-messages';

// SERVER-ONLY (uses the service-role client). The one place errors are
// recorded: every error the server sees goes to sys_errors (migration 0035)
// for the system administrator. Client components import
// GENERIC_ERROR_MESSAGE from lib/error-messages.ts instead.
export { GENERIC_ERROR_MESSAGE };

// Expected errors keep their own message and status; anything else a route
// throws is unexpected and is answered with GENERIC_ERROR_MESSAGE.
export class ExpectedError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends ExpectedError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class AuthError extends ExpectedError {
  constructor(message: string, status: 401 | 403 = 401) {
    super(message, status);
  }
}

export class NotFoundError extends ExpectedError {
  constructor(message: string) {
    super(message, 404);
  }
}

export type ErrorKind = 'expected' | 'unexpected';

// The only keys a context may carry — IDs and short metadata, never message
// text, documents, passwords or tokens. Anything else passed in is dropped.
export interface ErrorContext {
  user_id?: string | null;
  mode?: string;
  flow?: string;
  pathway_slug?: string;
  design_id?: string;
  path?: string;
  method?: string;
  status?: number;
  kind?: ErrorKind;
}

const CONTEXT_KEYS: (keyof ErrorContext)[] = [
  'user_id',
  'mode',
  'flow',
  'pathway_slug',
  'design_id',
  'path',
  'method',
  'status',
  'kind',
];

const MAX_MESSAGE_CHARS = 2_000;
const MAX_STACK_CHARS = 8_000;
const MAX_CONTEXT_VALUE_CHARS = 200;
const RETENTION_DAYS = 30;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

// Masks credentials that error text from the SDKs or a database can echo.
const SECRET_PATTERNS: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-[redacted]'],
  [/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]'],
  [/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt redacted]'],
  [/\b(password|passwd|pwd|token|secret|api[_-]?key)(["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi, '$1$2[redacted]'],
];

export function scrub(text: string): string {
  return SECRET_PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

function cap(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

export function cleanContext(context: Record<string, unknown>): ErrorContext {
  const clean: Record<string, unknown> = {};
  for (const key of CONTEXT_KEYS) {
    const value = context[key];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'number') clean[key] = value;
    else if (typeof value === 'string') clean[key] = cap(scrub(value), MAX_CONTEXT_VALUE_CHARS);
  }
  return clean as ErrorContext;
}

// APP_ENV wins (set it on the Docker/AWS path); otherwise only Vercel's
// production deployment counts as prod — previews and local dev are dev.
export function currentEnvironment(): 'prod' | 'dev' {
  const explicit = process.env.APP_ENV;
  if (explicit === 'prod' || explicit === 'dev') return explicit;
  return process.env.VERCEL_ENV === 'production' ? 'prod' : 'dev';
}

let lastPurgeAt = 0;

async function writeError(row: {
  source: string;
  message: string;
  stack: string | null;
  context: ErrorContext;
  user_id: string | null;
  environment: 'prod' | 'dev';
}) {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from('sys_errors').insert(row);
    if (error) console.error('[errors] sys_errors insert failed:', error.message);

    if (Date.now() - lastPurgeAt > PURGE_INTERVAL_MS) {
      lastPurgeAt = Date.now();
      const { error: purgeError } = await admin.rpc('purge_old_sys_errors', { days: RETENTION_DAYS });
      if (purgeError) console.error('[errors] sys_errors purge failed:', purgeError.message);
    }
  } catch (err) {
    console.error('[errors] sys_errors write failed:', err);
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  // Supabase/PostgREST errors are plain objects with a message, not Errors.
  if (typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return String(error);
}

async function recordError(source: string, error: unknown, context: Record<string, unknown>) {
  const clean = cleanContext({ kind: 'unexpected', ...context });
  const rawStack = error instanceof Error ? error.stack ?? null : null;
  await writeError({
    source: cap(source, MAX_CONTEXT_VALUE_CHARS),
    message: cap(scrub(errorText(error) || '(no message)'), MAX_MESSAGE_CHARS),
    stack: rawStack ? cap(scrub(rawStack), MAX_STACK_CHARS) : null,
    context: clean,
    user_id: typeof clean.user_id === 'string' ? clean.user_id : null,
    environment: currentEnvironment(),
  });
}

// Runs `task` once the response has been sent (after()), or fire-and-forget
// when there's no request scope to attach it to.
function schedule(task: () => Promise<void>) {
  const safe = () => task().catch((err) => console.error('[errors] record failed:', err));
  try {
    after(safe);
  } catch {
    void safe();
  }
}

// Records one error. Never throws and never delays the caller. `kind`
// defaults to 'unexpected'.
export function logError(source: string, error: unknown, context: Record<string, unknown> = {}): void {
  try {
    // Keep the platform log line too — it's what the hosting dashboard shows.
    console.error(`[${source}]`, context.kind === 'expected' ? errorText(error) : error);
    schedule(() => recordError(source, error, context));
  } catch (err) {
    console.error('[errors] logError failed:', err);
  }
}

// For instrumentation.ts's onRequestError (server component, server action
// and proxy errors), which Next awaits — so this writes directly rather than
// through after(). Never throws.
export async function recordServerError(source: string, error: unknown, context: Record<string, unknown>) {
  try {
    console.error(`[${source}]`, error);
    await recordError(source, error, { ...context, user_id: context.user_id ?? (await sessionUserId()) });
  } catch (err) {
    console.error('[errors] recordServerError failed:', err);
  }
}

// The signed-in user behind the current request, if any — resolved only on
// the error path, inside after(), so a normal request pays nothing for it.
export async function sessionUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

function defaultErrorBody(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

// The `error` text of a JSON error response this route already built — the
// app's `{ error: '...' }` shape or the Auth hook's `{ error: { message } }`.
async function responseErrorText(res: Response): Promise<string> {
  if (!res.headers.get('content-type')?.includes('application/json')) return `HTTP ${res.status}`;
  try {
    const body = await res.clone().json();
    if (typeof body?.error === 'string') return body.error;
    if (typeof body?.error?.message === 'string') return body.error.message;
  } catch {
    // fall through
  }
  return `HTTP ${res.status}`;
}

// Wraps a route handler so every error goes through one path:
// - a 4xx it returns passes through untouched and is logged as expected;
// - a 5xx it returns is logged as unexpected and its body is replaced with
//   GENERIC_ERROR_MESSAGE, so raw database/SDK text can never reach the
//   browser even where a route still builds its 500 from error.message;
// - a thrown ExpectedError becomes its own status + message (expected);
// - anything else thrown is logged with its stack and answered with a 500 +
//   GENERIC_ERROR_MESSAGE (unexpected).
// `errorBody` shapes the replacement body for routes whose caller expects a
// different error format (the Supabase Auth send-email hook).
// Streamed responses pass through untouched — failures inside a stream are
// handled where the stream is built.
export function withErrorHandling<A extends unknown[]>(
  source: string,
  handler: (...args: A) => Promise<Response> | Response,
  options: { errorBody?: (status: number, message: string) => Response } = {}
): (...args: A) => Promise<Response> {
  const errorBody = options.errorBody ?? defaultErrorBody;

  return async (...args: A) => {
    const req = args[0] instanceof Request ? args[0] : null;
    const requestContext = {
      path: req ? new URL(req.url).pathname : undefined,
      method: req?.method,
    };
    const record = (error: unknown, kind: ErrorKind, status: number) => {
      console.error(`[${source}]`, kind === 'expected' ? `${status} ${errorText(error)}` : error);
      schedule(async () => {
        const user_id = await sessionUserId();
        // An anonymous caller's error (4xx or 5xx) is recorded only while
        // their IP is within the 'anon-error' allowance, so a script hammering
        // a public route (/api/toolkit-assets, the Auth hook, a bad /api/chat
        // body, or one that keeps failing) can't flood sys_errors and push
        // real errors off /admin/errors. Imported here rather than at the top
        // because lib/rate-limit.ts records its own failures through this file.
        if (!user_id && req) {
          const { checkRateLimit } = await import('@/lib/rate-limit');
          if (!(await checkRateLimit(req, 'anon-error'))) return;
        }
        await recordError(source, error, { ...requestContext, kind, status, user_id });
      });
    };

    try {
      const res = await handler(...args);
      if (res.status < 400) return res;
      // A returned error response has no exception behind it, so it's
      // recorded by its message alone (a stack here would only point at
      // this wrapper).
      // 429s are not recorded: they're the rate limiter doing its job, they're
      // already counted in rate_limits, and recording each one would let a
      // flood of requests flood sys_errors too.
      if (res.status === 429) return res;
      const message = { message: await responseErrorText(res) };
      if (res.status < 500) {
        record(message, 'expected', res.status);
        return res;
      }
      record(message, 'unexpected', res.status);
      return errorBody(res.status, GENERIC_ERROR_MESSAGE);
    } catch (err) {
      if (err instanceof ExpectedError) {
        record(err, 'expected', err.status);
        return errorBody(err.status, err.message);
      }
      record(err, 'unexpected', 500);
      return errorBody(500, GENERIC_ERROR_MESSAGE);
    }
  };
}
