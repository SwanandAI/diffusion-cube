# Third-Party Integrations

| Integration | SDK/Client | Used for | Env vars |
|---|---|---|---|
| Anthropic API | `@anthropic-ai/sdk` | All model calls — see [`ai-llm.md`](ai-llm.md) | `ANTHROPIC_API_KEY` |
| Supabase (Postgres + Auth) | `@supabase/supabase-js`, `@supabase/ssr` | All persistence, auth, RLS | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| GitHub Contents API | Hand-rolled `lib/github.ts` (fetch-based, no SDK) | Contributor "assemble" publish — commits `content/wiki/pathways/<slug>.md` | `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH` |
| SMTP (generic, provider-agnostic) | `nodemailer` | All auth emails (signup OTP, password reset, reauthentication, invite/magiclink), triggered by Supabase's Send Email Auth Hook | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM_ADDRESS` |
| Google Sheets API | `googleapis` | Fire-and-forget conversation logging (`lib/logger.ts`) | `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID` |
| Vercel | GitHub Actions `vercel` CLI | Production deploy target — see [`../operations/deployment.md`](../operations/deployment.md) | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (CI secrets, not app runtime vars) |

## Fallback Behavior

| Integration | On failure | Behavior |
|---|---|---|
| Anthropic API (`/api/chat` streaming modes) | SDK-level error | **Hard fail** — no try/catch around `anthropic.messages.stream`; surfaces as an unhandled Next.js 500. No fallback model, no cached response |
| Anthropic API (`/api/pathways/check-similar`) | Call throws | **Soft degrade** — caught and returns `{matchId: null}` (treated as "no duplicate found"); pathway creation proceeds normally. `console.error` only, not surfaced to the user |
| GitHub Contents API (`lib/github.ts`, via `/api/pathways/assemble`) | Read/write fails | **Hard fail** — no fallback; the assemble request errors out to the contributor, who must retry |
| SMTP (`lib/email.ts`) | Send fails | **Hard fail** to the caller of `/api/auth/send-email` — the route returns an error status, which surfaces in Supabase's Auth Hook retry/error UI. No secondary email provider |
| Google Sheets logging (`lib/logger.ts`) | Any error in the append call | **Soft degrade, fully silent** — caught, `console.error`'d, never retried, never affects the response already sent to the user. This is deliberate: logging is explicitly non-critical-path |
| `adoption_queries` insert (`/api/chat`, companion mode only) | Insert fails | **Soft degrade, fully silent** — same pattern as Sheets logging |
| Supabase (any table read/write) | Query fails | No uniform handling — most routes return a 500/error JSON to the caller; RLS violations surface as Postgres errors passed through |

> **Note:** There is no circuit breaker, exponential backoff, or automatic failover to a secondary provider anywhere in this integration layer. Every third-party call either succeeds, hard-fails to the caller, or is fire-and-forget and silently swallowed — there is no middle-ground resilience pattern implemented today. See [`../knowledge/technical-debt.md#td-05`](../knowledge/technical-debt.md#td-05).

## Deployment-only integration

**Vercel** is not called from application code at all — it is purely a CI/CD target, driven by `.github/workflows/deploy.yml`. See [`../operations/deployment.md`](../operations/deployment.md) for the full deploy path, including the documented workaround for Vercel's Hobby-plan commit-author restriction.

## Source files

`lib/github.ts`, `lib/email.ts`, `lib/logger.ts`, `app/api/pathways/check-similar/route.ts`, `app/api/chat/route.ts`, `app/api/auth/send-email/route.ts`, `.github/workflows/deploy.yml`.
