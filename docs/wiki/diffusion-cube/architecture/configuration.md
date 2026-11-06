# Configuration

*Last verified against code: 2026-11-06 (HEAD `0a1ca00`) — every `process.env.*` read under `app/`, `lib/`, `scripts/`, `proxy.ts`, `instrumentation.ts`, cross-checked with `.env.example`.*

All configuration is via environment variables read directly with `process.env.*` — there is no central config module or schema-validated config loader. Reference implementation is [`lib/roles.ts`](../../../../lib/roles.ts), [`lib/supabase/*.ts`](../../../../lib/supabase/), [`lib/email.ts`](../../../../lib/email.ts), [`lib/errors.ts`](../../../../lib/errors.ts), [`lib/rate-limit.ts`](../../../../lib/rate-limit.ts), [`lib/explore-guard.ts`](../../../../lib/explore-guard.ts), [`lib/embeddings.ts`](../../../../lib/embeddings.ts), [`lib/retrieval.ts`](../../../../lib/retrieval.ts), [`app/api/chat/route.ts`](../../../../app/api/chat/route.ts), and [`app/api/auth/send-email/route.ts`](../../../../app/api/auth/send-email/route.ts).

A template with every variable below (placeholders only) is committed as [`.env.example`](../../../../.env.example) at the repo root. Copy it to `.env.local` to start. `.gitignore` ignores `.env*` except that file. It also lists `SUPABASE_DB_URL`, which the app never reads — it is only for running migrations with `psql`.

