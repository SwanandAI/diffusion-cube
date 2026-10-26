import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/errors';

// SERVER-ONLY. Rate limits backed by check_rate_limit() in migration 0037:
// per IP for anonymous callers (/api/chat — the /explore chat and anything
// else sent without a session — /api/errors/client, and the anonymous 4xx
// withErrorHandling records), per account for signed-in /api/chat callers.
// Limits come from env vars so they can change without a code change.

export type RateLimitScope = 'explore' | 'client-error' | 'anon-error' | 'chat-user';

// <env>_PER_MIN / <env>_PER_DAY override each scope's defaults. The per-IP
// scopes share the EXPLORE_RATE_LIMIT_* values (20 / 200). A signed-in
// account gets more, since one real session makes background calls too
// (extract-insights per upload, drafts, documents) — but still a ceiling, as
// every signup is auto-approved and could otherwise spend Claude tokens
// without limit.
const LIMITS: Record<RateLimitScope, { env: string; perMin: number; perDay: number }> = {
  explore: { env: 'EXPLORE_RATE_LIMIT', perMin: 20, perDay: 200 },
  'client-error': { env: 'EXPLORE_RATE_LIMIT', perMin: 20, perDay: 200 },
  'anon-error': { env: 'EXPLORE_RATE_LIMIT', perMin: 20, perDay: 200 },
  'chat-user': { env: 'CHAT_USER_RATE_LIMIT', perMin: 30, perDay: 300 },
};

function limitFromEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// The visitor's address as Vercel (or the AWS load balancer) reports it: the
// first hop of x-forwarded-for, which the platform sets — not a value the
// browser controls.
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || req.headers.get('x-real-ip')?.trim() || 'unknown';
}

let warnedNoSalt = false;

// Salted so a stored key can't be turned back into an IP by hashing every
// address; scoped so error reports don't use up a visitor's chat allowance.
function rateLimitKey(scope: RateLimitScope, subject: string): string {
  const salt = process.env.RATE_LIMIT_SALT ?? '';
  if (!salt && !warnedNoSalt) {
    warnedNoSalt = true;
    console.warn('[rate-limit] RATE_LIMIT_SALT is not set — IP hashes are unsalted.');
  }
  return createHash('sha256').update(`${salt}:${scope}:${subject}`).digest('hex');
}

// True when this request may proceed. Counted per `subject` when given (a
// signed-in user's id), otherwise per client IP. Fails open: if the check
// itself can't run (e.g. the database is briefly unavailable), the request is
// allowed and the failure is recorded, so the chat never goes down because
// of the limiter.
export async function checkRateLimit(req: Request, scope: RateLimitScope, subject?: string): Promise<boolean> {
  const limits = LIMITS[scope];
  try {
    const { data, error } = await createAdminClient().rpc('check_rate_limit', {
      p_key: rateLimitKey(scope, subject ?? clientIp(req)),
      p_per_min: limitFromEnv(`${limits.env}_PER_MIN`, limits.perMin),
      p_per_day: limitFromEnv(`${limits.env}_PER_DAY`, limits.perDay),
    });
    if (error) {
      logError('lib/rate-limit', error, { kind: 'unexpected', path: new URL(req.url).pathname });
      return true;
    }
    return data !== false;
  } catch (err) {
    logError('lib/rate-limit', err, { kind: 'unexpected', path: new URL(req.url).pathname });
    return true;
  }
}
