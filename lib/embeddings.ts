import { logError } from '@/lib/errors';

// Text → 384-dim gte-small vectors through the `embed` Supabase Edge Function
// (supabase/functions/embed). Used for pathway units on publish, seeded
// source passages, and every Explore / Analyse question
// (docs/features/pathway-storage/).
//
// Throws on any failure and never returns partial or zero vectors, so each
// caller can degrade on its own terms: publish stores units without vectors,
// search falls back to full text + labels.

export const EMBEDDING_DIMENSIONS = 384;
// Small batches: the Edge Function runs gte-small within the runtime's
// CPU / memory limits. Measured on dev (2026-11-04): 4 texts of ~1,600
// characters take ~1.3 s; 8 fail with 546 WORKER_RESOURCE_LIMIT. Callers keep
// each text ≤ ~1,600 characters (units: unitEmbeddingText; passages:
// chunkText).
const BATCH_SIZE = 4;
const TIMEOUT_MS = 20_000;
// The function's "busy / over limit" answers are worth one or two more tries;
// anything else (401, 400, malformed) fails at once.
const RETRYABLE = new Set([503, 504, 546]);
const RETRIES = 2;

function endpoint(): { url: string; key: string } {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('Supabase URL or service-role key is not configured.');
  return { url: `${base.replace(/\/+$/, '')}/functions/v1/embed`, key };
}

async function embedBatch(texts: string[], url: string, key: string): Promise<number[][]> {
  let res: Response | null = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt));
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ texts }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // A dropped connection ("fetch failed") is retried like a busy answer.
      if (attempt === RETRIES) throw err;
      continue;
    }
    if (res.ok || !RETRYABLE.has(res.status)) break;
  }
  if (!res || !res.ok) throw new Error(`embed function answered ${res?.status}`);
  const body = (await res.json()) as { embeddings?: unknown };
  const vectors = body.embeddings;
  if (
    !Array.isArray(vectors) ||
    vectors.length !== texts.length ||
    vectors.some((v) => !Array.isArray(v) || v.length !== EMBEDDING_DIMENSIONS)
  ) {
    throw new Error('embed function returned malformed embeddings');
  }
  return vectors as number[][];
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { url, key } = endpoint();
  const out: number[][] = [];
  try {
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      out.push(...(await embedBatch(texts.slice(i, i + BATCH_SIZE), url, key)));
    }
  } catch (err) {
    // No text in the log: only how many were asked for.
    logError('lib/embeddings', err, { count: texts.length });
    throw err;
  }
  return out;
}

// pgvector's text form, for supabase-js inserts and RPC arguments.
export function toPgVector(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
