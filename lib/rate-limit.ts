import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/errors';

// SERVER-ONLY. Per-IP rate limit for the public endpoints (the /explore chat
// and /api/errors/client), backed by check_rate_limit() in migration 0037.
// Limits come from EXPLORE_RATE_LIMIT_PER_MIN / EXPLORE_RATE_LIMIT_PER_DAY
// (defaults 20 / 200) so they can change without a code change.

export type RateLimitScope = 'explore' | 'client-error';

const DEFAULT_PER_MIN = 20;
const DEFAULT_PER_DAY = 200;

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
function rateLimitKey(scope: RateLimitScope, ip: string): string {
  const salt = process.env.RATE_LIMIT_SALT ?? '';
  if (!salt && !warnedNoSalt) {
    warnedNoSalt = true;
    console.warn('[rate-limit] RATE_LIMIT_SALT is not set — IP hashes are unsalted.');
  }
  return createHash('sha256').update(`${salt}:${scope}:${ip}`).digest('hex');
}

// True when this request may proceed. Fails open: if the check itself can't
// run (e.g. the database is briefly unavailable), the request is allowed and
// the failure is recorded, so the public chat never goes down because of the
// limiter.
export async function checkRateLimit(req: Request, scope: RateLimitScope): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc('check_rate_limit', {
      p_key: rateLimitKey(scope, clientIp(req)),
      p_per_min: limitFromEnv('EXPLORE_RATE_LIMIT_PER_MIN', DEFAULT_PER_MIN),
      p_per_day: limitFromEnv('EXPLORE_RATE_LIMIT_PER_DAY', DEFAULT_PER_DAY),
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
