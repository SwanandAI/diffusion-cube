# Backend

There is no separate backend service — "backend" here means the `app/api/**/route.ts` handlers and the `lib/` modules they call, all running inside the same Next.js process as the frontend.

## Request lifecycle

1. `proxy.ts` (Next.js middleware) intercepts every request except static assets. It calls `supabase.auth.getUser()` (revalidated against Supabase, not just cookie-trusted) and either allows through, 401s an API path, or redirects a page path to `/login` (or `/explore` for anonymous root hits).
2. `proxy.ts` deletes any client-sent `x-user-email` on **every** forwarded request (`forwardedHeaders()`), and sets it again only on the signed-in branch from the verified `user.email`, so downstream server components can skip a second `getUser()` call without trusting a forged header.
3. Each `route.ts` handler independently re-derives the caller's role via `lib/roles.ts` (`hasRole`/`hasAnyRole`/`isAdmin`) before doing anything sensitive — this is the real enforcement layer, not the middleware.
4. Every handler is exported through `withErrorHandling()` (`lib/errors.ts`), which records errors in `sys_errors` and replaces any 5xx body with the generic message — see [Error handling posture](#error-handling-posture).

## Core service modules (`lib/`)

| Module | Responsibility |
|---|---|
| `system-prompts.ts` | Every prompt-builder function; the definitive source of runtime model behavior |
| `adoption-conversation.ts` | Client-side hook — but architecturally central: owns every write to `designs`/`design_documents` triggered by a model turn |
| `wiki-loader.ts` | Loads the grounding corpus (`content/wiki/pathways/`) + framework + resources + generation prompt for prompt injection |
| `library-documents.ts` | Library chat documents: one pathway by slug from `content/wiki/pathways/` (or `published_pathways`), Source Trace stripped; general-chat overview of the card set |
| `wiki-content.ts` | Loads the grounding corpus for on-demand `/wiki` browsing, stripping Provenance appendix + frontmatter |
| `dimensions.ts` | Structural shape of the 4×4 grid — dimension codes, sub-categories, per-stage weights, colors |
| `grid-update.ts` | Parses/strips the `<grid_update>` block; shared marker constants |
| `design-documents.ts` | Versioned document storage helpers, content-hash caching |
| `pathway-gaps.ts` | Regex-extracts the gap list from a generated pathway draft's Section 2 |
| `contributor-registration.ts` | Registration form submission logic, fixed role/sharing-level enumerations |
| `organisations.ts` | Organisation search + find-or-create |
| `github.ts` | Real GitHub Contents API read/write for contributor "assemble" publish |
| `roles.ts` | The entire access-control primitive |
| `email.ts` | Nodemailer/SMTP transport + every auth email template |
| `errors.ts` / `error-messages.ts` | Server-only error recording (`withErrorHandling`, `logError`, `recordServerError`, `scrub`, expected-error classes) / the client-safe `GENERIC_ERROR_MESSAGE` |
| `rate-limit.ts` / `explore-guard.ts` | Per-IP salted-hash rate limit via `check_rate_limit()` (fails open) / input caps for `library` mode |
| `ai-usage.ts` | `areaFor(mode, flow)` + `recordAiUsage()` → `ai_usage` (counts only, inside `after()`) |
| `prompt-cache.ts` | Anthropic prompt-cache blocks for `companion`/`library` (`systemForMode`, `messagesForMode`) |
| `static-content.ts` | `readStaticFile()` — production-only in-memory memoisation of committed `content/` files |
| `client-error-report.ts` | Browser-side POST of a caught render error to `/api/errors/client` |
| `extract-text.ts` | Client-side document/image text extraction for uploads |
| `adoptions-cache.ts` | 60-second in-memory TTL cache for the adoptions list |
| `strip-frontmatter.ts` | YAML frontmatter strip/parse for pathway documents |
| `adoption-plan-markdown.ts` / `adoption-plan-pdf.ts` | Shared markdown parser + PDF export for generated documents |

## Domain logic highlights

- **Role re-validation is duplicated by design, not by accident.** `app/api/chat/route.ts` checks `flow === 'contributor'` against `hasRole(..., 'pathway_contributor')` and `flow === 'explorer'` against `hasRole(..., 'adopter')` independently of whatever the client UI already prevented — this is the one server-side re-enforcement point for the whole companion conversation.
- **Idempotent role grant.** `app/api/auth/grant-default-role/route.ts` treats a Postgres unique-violation (`23505`) on the `adopter` insert as success, making a retried call safe.
- **Best-effort duplicate detection.** `app/api/pathways/check-similar/route.ts` wraps its Anthropic call in try/catch and answers any failure with `{matchId: null}` — a real pathway can still be created even if this check errors. The failure is now recorded (`logError` + an `ok:false` `ai_usage` row) rather than only `console.error`ed.
- **Destructive admin actions are direct, not soft-deleted.** `app/api/admin/reject/route.ts` calls `admin.auth.admin.deleteUser(user_id)` outright; `app/api/admin/pathways/delete/route.ts` deletes a `pathways` row and relies on FK cascade/set-null behavior rather than an app-level cleanup step.

## Error handling posture

Still **no retry logic** anywhere for the Anthropic API or Supabase calls (TD-05). What does exist since the monitoring/cleanup work:

- **One error path for all routes.** `withErrorHandling(source, handler, {errorBody?})` in `lib/errors.ts` wraps all 24 `route.ts` files: returned 4xx → passed through, recorded `expected` (429s not recorded); returned 5xx → recorded `unexpected` with its real text, body replaced with `GENERIC_ERROR_MESSAGE`; thrown `ExpectedError` → its own status/message; anything else thrown → 500 + generic, stack recorded. Many routes still build `Response.json({error: error.message}, {status: 500})` inline on purpose — the wrapper hides that text from the browser while `sys_errors` keeps it.
- **Recording is non-blocking and safe.** `logError()` schedules the `sys_errors` insert with `after()` (fire-and-forget outside a request scope), never throws, still `console.error`s for platform logs, scrubs secrets (`sk-ant-…`, `Bearer …`, JWTs, `password|token|secret|api_key=…`), and keeps only allow-listed context keys. The session `user_id` is resolved only on the error path.
- **Mid-stream failures.** Both stream loops in `app/api/chat/route.ts` are in try/catch; `streamFailed()` records the error and an `ok:false` usage row, then errors the stream so the client shows partial text + the generic message and skips persistence (the main path also skips the `adoption_queries` insert).
- **Server render / action / proxy errors** are recorded by `instrumentation.ts`'s `onRequestError` (via `recordServerError`, with the original stack); route-handler errors are left to the wrapper.
- Fire-and-forget writes (`adoption_queries` insert) still only `console.error` on failure. Google Sheets logging (`lib/logger.ts`) was removed.

See [`../operations/monitoring.md`](../operations/monitoring.md) and [`../knowledge/technical-debt.md`](../knowledge/technical-debt.md).

## Source files

Full route/lib reference: [`api-specification.md`](api-specification.md), [`../repository-map.md`](../repository-map.md).