**Models are not configurable.** The model IDs (`claude-sonnet-4-6`, and `claude-haiku-5-5` for the retrieval classifier) are string constants in code, not env vars — see [`../integrations/ai-llm.md`](../integrations/ai-llm.md#model-parameters--api-key-management).

## Environment variables (every `process.env.*` read in code, verified by repo-wide grep)

| Variable | Required? | Read in | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | `app/api/chat/route.ts`, `app/api/pathways/check-similar/route.ts`, `lib/retrieval.ts` (also `scripts/seed-pathways.ts`) | Anthropic API key, module-scope client construction |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | `lib/supabase/{client,server,admin}.ts`, `proxy.ts`, `app/api/auth/send-email/route.ts`, `lib/embeddings.ts` | Supabase project URL (client-side public); also the base of the `embed` Edge Function URL (`/functions/v1/embed`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | `lib/supabase/{client,server}.ts`, `proxy.ts` | Supabase anon key (RLS-scoped) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | `lib/supabase/admin.ts`, `lib/embeddings.ts` | Service-role key — bypasses RLS; used for admin actions, public-read paths (`/explore`), the service-role-only hybrid-search RPCs, and as the bearer token for the `embed` Edge Function (no separate embedding key exists) |
| `ADMIN_EMAILS` | No (fallback) | `lib/roles.ts`, `lib/email.ts` | Comma-separated permanent admin allow-list, case-insensitive — avoids a bootstrap deadlock before any `admin` role row exists. (The `lib/email.ts` read is inside `sendAdminApprovalEmail`, which has no callers since approval was removed in migration `0039` — dead code) |
| `SEND_EMAIL_HOOK_SECRET` | Yes | `app/api/auth/send-email/route.ts` | Standard Webhooks HMAC secret(s) (space-separated for rotation) verifying Supabase's Send Email Auth Hook |
| `SMTP_HOST` | Yes | `lib/email.ts` (also `scripts/smtp-test.mjs`) | SMTP server host |
| `SMTP_PORT` | Yes | `lib/email.ts` | 587 = STARTTLS, 465 = implicit TLS |
| `SMTP_SECURE` | No | `lib/email.ts` | Overrides the port-465-implies-TLS default |
| `SMTP_USER` | Yes | `lib/email.ts` | SMTP auth username |
| `SMTP_PASS` | Yes | `lib/email.ts` | SMTP auth password (app password / SMTP key, never a personal login password) |
| `EMAIL_FROM_ADDRESS` | Yes | `lib/email.ts` (also `scripts/smtp-test.mjs`) | Must be an address `SMTP_USER` is permitted to send as |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | No (defaults to `kamesh@ekstep.org`) | `lib/legal.ts` | "Contact Us" address substituted for `{{SUPPORT_EMAIL}}` in `content/legal/*.md`. Inlined at build time, so a change needs a rebuild. The Grievance Officer's email in those documents is literal text, not this variable |
| `APP_ENV` | No | `lib/errors.ts` (`currentEnvironment`) | `prod` or `dev` — the `environment` stamped on `sys_errors` rows. Set it on the Docker/AWS path; if unset, Vercel's `VERCEL_ENV === 'production'` → `prod`, everything else (previews, local) → `dev` |
| `RATE_LIMIT_SALT` | Yes (for salted hashes) | `lib/rate-limit.ts` | Salt for the SHA-256 rate-limit key (`salt:scope:subject`, where subject is the client IP or, for `chat-user`, the user id). Unset → unsalted hashes and a one-time `console.warn` |
| `EXPLORE_RATE_LIMIT_PER_MIN` | No (default 20) | `lib/rate-limit.ts` | Per-IP per-minute limit; an invalid/non-positive value falls back to the default. Shared by the three per-IP scopes — `explore` (anonymous `/api/chat`), `client-error` (`/api/errors/client`) and `anon-error` (recording anonymous 4xx errors) — each counted separately |
| `EXPLORE_RATE_LIMIT_PER_DAY` | No (default 200) | `lib/rate-limit.ts` | Per-IP per-day limit, same rules |
| `CHAT_USER_RATE_LIMIT_PER_MIN` | No (default 30) | `lib/rate-limit.ts` | Per-**account** per-minute limit on signed-in `/api/chat` calls, every mode (scope `chat-user`). Higher than the per-IP default because one session also makes background calls (extract-insights per upload, drafts, documents). Same fallback rule |
| `CHAT_USER_RATE_LIMIT_PER_DAY` | No (default 300) | `lib/rate-limit.ts` | Per-account per-day limit, same rules |
| `EXPLORE_MAX_MESSAGES` | No (default 20) | `lib/explore-guard.ts` | Max messages in an Explore (`library` mode) conversation, Cube's replies included; over it → 400. Invalid/non-positive → default. Read per request |
| `EXPLORE_MAX_USER_MESSAGE_CHARS` | No (default 1000) | `lib/explore-guard.ts` | Max characters in one visitor message (Cube's replies exempt), same rules |
| `EXPLORE_MAX_TOTAL_CHARS` | No (default 20000) | `lib/explore-guard.ts` | Max characters across the whole conversation, Cube's replies included, same rules |

> **Note:** The `embed` Supabase Edge Function needs no app-side configuration beyond the two Supabase variables above, but it must be deployed once per Supabase project (`supabase functions deploy embed --project-ref <ref>`). Inside the function, `SUPABASE_SERVICE_ROLE_KEY` is provided by the Supabase runtime itself. See [`../integrations/third-party-integrations.md`](../integrations/third-party-integrations.md#supabase-edge-function-embed).

## Confirmed no-longer-read variables

`GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH` — read only by the deleted `lib/github.ts` (contributor publish used to commit pathway files via the GitHub Contents API). Pathways now live in Supabase; remove these from `.env.local`, Vercel and any Docker env file.

`WIKI_PATH` — read only by the removed `loadWikiContext()` / old `lib/wiki-content.ts` file reads. `content/wiki/` no longer exists, so the old "leave it unset, not empty" pitfall is gone with it.

`GITHUB_WIKI_BASE_URL`, `NEXT_PUBLIC_GITHUB_WIKI_BASE_URL`, `APP_URL` — grepped across the whole repository, zero matches.

`GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID` — read only by the deleted `lib/logger.ts` (Google Sheets conversation logging, removed in MLC-09). Nothing reads them now; remove them from `.env.local`, Vercel and any Docker env file.

`VERCEL_ENV`, `NEXT_RUNTIME` and `NODE_ENV` are platform-set (read by `lib/errors.ts`, `instrumentation.ts`, and `lib/static-content.ts` / `app/api/chat/route.ts` respectively), not something to configure.

## Build-time vs runtime variables

Per the Dockerfile's own header comment (see [`../operations/deployment.md`](../operations/deployment.md)): any `NEXT_PUBLIC_*` variable is baked into the client JS bundle **at build time** — it must be supplied as a Docker build argument, not just a runtime environment variable, or the deployed image will serve a stale/empty value to the browser. All other variables above are read at request time and can be supplied purely at runtime.

## Feature flags

No feature-flag system exists. One hardcoded UI toggle was found: `SHOW_ORG_FILTER = false` in `app/contribute/ContributeGrid.tsx` (line 59) — an organisation-filter feature that exists in code but is switched off for every user. This is a compile-time constant, not a runtime flag.

## Where configuration is validated

Nowhere centrally. Each module that reads an env var does so with a non-null assertion (e.g. `lib/supabase/admin.ts`'s `process.env.SUPABASE_SERVICE_ROLE_KEY!`), a defaulting parser (`limitFromEnv` in `lib/rate-limit.ts` / `lib/explore-guard.ts`), or a runtime guard specific to that call site (e.g. `lib/embeddings.ts` throws if the Supabase URL or service-role key is missing — which retrieval then treats as "search by full text only"; `scripts/smtp-test.mjs` checks its four SMTP vars before running). The seed script loads `.env.local` itself via `process.loadEnvFile`. A misconfigured deployment surfaces as a runtime error in whichever code path first needs the missing value, not as a startup-time failure.
