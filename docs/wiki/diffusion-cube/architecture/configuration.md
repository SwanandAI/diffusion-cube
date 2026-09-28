# Configuration

All configuration is via environment variables read directly with `process.env.*` — there is no central config module or schema-validated config loader. Reference implementation is [`lib/roles.ts`](../../../lib/roles.ts), [`lib/supabase/*.ts`](../../../lib/supabase/), [`lib/email.ts`](../../../lib/email.ts), [`lib/logger.ts`](../../../lib/logger.ts), [`lib/github.ts`](../../../lib/github.ts), [`app/api/chat/route.ts`](../../../app/api/chat/route.ts), and [`app/api/auth/send-email/route.ts`](../../../app/api/auth/send-email/route.ts).

## Environment variables (every `process.env.*` read in code, verified by repo-wide grep)

| Variable | Required? | Read in | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | `app/api/chat/route.ts`, `app/api/pathways/check-similar/route.ts` | Anthropic API key, module-scope client construction |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | `lib/supabase/{client,server,admin}.ts`, `proxy.ts`, `app/api/auth/send-email/route.ts` | Supabase project URL (client-side public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | `lib/supabase/{client,server}.ts`, `proxy.ts` | Supabase anon key (RLS-scoped) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | `lib/supabase/admin.ts` | Service-role key — bypasses RLS; used for admin actions and public-read paths (`/explore` server fetch) |
| `ADMIN_EMAILS` | No (fallback) | `lib/roles.ts`, `lib/email.ts` | Comma-separated permanent admin allow-list, case-insensitive — avoids a bootstrap deadlock before any `admin` role row exists |
| `WIKI_PATH` | No | `lib/wiki-loader.ts`, `lib/wiki-content.ts` | Overrides where the grounding corpus is read from (defaults to `content/wiki/` in-repo) |
| `GITHUB_TOKEN` | Yes (for contributor publish) | `lib/github.ts` | Bearer token for the GitHub Contents API |
| `GITHUB_REPO` | Yes (for contributor publish) | `lib/github.ts` | `owner/repo`, no URL prefix |
| `GITHUB_BRANCH` | No (defaults to `pathways-dev`) | `lib/github.ts` | Commit target branch — **using `main` here fires the production Vercel deploy workflow on every contributor assemble** |
| `SEND_EMAIL_HOOK_SECRET` | Yes | `app/api/auth/send-email/route.ts` | Standard Webhooks HMAC secret(s) (space-separated for rotation) verifying Supabase's Send Email Auth Hook |
| `SMTP_HOST` | Yes | `lib/email.ts` (also `scripts/smtp-test.mjs`) | SMTP server host |
| `SMTP_PORT` | Yes | `lib/email.ts` | 587 = STARTTLS, 465 = implicit TLS |
| `SMTP_SECURE` | No | `lib/email.ts` | Overrides the port-465-implies-TLS default |
| `SMTP_USER` | Yes | `lib/email.ts` | SMTP auth username |
| `SMTP_PASS` | Yes | `lib/email.ts` | SMTP auth password (app password / SMTP key, never a personal login password) |
| `EMAIL_FROM_ADDRESS` | Yes | `lib/email.ts` (also `scripts/smtp-test.mjs`) | Must be an address `SMTP_USER` is permitted to send as |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | No | `lib/logger.ts` | Service-account credentials JSON for the Sheets logging sink |
| `GOOGLE_SHEET_ID` | No | `lib/logger.ts` | Target spreadsheet for fire-and-forget conversation logging |

> **Note:** `GITHUB_TOKEN`/`GITHUB_REPO`/`GITHUB_BRANCH` are live, actively-used variables that are not listed in this repo's `CLAUDE.md` environment-variable table at all — that table only documents the now-inert `GITHUB_WIKI_BASE_URL`/`NEXT_PUBLIC_GITHUB_WIKI_BASE_URL`. Anyone provisioning a new environment from `CLAUDE.md` alone would miss these three.

## Confirmed no-longer-read variables

`GITHUB_WIKI_BASE_URL`, `NEXT_PUBLIC_GITHUB_WIKI_BASE_URL`, `APP_URL` — grepped across the whole repository, zero matches. `CLAUDE.md`'s claim that these are dead is accurate and still holds.

## Build-time vs runtime variables

Per the Dockerfile's own header comment (see [`../operations/deployment.md`](../operations/deployment.md)): any `NEXT_PUBLIC_*` variable is baked into the client JS bundle **at build time** — it must be supplied as a Docker build argument, not just a runtime environment variable, or the deployed image will serve a stale/empty value to the browser. All other variables above are read at request time and can be supplied purely at runtime.

## Feature flags

No feature-flag system exists. One hardcoded UI toggle was found: `SHOW_ORG_FILTER = false` in `app/contribute/ContributeGrid.tsx` (line 44) — an organisation-filter feature that exists in code but is switched off for every user. This is a compile-time constant, not a runtime flag.

## Where configuration is validated

Nowhere centrally. Each module that reads an env var does so with a non-null assertion (e.g. `lib/github.ts`'s `process.env.GITHUB_REPO!`) or a runtime guard specific to that call site (e.g. `scripts/smtp-test.mjs` checks its four SMTP vars before running). A misconfigured deployment surfaces as a runtime error in whichever code path first needs the missing value, not as a startup-time failure.
