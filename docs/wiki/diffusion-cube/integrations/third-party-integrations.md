# Third-Party Integrations

*Last verified against code: 2026-11-06 (HEAD `0a1ca00` plus working tree).*

| Integration | SDK/Client | Used for | Env vars |
|---|---|---|---|
| Anthropic API | `@anthropic-ai/sdk` | All model calls — Sonnet 4.6 for chat, documents, drafts, `check-similar` and seeding; Haiku for the retrieval classifier. See [`ai-llm.md`](ai-llm.md) | `ANTHROPIC_API_KEY` |
| Supabase (Postgres + Auth) | `@supabase/supabase-js`, `@supabase/ssr` | All persistence (pathways and their versions/units now included), auth, RLS, the `check_rate_limit` RPC, and the hybrid-search RPCs `match_pathway_units` / `match_source_chunks` (pgvector + full text, service-role only) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Supabase Storage | `supabase-js` `storage` | Private buckets `toolkit-assets` (contributor files; signed upload/download URLs) and `pathway-sources` (seeded pathways' original files; written by the seed script, removed on pathway delete via `removeSourceObjects`) | same as Supabase |
| Supabase Edge Function `embed` | Plain `fetch` from `lib/embeddings.ts` (no SDK) | Text → 384-dim `gte-small` embeddings for pathway units (on publish), seeded source passages, and every retrieval query | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (no separate key) |
| SMTP (generic, provider-agnostic) | `nodemailer` | All auth emails (signup OTP, password reset, reauthentication, invite/magiclink), triggered by Supabase's Send Email Auth Hook; plus the "your pathway is live" contributor email on admin publish (`sendContributionEmail`) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM_ADDRESS` |
| Vercel | GitHub Actions `vercel` CLI | Production deploy target — see [`../operations/deployment.md`](../operations/deployment.md) | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (CI secrets, not app runtime vars) |

## Supabase Edge Function `embed`

*New since 2026-10-20 (pathway-storage feature).*

- **What it is**: a Deno function at `supabase/functions/embed/index.ts` that runs the open-source (MIT) **`gte-small`** model inside Supabase's own edge runtime (`Supabase.ai.Session('gte-small')`, mean-pooled and normalised). No embedding vendor or API key is involved.
- **Contract**: `POST {texts: string[]}` → `{embeddings: number[][]}` (384 dims each). Accepts 1–32 non-empty strings, each truncated to 8,000 chars (the model reads ~512 tokens anyway). 405 for non-POST, 400 for a bad body, 401 unless the bearer token is the runtime's service-role key or a JWT with `role: service_role` — which relies on Supabase's default gateway JWT verification, so it must **never** be deployed with `--no-verify-jwt`.
- **Deploy**: once per Supabase project (dev and prod separately): `supabase functions deploy embed --project-ref <ref>`. It is excluded from the Next.js `tsconfig` and ESLint.
- **Client** (`lib/embeddings.ts` `embedTexts`): calls `${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/embed` with the service-role key, in **batches of 4** (8 measured to fail with `546 WORKER_RESOURCE_LIMIT` on 2026-11-04; callers keep each text ≤ ~1,600 chars), **20 s timeout** per request, **up to 2 retries** (1 s then 2 s back-off) on 503/504/546 or a dropped connection; any other status fails at once. Validates count and dimensions; never returns partial or zero vectors — it throws, logging only the text count to `sys_errors`.
- **Callers**: `lib/pathway-store.ts` `publishVersion` (unit vectors), `lib/retrieval.ts` (query vector per question), `scripts/seed-pathways.ts` (source passages).

## Fallback Behavior

| Integration | On failure | Behavior |
|---|---|---|
| Anthropic API (`/api/chat` streaming modes) | SDK-level error | **Fail with a generic message** — before streaming: `withErrorHandling` returns 500 + generic message; mid-stream: `streamFailed()` errors the stream and the client shows the partial reply + generic message, unsaved. Recorded in `sys_errors` and as an `ok:false` `ai_usage` row. No retry, no fallback model |
| Anthropic API (Haiku classifier, `lib/retrieval.ts`) | Call throws or returns no usable tool input | **Soft degrade** — default classification for the surface (`situation` / `broad` / `specific` on the open pathway); recorded via `logError` + `ok:false` `ai_usage`; the reply still goes ahead |
| Anthropic API (`/api/pathways/check-similar`) | Call throws | **Soft degrade** — returns `{matchId: null}` (treated as "no duplicate found"); pathway creation proceeds. Recorded via `logError` + `ok:false` `ai_usage`, not surfaced to the user |
| Anthropic API (seed script) | Connection drops mid-generation | **Retry** up to twice; any other error (or `max_tokens`) fails that pathway. A successful generation is cached in `.seed-cache/` so a re-run doesn't pay again |
| `embed` Edge Function — retrieval query | Busy/timeout/any error after retries | **Soft degrade** — search runs on full text + labels only (`query_embedding = null`); source passages are skipped |
| `embed` Edge Function — publish (`publishVersion`) | Any error after retries | **Soft degrade** — the version is published and its units stored **without** vectors (still found by full text); recorded in `sys_errors`; the admin publish response carries `embedded: false`; a later publish embeds them |
| `embed` Edge Function — seed script | Any error after retries | **Hard fail** for that pathway's run |
| Hybrid-search RPCs (`match_pathway_units`, `match_source_chunks`) | Database error | **Hard fail** — thrown; `withErrorHandling` answers 500 + generic message |
| Supabase Storage (`removeSourceObjects` on delete) | Remove fails | **Soft degrade** — logged to `sys_errors`, the delete proceeds |
| SMTP (`lib/email.ts`) — auth emails | Send fails | **Hard fail** to the caller of `/api/auth/send-email` — the route returns an error status, which surfaces in Supabase's Auth Hook retry/error UI. No secondary email provider |
| SMTP — contributor "pathway is live" email | Send fails | **Soft degrade** — logged, never returned; the pathway is already published |
| `adoption_queries` insert (`/api/chat`, companion mode only) | Insert fails | **Soft degrade, fully silent** — caught, `console.error`'d, never affects the response already sent |
| `sys_errors` / `ai_usage` writes (`lib/errors.ts`, `lib/ai-usage.ts`) | Insert fails | **Soft degrade** — written inside `after()`, never throw, `console.error` only |
| Rate limiter (`check_rate_limit` RPC) | RPC errors/throws | **Fails open** — the request is allowed and the failure recorded in `sys_errors` |
| Supabase (any other table read/write) | Query fails | Routes return their own error responses, but `withErrorHandling` replaces every 5xx body with the generic message (raw text goes to `sys_errors` only) |

> **Note:** There is still no circuit breaker or automatic failover to a secondary provider. The `embed` client's bounded retry (2 retries with linear back-off) and the seed script's dropped-connection retry are the only retry logic in the repo; in-app Anthropic calls are never retried. See [`../knowledge/technical-debt.md#td-05`](../knowledge/technical-debt.md#td-05).

## Removed integrations

- **GitHub Contents API** (`lib/github.ts`, env vars `GITHUB_TOKEN` / `GITHUB_REPO` / `GITHUB_BRANCH`) — removed with the pathway-storage feature. Contributor "Send for review" (`/api/pathways/assemble`) now saves a `pathway_versions` row via `lib/pathway-store.ts` `saveVersion`, and an admin publish (`publishVersion`) makes it live in the database; nothing is committed to the repo any more, so a contributor publish no longer triggers a deploy.
- **Google Sheets** (`googleapis`, `lib/logger.ts`, env vars `GOOGLE_SERVICE_ACCOUNT_JSON`/`GOOGLE_SHEET_ID`) — fire-and-forget conversation logging, removed in MLC-09 along with ~58 transitive packages. Conversation activity is visible through `ai_usage` + `/admin/usage` instead (counts only, no transcripts).
- The unused **`diff`** / `@types/diff` dependencies were removed (MLC-17).

## Deployment-only integration

**Vercel** is not called from application code at all — it is purely a CI/CD target, driven by `.github/workflows/deploy.yml` (which does not run the Vitest suite). See [`../operations/deployment.md`](../operations/deployment.md) for the full deploy path, including the documented workaround for Vercel's Hobby-plan commit-author restriction. The `embed` Edge Function is deployed separately with the Supabase CLI (above), not by CI.

## Source files

`lib/embeddings.ts`, `supabase/functions/embed/index.ts`, `lib/retrieval.ts`, `lib/pathway-store.ts`, `lib/toolkit-assets-server.ts`, `lib/email.ts`, `lib/errors.ts`, `lib/ai-usage.ts`, `lib/rate-limit.ts`, `app/api/pathways/check-similar/route.ts`, `app/api/pathways/assemble/route.ts`, `app/api/admin/pathways/publish/route.ts`, `app/api/chat/route.ts`, `app/api/auth/send-email/route.ts`, `scripts/seed-pathways.ts`, `supabase/migrations/0042_pathway_storage.sql`, `.github/workflows/deploy.yml`.
