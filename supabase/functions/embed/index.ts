// Supabase Edge Function: text → 384-dim gte-small embeddings
// (docs/features/pathway-storage/, PS-02). gte-small is open source (MIT) and
// runs inside Supabase's own edge runtime, so no embedding vendor or API key
// is involved. Called only by the app's server (lib/embeddings.ts) and the
// seed script, with the project's service-role key.
//
// Deploy once per Supabase project (dev and prod are separate):
//   supabase functions deploy embed --project-ref <ref>
//
// This file runs on Deno, not Node — it's excluded from the Next.js
// tsconfig and from ESLint.

// gte-small reads at most ~512 tokens; longer text is truncated by the
// model. Units are ~200–400 tokens and source chunks are cut to ~400.
const MAX_TEXTS = 32;
const MAX_CHARS = 8000;

// deno-lint-ignore no-explicit-any
const session = new (globalThis as any).Supabase.ai.Session('gte-small');

// Only the service role may call this. Accepts the runtime's own service-role
// key verbatim, or a JWT whose role claim is service_role: the runtime's key
// can be in a different format (sb_secret_…) from the legacy JWT the app
// holds. Reading the claim without checking the signature is safe ONLY
// because the function keeps Supabase's default JWT verification (the
// gateway rejects a forged token before this code runs) — never deploy it
// with --no-verify-jwt.
function isServiceRole(auth: string): boolean {
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  // deno-lint-ignore no-explicit-any
  const serviceKey = (globalThis as any).Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (serviceKey && token === serviceKey) return true;
  const payload = token.split('.')[1];
  if (!payload) return false;
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return claims?.role === 'service_role';
  } catch {
    return false;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// deno-lint-ignore no-explicit-any
(globalThis as any).Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405);

  if (!isServiceRole(req.headers.get('Authorization') ?? '')) return json({ error: 'Unauthorized.' }, 401);

  let texts: unknown;
  try {
    texts = (await req.json())?.texts;
  } catch {
    return json({ error: 'Body must be JSON.' }, 400);
  }
  if (
    !Array.isArray(texts) ||
    texts.length === 0 ||
    texts.length > MAX_TEXTS ||
    texts.some((t) => typeof t !== 'string' || t.trim() === '')
  ) {
    return json({ error: `texts must be 1–${MAX_TEXTS} non-empty strings.` }, 400);
  }

  const embeddings: number[][] = [];
  for (const text of texts as string[]) {
    const vector = await session.run(text.slice(0, MAX_CHARS), { mean_pool: true, normalize: true });
    embeddings.push(Array.from(vector as ArrayLike<number>));
  }
  return json({ embeddings });
});
