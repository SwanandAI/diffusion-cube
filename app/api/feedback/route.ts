import { AuthError, ValidationError, withErrorHandling } from '@/lib/errors';
import { anonymousVisitorKey, checkRateLimit } from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { FEEDBACK_SURFACES, feedbackExcerpt, type FeedbackSurface } from '@/lib/message-feedback';

// A vote is a few short fields plus an excerpt of at most 500 characters.
const MAX_BODY_BYTES = 8 * 1024;
// Ids come from crypto.randomUUID() in the browser; allow any short token.
const MESSAGE_ID = /^[A-Za-z0-9-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SLUG_CHARS = 200;

// Records, changes or removes one thumbs up/down on a Cube reply
// (message_feedback, migration 0043). Analyse and Contribute replies need a
// session; /explore replies can be rated signed out too, keyed by a salted
// IP hash. Rate-limited first (per account, or per IP signed out), then
// size-capped and shape-checked. Written with the service role — the table
// has no client policy.
async function handlePOST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!(await checkRateLimit(req, 'feedback', user?.id))) {
    return Response.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  // Counted in UTF-8 bytes, not UTF-16 characters (see /api/errors/client).
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return Response.json({ error: 'Request too large.' }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new ValidationError('Invalid feedback.');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('Invalid feedback.');
  }

  const { messageId, surface, vote, conversationId, pathwaySlug, excerpt } = body;
  if (typeof messageId !== 'string' || !MESSAGE_ID.test(messageId)) throw new ValidationError('Invalid feedback.');
  if (typeof surface !== 'string' || !FEEDBACK_SURFACES.includes(surface as FeedbackSurface)) {
    throw new ValidationError('Invalid feedback.');
  }
  if (vote !== 'up' && vote !== 'down' && vote !== null) throw new ValidationError('Invalid feedback.');
  if (conversationId != null && (typeof conversationId !== 'string' || !UUID.test(conversationId))) {
    throw new ValidationError('Invalid feedback.');
  }
  if (pathwaySlug != null && (typeof pathwaySlug !== 'string' || pathwaySlug.length > MAX_SLUG_CHARS)) {
    throw new ValidationError('Invalid feedback.');
  }
  if (excerpt !== undefined && typeof excerpt !== 'string') throw new ValidationError('Invalid feedback.');

  if (!user && surface !== 'explore') throw new AuthError('Sign in to rate this reply.');

  const voterKey = user ? `user:${user.id}` : `anon:${anonymousVisitorKey(req)}`;
  const admin = createAdminClient();

  if (vote === null) {
    const { error } = await admin
      .from('message_feedback')
      .delete()
      .eq('message_id', messageId)
      .eq('voter_key', voterKey);
    if (error) throw error;
    return new Response(null, { status: 204 });
  }

  const { error } = await admin.from('message_feedback').upsert(
    {
      message_id: messageId,
      voter_key: voterKey,
      user_id: user?.id ?? null,
      surface,
      conversation_id: (conversationId as string | null | undefined) ?? null,
      pathway_slug: (pathwaySlug as string | null | undefined) || null,
      vote: vote === 'up' ? 1 : -1,
      message_excerpt: feedbackExcerpt((excerpt as string | undefined) ?? ''),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'message_id,voter_key' }
  );
  if (error) throw error;
  return new Response(null, { status: 204 });
}

export const POST = withErrorHandling('api/feedback', handlePOST);
