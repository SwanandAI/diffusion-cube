import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/roles';
import { logError, withErrorHandling } from '@/lib/errors';
import { recordAiUsage } from '@/lib/ai-usage';
import { readStaticFile } from '@/lib/static-content';
import {
  DIGEST_TOOL,
  buildDigestInput,
  emptyDigest,
  validateDigest,
  type DigestPayload,
  type DigestPeriod,
  type RawDigestInput,
} from '@/lib/feedback-digest';

// POST /api/admin/digest  { periodDays: 7 | 30 }
//
// Generates the admin Feedback Digest for one period
// (docs/features/feedback-digest/, FD-05). Admin only — this route is the
// real gate; the page's check is UX. Everything is read and written with
// the service role through migration 0045's functions:
//   claim_feedback_digest_run  → one run at a time, at most DAILY_CAP a day
//   admin_digest_input         → the period's questions and 👎 votes
//   one forced-tool Claude call → validateDigest (code checks every item)
//   finish_feedback_digest_run → saves it (only while holding the lease) and
//                                 records how the run ended
// Tokens are recorded in ai_usage (area 'admin') like every other call.
// A failed run keeps the previous digest. The button maps statuses to the
// requirement's wording, since withErrorHandling replaces any 5xx body.

// The model can take a minute or two; the platform must allow this long.
export const maxDuration = 300;

// One more hardcoded model id (TD-20).
const MODEL = 'claude-sonnet-4-6';
// Room for four short sections; a max_tokens stop is a failed run.
const MAX_TOKENS = 6000;
// Regenerations per IST day across all admins (requirement, assumption 11):
// bounds the number of large model calls a day.
const DAILY_CAP = 10;
const PROMPT_FILE = path.join(process.cwd(), 'content', 'feedback-digest-prompt.md');

// A deliberate exception to TD-05 (no explicit retry/timeout elsewhere): a
// silent retry could double the model calls and run past maxDuration, so a failure
// is reported at once and the admin presses Regenerate again.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 240_000, maxRetries: 0 });

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

async function handlePOST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json(401, { error: 'Please sign in.' });
  if (!(await isAdmin(supabase, user.email))) return json(403, { error: 'Admin only.' });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const periodRaw = body && typeof body === 'object' && !Array.isArray(body) ? body.periodDays : undefined;
  if (periodRaw !== 7 && periodRaw !== 30) return json(400, { error: 'periodDays must be 7 or 30.' });
  const period: DigestPeriod = periodRaw;

  const admin = createAdminClient();
  const { data: claim, error: claimError } = await admin.rpc('claim_feedback_digest_run', {
    p_period: period,
    p_admin: user.id,
    p_cap: DAILY_CAP,
  });
  if (claimError) throw claimError;
  const claimed = (claim ?? {}) as { run_id?: string; error?: string };
  if (claimed.error === 'busy') return json(409, { error: 'busy' });
  if (claimed.error === 'daily_limit') return json(429, { error: 'daily_limit' });
  if (!claimed.run_id) throw new Error('claim_feedback_digest_run returned no run');
  const runId = claimed.run_id;

  const finish = async (status: 'succeeded' | 'empty' | 'failed', payload: DigestPayload | null) => {
    const { data, error } = await admin.rpc('finish_feedback_digest_run', {
      p_run: runId,
      p_status: status,
      p_payload: payload,
    });
    if (error) throw error;
    return data === true;
  };
  const fail = async (reason: unknown) => {
    logError('api/admin/digest', reason, { kind: 'unexpected', user_id: user.id });
    // Best effort: if even this fails, the lease expires by itself.
    await finish('failed', null).catch((err) => logError('api/admin/digest', err, { kind: 'unexpected' }));
    return json(503, { error: 'failed' });
  };

  try {
    const { data: rawInput, error: inputError } = await admin.rpc('admin_digest_input', { p_days: period });
    if (inputError || !rawInput) return await fail(inputError ?? new Error('admin_digest_input returned nothing'));
    const input = buildDigestInput(rawInput as RawDigestInput, period);

    // Nothing said and no 👎 in the period: an empty digest, no model call.
    if (input.basis.messages_used === 0 && input.basis.feedback_used === 0) {
      const saved = await finish('empty', emptyDigest(period, input.basis));
      return saved ? json(200, { ok: true }) : json(409, { error: 'superseded' });
    }

    const system = await readStaticFile(PROMPT_FILE);
    if (!system) return await fail(new Error('content/feedback-digest-prompt.md is missing or empty'));

    let message: Anthropic.Message;
    try {
      message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: system.trim(),
        tools: [DIGEST_TOOL],
        tool_choice: { type: 'tool', name: DIGEST_TOOL.name },
        messages: [{ role: 'user', content: input.text }],
      });
    } catch (err) {
      recordAiUsage({ mode: 'digest', model: MODEL, usage: null, ok: false, userId: user.id });
      return await fail(err);
    }
    const usage = message.usage ?? null;

    // A max_tokens stop means the tool input was cut off: a failed run.
    const tool = message.content.find((b) => b.type === 'tool_use');
    if (message.stop_reason === 'max_tokens' || !tool || tool.type !== 'tool_use') {
      recordAiUsage({ mode: 'digest', model: MODEL, usage, ok: false, userId: user.id });
      return await fail(new Error(`digest model output unusable (stop_reason: ${message.stop_reason ?? 'none'})`));
    }
    recordAiUsage({ mode: 'digest', model: MODEL, usage, ok: true, userId: user.id });

    const payload = validateDigest(tool.input, input.refs, { period, basis: input.basis });
    // The model returned items but none survived the reference checks: not a
    // digest to save over the last good one.
    const returned = (['topics', 'unanswered', 'terms'] as const).some((k) => {
      const list = (tool.input as Record<string, unknown> | null)?.[k];
      return Array.isArray(list) && list.length > 0;
    });
    if (returned && !payload.topics.length && !payload.unanswered.length && !payload.terms.length) {
      return await fail(new Error('digest model returned items but none passed validation'));
    }
    const saved = await finish('succeeded', payload);
    return saved ? json(200, { ok: true }) : json(409, { error: 'superseded' });
  } catch (err) {
    return await fail(err);
  }
}

export const POST = withErrorHandling('api/admin/digest', handlePOST);
