# Monitoring

> **Note:** No external monitoring/observability platform (Prometheus, Datadog, Sentry, Vercel Analytics/Speed Insights) is integrated — no such SDK or config exists in the repository. Since the monitoring/cleanup work (MLC-01–MLC-11), monitoring is **in-app**: errors and AI usage are written to Supabase tables and shown on two admin pages. Platform logs (`console.error`) still carry every error line too.

## What does exist

### Error log — `sys_errors` + `/admin/errors`

- **Every error the server sees** is written to `sys_errors` (migration `0035`) by [`lib/errors.ts`](../../../lib/errors.ts): `kind` `expected` (validation/auth/not-found 4xx) or `unexpected` (5xx, thrown errors, stream failures), with source, scrubbed message and stack, allow-listed context IDs, the session user and `environment` (`prod`/`dev`, from `APP_ENV` or `VERCEL_ENV`). 429s are deliberately **not** recorded (they're counted in `rate_limits`), so a flood can't flood the log.
- Sources feeding it:
  - all 24 API routes via `withErrorHandling` (`source = api/<path>`)
  - mid-stream `/api/chat` failures via `streamFailed()`
  - **`instrumentation.ts` `onRequestError`** — Server Component render, Server Action and proxy errors, with the original stack (`source = render:<routePath>` etc.; skips route handlers and `NEXT_*` redirect/notFound digests). Only loads when the server starts — restart `npm run dev` after changing it.
  - browser errors caught by `app/error.tsx`/`app/global-error.tsx`, POSTed to the public `/api/errors/client` (`source = client:<path>`)
  - `lib/rate-limit.ts` (limiter RPC failures) and `check-similar` (swallowed Anthropic failures)
- **`/admin/errors`** (admin only): the latest 50 rows, newest first, stack behind a click.
- **Retention: 30 days**, by **opportunistic purge** — after an insert, `lib/errors.ts` calls `purge_old_sys_errors(30)` at most once per server instance per hour. `pg_cron` is **not** enabled (confirmed on the dev project), so there is no scheduled job; a quiet instance simply purges on its next error.

### Usage — `ai_usage` + `/admin/usage`

- One `ai_usage` row (migration `0036`) per Claude call from `lib/ai-usage.ts`: area (explore/analyse/contribute), mode, flow, model, input/output/cache tokens, `ok`. Counts only — no prompt or reply text.
- **`/admin/usage`** (admin only) calls `admin_usage_stats()` (migration `0038`) once: users (total, new 7d, active 7d/30d), conversations per area (`designs` by `meta.flow` + `library_conversations` — signed-in Explore only), AI calls/failures/tokens per area (input shown as total = uncached + cache read + cache write), errors per day (UTC) and per source split by kind, plus the published-pathway count. Figures are computed when the page opens.

### Other

- **`console.error`** at every swallowed-failure point (e.g. `adoption_queries` insert failures, `sys_errors`/`ai_usage` insert failures) — visible only in the platform's log viewer (Vercel function logs, or `docker logs`/CloudWatch on the AWS path).
- **`adoption_queries`** — records every companion user message tagged with the pathways it drew on, but nothing reads it back yet. See [`../business/business-rules.md`](../business/business-rules.md#monitoring-rule).
- The Google Sheets conversation log (`lib/logger.ts`) was **removed** (MLC-09); there is no longer any store of full transcripts outside `designs`/`library_conversations`.

## What is not present

- No health-check endpoint (no `/api/health` or equivalent route found).
- No uptime/synthetic monitoring configuration.
- No error-tracking SDK (e.g. Sentry) instrumented anywhere.
- No alerts or SLO definitions — the admin pages must be looked at; nothing notifies anyone of a spike.
- No latency measurement.

## Roadmap context

The Product Charter (`docs/raw_documents/AI DIffusion Cube - Product Charter.docx`) names "structured logging: latency, errors, per-user/per-pathway usage" in its non-functional requirements backlog. Errors and per-area usage are now covered by `sys_errors`/`ai_usage`; latency and per-pathway usage are not. See [`../knowledge/technical-debt.md#roadmap-acknowledged-gaps`](../knowledge/technical-debt.md#roadmap-acknowledged-gaps).

## Recommended (not yet implemented)

Natural next additions: a `/api/health` route for the two deploy targets' health checks, Vercel's built-in Analytics/Speed Insights (zero extra infra), alerting on `sys_errors` spikes, and switching the routes that `console.error` the real error and return a hand-written 500 (e.g. `admin/pathways/publish`) to `throw`, so `sys_errors` gets the real text and stack instead of only the hand-written message.

## Source files

`lib/errors.ts`, `lib/ai-usage.ts`, `instrumentation.ts`, `app/api/errors/client/route.ts`, `app/admin/errors/page.tsx`, `app/admin/usage/page.tsx`, `supabase/migrations/0035_sys_errors.sql`–`0038_admin_usage_stats.sql`.
