# Spec: System Error Handling, Usage Monitoring and Technical Cleanup

Status: **Code complete (21/21). Done: MLC-01, 02, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21. Code done, browser checks open: MLC-03, 04. Migrations 0035–0038 applied to dev. Next: owner browser checks, live deploy steps, commit/PR.** · Updated: 2026-10-22 (audit High findings H1–H4 fixed, see §4) · Owner: Anurag Goutam · Branch: `monitoring-logging-cleanup`

Planning artifacts are in [`docs/features/monitoring-logging-cleanup/`](../docs/features/monitoring-logging-cleanup/):
- [requirement](../docs/features/monitoring-logging-cleanup/requirement_monitoring_logging_cleanup.md)
- business and architecture clarifications
- [approved plan](../docs/features/monitoring-logging-cleanup/plan_monitoring_logging_cleanup.md)
- [task list](../docs/features/monitoring-logging-cleanup/task_list_monitoring_logging_cleanup.md), with stories MLC-01 to MLC-21, their acceptance criteria and test plans

This spec records **what has actually been done**. The progress log (§4) is updated after every task.

## 1. Constraints while building

- ~~**No safe dev Supabase project yet.**~~ *Resolved 2026-10-20: the owner confirmed `pcpdgu…` is dev. Additive migrations are applied there; `ixcooe…` (live) is never touched.* `.env.local` points at `pcpdgu…`, which the Supabase dashboard labels PRODUCTION; the live site uses `ixcooe…`. Until a dev project is confirmed:
  - migration files are written but **not applied**
  - nothing is written to any database
  - local checks are read-only
- **Anthropic account expires 28-Oct-2026.** Stories that need a real AI call to verify are marked 💲 in the task list.
- **Production deploys go through the upstream repo** (`kameshbhr/diffusion-cube`). Migrations and Vercel env vars on live are applied by the Solution Team.

## 2. Story status

| Story | Title | Status |
|---|---|---|
| MLC-01 | `sys_errors` + `lib/errors.ts` | **Done**; 0035 applied to dev; RLS, rows, scrubbing verified live |
| MLC-02 | Wrap all API routes | **Done**; expected rows verified live (forced-failure 💲 check open) |
| MLC-03 | Error pages + `/api/errors/client` | **Code done**; client-report row verified live (browser crash checks open) |
| MLC-04 | Mid-stream failures | **Code done** (💲 browser checks open) |
| MLC-05 | `x-user-email` reset | **Done (code + local smoke test)** |
| MLC-06 | Explore input checks | **Done**; negative/boundary cases + live rejection rows verified (positive 💲 chat check is the owner's) |
| MLC-07 | Per-IP rate limit | **Done**; 0037 applied to dev; 400→429 and no 429 rows verified live |
| MLC-08 | `ai_usage` capture | **Done**; 0036 applied to dev; 1 live row verified (per-area 💲 checks open) |
| MLC-09 | Remove Google Sheets logging | **Done** (env vars to remove per environment) |
| MLC-10 | `/admin/usage` | **Done**; 0038 applied to dev; figures cross-checked; renders for admin |
| MLC-11 | `/admin/errors` | **Done**; renders for admin with live rows |
| MLC-12 | Dropped-table code | **Done** (signed-in 404 check open) |
| MLC-13 | Unused chat modes | **Done**; removed modes return 400 live |
| MLC-14 | `<deliverable>` handling | **Done** (💲 Analyse browser check open; check live DB for old tags before deploy) |
| MLC-15 | AdoptionPlanModal modal mode | **Done** (browser check open) |
| MLC-16 | Library reads grounding corpus + DB | **Done** (owner decisions Q30–Q33; live kickoffs verified) |
| MLC-17 | `parseFrontmatter` + `diff` | **Done** (DB publish check waits for dev project) |
| MLC-18 | Per-mode loading + memoisation | **Done** (library loader waits for MLC-16) |
| MLC-19 | Prompt caching | **Done** (companion + library); cache write→read verified live; one-shot modes pending owner decision |
| MLC-20 | Delete `content/library-wiki/` | **Done** |
| MLC-21 | Wiki refresh | **Done** (targeted page updates; full `llm-wiki` regeneration pending owner decision) |

## 3. Files changed

| File | Story | Change |
|---|---|---|
| `proxy.ts` | MLC-05 | New `forwardedHeaders()` helper. Every `NextResponse.next()` (initial, Supabase `setAll` refresh, signed-in) forwards a copy of the request headers with `x-user-email` deleted; only the signed-in branch sets it, from the verified `user.email`. |
| `lib/explore-guard.ts` (new) | MLC-06 | `isValidExploreConversation()` and the three limit constants |
| `app/api/chat/route.ts` | MLC-06 | Guard runs right after the mode check for `library`, before `createClient()`, any DB read or Claude; failure → 400 `{"error":"Invalid request."}` |
| `app/explore/ExploreLibrary.tsx` | MLC-06 | `res.ok` check; plain `notice` bubble for 400/429/other 4xx/5xx; a rejected message goes back into the input box; notices are filtered out of the history sent and saved |
| `app/api/admin/pathway-submissions/{review,publish}/route.ts`, `app/api/pathway-submissions/push/route.ts`, `lib/pathway-submission-versions.ts`, `components/PathwaySubmissionsPanel.tsx` | MLC-12 | Deleted |
| `lib/system-prompts.ts`, `lib/wiki-content.ts`, `lib/grid-update.ts` | MLC-12 | Stale comments about the retired submissions flow corrected |
| `components/AdoptionPlanModal.tsx` | MLC-15 | Modal branch, `mode` prop, version props and their renderers removed; panel only |
| `components/AdoptionWorkspace.tsx` | MLC-15 | No longer passes `mode="panel"` |
| `app/api/admin/pathways/publish/route.ts` | MLC-17 | Uses the shared `parseFrontmatter` from `lib/strip-frontmatter.ts` |
| `package.json`, `package-lock.json` | MLC-17 | `diff` and `@types/diff` removed (lockfile edited surgically) |
| `supabase/migrations/0035_sys_errors.sql` (new, applied to dev 2026-10-20) | MLC-01 | `sys_errors` table, indexes, RLS with no policies, `purge_old_sys_errors()` (service role only) |
| `lib/error-messages.ts` (new) | MLC-01 | `GENERIC_ERROR_MESSAGE` (client-safe) |
| `lib/errors.ts` (new) | MLC-01 | Expected-error classes, `scrub`, `cleanContext`, `currentEnvironment`, `logError` |
| `lib/errors.ts` | MLC-02 | `withErrorHandling()`; `logError` refactored onto shared `recordError`/`schedule` |
| all 23 `app/api/**/route.ts` | MLC-02 | Handlers renamed `handle<METHOD>` and exported through `withErrorHandling`; `send-email` uses `errorBody: hookError`; 4 stack-losing catch blocks now throw |
| `supabase/migrations/0037_rate_limits.sql` (new, applied to dev 2026-10-20) | MLC-07 | `rate_limits` table + `check_rate_limit()` (service role only) |
| `lib/rate-limit.ts` (new) | MLC-07 | `clientIp`, salted key, env limits, fail-open `checkRateLimit()` |
| `app/api/chat/route.ts` | MLC-07, MLC-03 | 429 for `library` over the limit — moved **before** the input guard in MLC-03 |
| `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`, `components/ErrorScreen.tsx` (new) | MLC-03 | Cube error / not-found pages |
| `lib/client-error-report.ts` (new) | MLC-03 | Browser-side error report (skips digests) |
| `app/api/errors/client/route.ts` (new) | MLC-03 | Public, rate-limited, size-capped browser error intake |
| `instrumentation.ts` (new) | MLC-03 | `onRequestError` → `recordServerError` for render/action/proxy errors |
| `lib/errors.ts` | MLC-03 | `recordServerError()`, exported `sessionUserId()`, 429s not recorded |
| `proxy.ts` | MLC-03 | `/api/errors/client` added to `PUBLIC_PATHS` |
| `app/api/chat/route.ts` | MLC-04 | `streamFailed()`; try/catch around both stream loops |
| `components/ChatPanel.tsx` | MLC-04 | `Message.notice` |
| `lib/adoption-conversation.ts` | MLC-04 | `chatErrorText`, `ChatRequestError`; `runTurn` failure handling; `res.ok` checks on draft/doc/insights; notices filtered from `toApiMessages`/`persist` |
| `app/explore/ExploreLibrary.tsx` | MLC-04 | Partial reply + generic notice on failure |
| `supabase/migrations/0036_ai_usage.sql` (new, applied to dev) | MLC-08 | `ai_usage` table |
| `lib/ai-usage.ts` (new) | MLC-08 | `areaFor`, `recordAiUsage` |
| `app/api/chat/route.ts` | MLC-08, MLC-09 | Usage on `asset-reuse` + both streams (`recordStreamUsage`, `ok:false` in `streamFailed`); `logConversation` removed |
| `app/api/pathways/check-similar/route.ts` | MLC-08 | Usage recorded; swallowed failure now logged |
| `lib/adoption-conversation.ts` | MLC-08 | `extract-insights` sends `flow` |
| `lib/logger.ts` | MLC-09 | Deleted |
| `package.json`, `package-lock.json` | MLC-09 | `googleapis` (+58 transitive) removed; `libc` fields kept |
| `supabase/migrations/0038_admin_usage_stats.sql` (new, applied to dev) | MLC-10 | `admin_usage_stats()` (service role only) |
| `app/admin/usage/page.tsx` (new) | MLC-10 | Usage page |
| `app/admin/errors/page.tsx` (new) | MLC-11 | Recent-errors list |
| `app/admin/page.tsx` | MLC-10/11 | Links to Usage and Recent errors |
| `app/api/chat/route.ts`, `lib/system-prompts.ts` | MLC-13 | Two unused modes + their prompt builders removed |
| `lib/grid-update.ts`, `components/ChatPanel.tsx`, `lib/adoption-conversation.ts`, `app/api/chat/route.ts` | MLC-14 | `<deliverable>` handling removed |
| `lib/static-content.ts` (new) | MLC-18 | Production-only memoised reads of `content/` files |
| `lib/wiki-loader.ts`, `lib/wiki-content.ts` | MLC-18 | Read through `readStaticFile` |
| `app/api/chat/route.ts` | MLC-18 | Per-mode loading of corpus/resources |
| `lib/system-prompts.ts` | MLC-19 | `PROMPT_CACHE_BREAK` sentinel at the existing stable/per-turn boundary in 6 builders (text unchanged) |
| `lib/prompt-cache.ts` (new) | MLC-19 | `systemForMode`, `messagesForMode`, cached modes = companion + library |
| `app/api/chat/route.ts` | MLC-19 | Both streams send cached system blocks + message breakpoint |
| `app/admin/usage/page.tsx` | MLC-19 | Input tokens shown as total (uncached + cache read + cache write) |

## 4. Progress log

### 2026-10-19: MLC-05 `x-user-email` reset

- **What was done:**
  - `proxy.ts` now deletes any incoming `x-user-email` on every request.
  - The header is set again only from the session `getUser()` verified.
  - The cleaned headers are rebuilt from `request.headers` each time, so cookies refreshed by Supabase's `setAll()` still reach server components.
  - Redirect and 401 branches forward no request headers, so they needed no change.
- **Finding:** the five pages that read the header (`(app)/layout.tsx`, `/analyse`, `/contribute`, `/account`, `/explore`) all call `getUser()` first and return early for a signed-out visitor. For a signed-in user, the proxy already overwrote the header. So there was no exploitable path today; this is defence in depth, as the customer asked. The planning docs' wording ("the library page uses it for its admin check") overstated the risk.
- **Verified (manually, against the running dev server, read-only):**
  - `npx tsc --noEmit` and `npx eslint proxy.ts` are clean.
  - Signed out with `x-user-email: admin@example.com`:
    - `/explore` → 200 with no `/admin` link
    - `/account` → 307 to `/login?next=/account`
    - `/api/organisations` → 401 `{"error":"Unauthorized"}`
- **Open:** the signed-in check (an admin's `/explore` and `/admin` look the same as before; a signed-in admin sending a forged header still sees their own email) needs a browser session. Owner to verify.

### 2026-10-19: MLC-06 Explore input checks

- **What was done:**
  - New `lib/explore-guard.ts`.
  - `/api/chat` rejects a `library` request with 400 "Invalid request." before any DB read or Claude call when:
    - `messages` isn't an array
    - a role isn't `user`/`assistant`
    - any content isn't a string
    - there are more than 20 messages
    - a visitor message exceeds 1,000 characters
    - the total exceeds 20,000 characters
    - the last message isn't the visitor's
  - `ExploreLibrary.tsx` no longer renders a JSON error as Cube's reply. It shows a plain notice and gives the rejected text back to the input box.
- **Decisions made while building** (recorded in the requirement, the task list and the architecture plan-review decisions):
  - **No "first message must be the user" rule.** The library sends an empty history for its kickoff and then starts every conversation with Cube's overview, so that rule would have rejected every follow-up.
  - **The 1,000-character cap is for the visitor's messages only.** Cube's replies, resent as history, are often longer; they still count towards the 20,000 total.
  - **"20 turns" = 20 messages.**
- **Bug avoided:** without the give-back, a rejected long message would stay in the history and get resent, so the visitor would be stuck being rejected on every send.
- **Verified (manually, read-only against the dev server; no Claude calls):**
  - `npx tsc --noEmit` is clean. `eslint` has 0 errors; 3 warnings at `ExploreLibrary.tsx` L132–146 were already there (`toggleStage`, not touched).
  - A script of 11 cases POSTed to `/api/chat` with `pathwayId: 'not-a-real-pathway-xyz'`, so a request that passes the guard stops at the pathway lookup and never reaches Claude:
    - **400** "Invalid request.": 21 messages; a 1,001-char user message; 19,001 + 1,000 total; role `system`; array content; ending with `assistant`; `messages: "hi"`; a `null` item
    - **404** "Unknown pathway." (guard passed): 20 messages at 1,000 chars = 20,000 total; a 3,000-char assistant message then a user message; an empty kickoff
- **Open:**
  - Rejections are logged as expected errors once MLC-02's wrapper is in.
  - 💲 Owner check in the browser:
    - a normal pathway chat
    - the general library chat
    - pasting a 1,500-char message (the notice shows, the text returns to the input box, and the next valid send works)

### 2026-10-19: MLC-12 Dropped-table code removed (TD-01)

- **What was done:**
  - Deleted the five files that queried the tables dropped in migration 0018:
    - `app/api/admin/pathway-submissions/review/route.ts`
    - `app/api/admin/pathway-submissions/publish/route.ts`
    - `app/api/pathway-submissions/push/route.ts`
    - `lib/pathway-submission-versions.ts`
    - `components/PathwaySubmissionsPanel.tsx`
  - Nothing imported any of them.
  - Fixed comments that still described the retired flow as live:
    - `lib/system-prompts.ts` (above `pathwayDraftSystemPrompt`): now points to the real two-step assemble → admin publish flow
    - `lib/wiki-content.ts` (the sector carry-over now happens in `app/api/admin/pathways/publish`)
    - `lib/grid-update.ts` (the pathway card reads `design_documents`, not `pathway_submission_versions`)
  - Kept the two comments in `lib/adoption-conversation.ts` (L53, L702), which correctly say the table was retired.
  - The comment at `lib/system-prompts.ts` ~L881 goes with `pathwaySubmissionExecutiveSummarySystemPrompt` in MLC-13.
- **Verified:**
  - `npx tsc --noEmit` is clean.
  - `grep` finds no code reference, only the historical comments above.
  - Signed out, POST to the three removed paths returns 401: the proxy blocks non-public `/api` paths before routing.
- **Open:** signed in, the three paths should now return 404 (owner browser check). No migration is needed; the tables are already gone.

### 2026-10-19: MLC-15 `AdoptionPlanModal` modal mode removed

- **What was done:**
  - Removed from `components/AdoptionPlanModal.tsx`:
    - the `mode` prop and the default `'modal'` overlay branch
    - everything only that branch used: the `ContentBlocks`/`InlineText` renderers, the `parsePlanMarkdown`/`parseStatusBullet`/`splitInlineBold` import, and the `version`/`versions`/`selectedVersionNumber`/`onSelectVersion` props, which no caller passed
  - The panel layout is now the only render path, unchanged.
  - `VersionOption` is still exported (`PathwayDocumentPane.tsx` imports it).
  - `AdoptionWorkspace.tsx` no longer passes `mode="panel"`.
  - `lib/adoption-plan-markdown.ts` stays; the PDF exporter still uses it.
  - The file went from 253 to about 80 lines.
- **Verified:**
  - `npx tsc --noEmit` is clean. `AdoptionPlanModal.tsx` lints clean.
  - `AdoptionWorkspace.tsx`'s 2 errors (`react-hooks/set-state-in-effect` at L205/L211) and 1 warning are **already on HEAD**: I linted the HEAD copy and got the same three. They are not part of this work.
- **Open:** the owner checks that the Analysis Document / Executive Summary side panel in `/analyse` looks and works the same, including Download PDF.

### 2026-10-19: MLC-17 Duplicate `parseFrontmatter` and unused `diff` removed (TD-10)

- **What was done:**
  - `app/api/admin/pathways/publish/route.ts`: deleted its private `parseFrontmatter` and imported the shared one from `lib/strip-frontmatter.ts`.
    - Field reads now use the typed `PathwayFrontmatter`, with `?? {}` for "no frontmatter". That is the same as the old `{}` return.
  - `diff` (dependency) and `@types/diff` (devDependency) removed from `package.json`. Nothing imports either.
  - **`package-lock.json` edited surgically**: only the 2 package entries and their 2 root references were removed (18 lines).
    - `npm uninstall` with local npm 10.9.8 also stripped the `"libc"` fields from 43 platform-specific optional packages. That is lockfile-format noise that could change which native binaries a deploy picks, so it was reverted.
- **Verified:**
  - Ran the old parser and the shared parser on all 26 pathway files in `content/wiki/pathways/` and `content/library-wiki/pathways/`, mapping through the route's field logic. All 26 published fields are **identical**.
  - Synthetic edge cases where the shared parser is better (the old one silently fell back to the `pathways` row / empty values):
    - CRLF line endings
    - a trailing space after `---`
    - a bare `tags: Solo` (now `["Solo"]`)
  - `npx tsc --noEmit` and `eslint` on the route are clean. `npm ls diff` reports it isn't installed.
- **Open:** the owner checks on a dev project that publishing a pathway before and after gives the same `published_pathways` row (task list MLC-17 test plan). This needs a DB write, so it waits for the dev project.

### 2026-10-19: MLC-01 `sys_errors` table and shared error library (code only)

- **What was done:**
  - **`supabase/migrations/0035_sys_errors.sql`** (written, **not applied**):
    - `sys_errors` table, with the customer's columns and `user_id … on delete set null`
    - two indexes
    - RLS on with no policies
    - `purge_old_sys_errors(days default 30)`, with execute revoked from `public`/`anon`/`authenticated` and granted to `service_role` (Postgres functions are PUBLIC-executable by default)
  - **`lib/error-messages.ts`**: `GENERIC_ERROR_MESSAGE`, word for word. It has no server imports, so client components can use it; `ExploreLibrary.tsx` now does.
  - **`lib/errors.ts`** (server-only):
    - `ExpectedError`, `ValidationError` (400), `AuthError` (401/403), `NotFoundError` (404)
    - `scrub()`: masks `sk-ant-…`, `Bearer …`, JWTs and `password|token|secret|api_key=…`
    - `cleanContext()`: allow-listed keys only; values capped at 200 characters and scrubbed
    - `currentEnvironment()`: `APP_ENV`, else `VERCEL_ENV === 'production'` → prod, else dev
    - `logError()`:
      - message capped at 2,000 and stack at 8,000 characters
      - `kind` defaults to unexpected
      - the insert is scheduled with `after()`, with a fire-and-forget fallback outside a request scope
      - purge at most once per instance per hour
      - never throws
      - still `console.error`s, so platform logs keep the line
- **Verified (no database):**
  - `npx tsc --noEmit` is clean; eslint has 0 errors.
  - `lib/errors.ts` was transpiled with `next/server`/admin-client stubs that capture inserts and RPC calls. 20/20 checks passed:
    - each secret pattern is masked
    - the context allow-list drops `messages`/`password`/`email`/empty values
    - environment selection
    - the 2,000/8,000 caps
    - the default kind
    - the purge called with 30 days, then throttled
    - writes go through `after()`, with the fallback outside a request scope
    - an insert that throws doesn't reach the caller
    - the error classes' statuses
- **Open:** the migration has never run on a database (only the `psql` client is installed locally, no Postgres server; no dev project). Apply it on the dev project first and run the MLC-01 test plan there: RLS denies anon/authenticated, the purge deletes a 31-day-old row, and execute is denied to anon.

### 2026-10-19: MLC-02 Every API route goes through `withErrorHandling`

- **What was done:**
  - **`lib/errors.ts`** gained `withErrorHandling(source, handler, { errorBody? })`:
    - a returned **4xx** passes through untouched and is recorded as expected, with the body's `error` text
    - a returned **5xx** is recorded as unexpected with its real text, and its body is replaced with `GENERIC_ERROR_MESSAGE`
    - a thrown `ExpectedError` becomes its own status + message
    - anything else thrown is recorded with its stack and answered with 500 + the generic message
    - streamed 200 responses are returned untouched (same object)
    - `user_id` is resolved from the session **inside `after()`, only on the error path**, so normal requests pay nothing
    - `path`/`method` come from the request
  - `logError()` was refactored onto the same `recordError`/`schedule` helpers.
  - **All 23 routes / 27 handlers wrapped** (3 fewer than planned, since MLC-12 deleted 3 routes). The change is mechanical: `export async function POST(` → `async function handlePOST(`, plus `export const POST = withErrorHandling('api/<path>', handlePOST)` at the end of the file, keeping each file's semicolon style.
  - **`api/auth/send-email`** passes `errorBody: hookError`, so Supabase Auth still gets its `{ error: { http_code, message } }` shape.
  - **Stack-losing catch blocks now throw to the wrapper:**
    - `pathways/[id]/join` (was `String(err)` to the browser)
    - `pathways/assemble` (was `detail: String(err)`; the pointless try/catch was removed)
    - `toolkit-assets/upload-url`
    - `auth/send-email`
- **Deviation from the plan (recorded):** the ~30 inline `Response.json({ error: … }, { status: 500 })` returns were **kept in the route code** rather than rewritten. The wrapper replaces every 5xx body, so nothing raw reaches the browser, and keeping them means the `sys_errors` record carries the real database text (e.g. `error.message` from `admin/roles`). The 11 raw leaks are closed by the wrapper.
  - Limitation: routes that `console.error` the real error and return a hand-written 500 (e.g. `admin/pathways/publish` "Failed to publish pathway.") record only that hand-written text; the detail stays in the platform log. These can be switched to `throw` one by one later.
- **Verified (no database):**
  - `npx tsc --noEmit` is clean; eslint has 0 errors on `app/api` + `lib/errors.ts`. The 1 warning (`pathways/route.ts` unused `req`) is already on HEAD.
  - The wrapper was transpiled with stubs: 17/17 checks passed:
    - 200 passthrough, with nothing recorded
    - a 404 body untouched and recorded as expected with no stack
    - path/method/user_id/source recorded
    - a returned 500 body replaced while the raw text stays in the record
    - a thrown `ValidationError` → 400 with its own message
    - a thrown `Error` → 500 generic, with the stack recorded and the key scrubbed
    - a PostgREST-style object
    - the hook format for both 500 and 401
    - the stream not buffered
    - a no-arg `GET()`
    - a non-JSON 4xx
    - a session lookup failure → null user
    - a record failure that never affects the response
  - MLC-01's 20 checks re-ran green after the refactor.
  - Dev server: `/api/wiki-pathways` → 200 as before.
- **Heads-up:** the owner's running dev server now tries to insert into `sys_errors` on whatever project `.env.local` points at (`pcpdgu…`), on every error. Until 0035 is applied there, those inserts fail (a `console.error` line only) and no data changes. **Don't apply 0035 to `pcpdgu…` unless you want errors recorded there.**
- **Open:** live HTTP checks of the task-list test plan (forced Anthropic/Supabase failures, rows appearing in `sys_errors`) wait for the dev project.

### 2026-10-19: MLC-07 Per-IP rate limit for Explore (code; migration not applied to any Supabase project)

- **What was done:**
  - **`supabase/migrations/0037_rate_limits.sql`**:
    - `rate_limits(key, bucket 'minute'|'day', window_start, count)`, RLS on with no policies
    - `check_rate_limit(p_key, p_per_min, p_per_day)`: two atomic upserts (fixed minute and day windows; a window that has passed resets to 1), a 1% chance cleanup of keys idle for over 2 days, and it returns whether both limits hold. A rejected request still counts.
    - Execute is revoked from `public`/`anon`/`authenticated` and granted to `service_role`.
    - Numbered 0037 per the plan; 0036 (`ai_usage`) comes with MLC-08 and must be in place before anything is applied.
  - **`lib/rate-limit.ts`**:
    - `clientIp()`: the first `x-forwarded-for` hop, else `x-real-ip`, else `unknown`
    - the key is a salted SHA-256 of `RATE_LIMIT_SALT:scope:ip` (no raw IP stored); scopes `explore` and `client-error` are counted separately
    - limits come from `EXPLORE_RATE_LIMIT_PER_MIN`/`_PER_DAY` (defaults 20/200; an invalid value falls back)
    - `checkRateLimit()` **fails open**: an RPC error or throw allows the request and is logged as unexpected
  - **`app/api/chat/route.ts`**: for `library`, *(superseded in MLC-03: the limit now runs **before** the input guard)* a request over the limit gets 429 `{"error":"Too many requests. Please try again later."}`. `ExploreLibrary.tsx` already shows that as a plain notice (MLC-06).
- **Deviation from the plan:** `check_rate_limit` is a normal (invoker) function, not `security definer`. Only `service_role` may execute it, and that role bypasses RLS anyway, so definer rights weren't needed.
- **Verified:**
  - **Migrations 0035 and 0037 applied to a throwaway local Postgres 16** (an `initdb` cluster in the session scratchpad on 127.0.0.1:54329, with stub `auth.users`, the Supabase-style `anon`/`authenticated`/`service_role bypassrls` roles and default table grants). Results:
    - **0035 (`sys_errors`):**
      - anon/authenticated `select` → 0 rows; anon `insert` → RLS violation; `environment='staging'` → check violation
      - anon/authenticated `purge_old_sys_errors` → permission denied
      - service_role purge(30) deleted only the 31-day row (the 29-day and fresh rows stayed)
      - deleting the auth user set `sys_errors.user_id` to NULL
    - **0037 (`rate_limits`):**
      - per_min 3 → t, t, t, **f**; after the minute window passes → t (minute count reset to 1, day count kept at 5)
      - per_day 5 → the 6th call is **f**
      - anon RPC → permission denied; anon `select rate_limits` → 0
      - **concurrency:** 20 parallel calls on a fresh key with limit 10 → exactly 10 allowed, 10 denied, stored count 20 (no lost increments)
  - `lib/rate-limit.ts` transpiled with stubs: 12/12 checks passed (IP parsing, default/env/invalid limits, 64-hex key with no raw IP, separate scope keys, salt changes the key, fail-open + log on an RPC error and on a throw, allow/block).
  - `npx tsc --noEmit` is clean; eslint has 0 errors.
- **Heads-up:** on the owner's dev server (`pcpdgu…`, where 0037 isn't applied), every Explore message now makes one failing RPC call. The limiter fails open, so Explore keeps working, and the failure is logged.
- **Open:**
  - New env vars to set per environment: `RATE_LIMIT_SALT` (required for salted hashes), and optionally `EXPLORE_RATE_LIMIT_PER_MIN`/`_PER_DAY`.
  - Measure the added Explore latency once a dev project exists.

### 2026-10-19: MLC-03 Error pages, browser error reporting, server render errors

- **What was done:**
  - **`app/error.tsx`** (`ErrorPage`) and **`app/global-error.tsx`** (its own `<html>`/`<body>` + `globals.css`): show `GENERIC_ERROR_MESSAGE` and "Back to home" through the new `components/ErrorScreen.tsx`, and never the error's own text.
  - **`app/not-found.tsx`**: Cube's own "Page not found" page.
  - **`lib/client-error-report.ts`**: the boundaries POST `{message, stack, path}` to `/api/errors/client` (keepalive, best-effort), **only for browser-side errors** (no `digest`).
  - **`app/api/errors/client/route.ts`** (public; added to `proxy.ts` `PUBLIC_PATHS`): **rate limit first** (`client-error` scope) → 429; then body > 16 KB or bad JSON → 400; then a `sys_errors` row `source = client:<path>` (query stripped; a non-path value → `/`), kind unexpected, with the session user → 204.
  - **`instrumentation.ts`** (new) `onRequestError`: records Server Component render, Server Action and proxy errors with the **original stack** (`source = render:<routePath>` etc.), using the new `recordServerError()` (awaited, never throws). It skips `route` (the wrapper has those) and `NEXT_*` control-flow digests.
  - **Flood protection** (a decision made while building):
    - in `/api/chat` `library` mode the rate limit now runs **before** the input guard
    - `withErrorHandling` no longer records 429s
    - the requirement chart/table, task list ACs and architecture decisions are updated to match
- **Why the order changed:** with "record all errors", an anonymous script sending malformed Explore requests would have skipped the limiter (the guard came first) and added a `sys_errors` row per request. Now one address is capped at 20/min, and 429s add no rows.
- **Verified:**
  - `npx tsc --noEmit` and eslint are clean on all new/changed files.
  - Dev server: `/explore/this-does-not-exist-xyz` → 404 with title "Page not found · Diffusion Cube", the message and "Back to home". `OPTIONS /api/errors/client` → 204, so the path is public (no proxy 401). A signed-out `/this-does-not-exist` → 307 to login, which is existing proxy behaviour for non-public paths.
  - `/api/errors/client` transpiled with stubs: 8/8 (429 first with nothing logged; >16 KB → 400; bad JSON → 400; a valid report → 204 with `client:/analyse`, query stripped, kind, user, and the browser message + stack kept; `javascript:` path → `client:/`; non-string message → "(no message)").
  - The wrapper's 17 checks re-ran green, plus 2 new: a 429 passes through unrecorded, and `recordServerError` writes directly with the stack + session user.
- **Open (owner, browser):**
  - Temporarily throw in a client component → Cube error page + a `client:` row.
  - Throw in a server component → error page + a `render:` row with the real stack. **`instrumentation.ts` only loads when the dev server starts — restart `npm run dev` first.**
  - Rows appear only once 0035 is applied.

### 2026-10-19: MLC-04 Replies that break off partway

- **What was done:**
  - **Server (`app/api/chat/route.ts`):** both stream loops (`library` and the main path) are in try/catch. A failure calls the new `streamFailed()`, which `logError`s with `mode`/`flow`/`design_id`/`pathway_slug`, the session user and kind unexpected, then calls `controller.error()` so the client's reader rejects. On failure the main path returns before `logConversation`/`adoption_queries`.
  - **`Message.notice`** (`components/ChatPanel.tsx`): a client-made status bubble. `toApiMessages()` drops notices from the history sent to Claude, and `persist()` drops them from `designs.messages`.
  - **Companion turns (`runTurn` in `lib/adoption-conversation.ts`):**
    - a failed `fetch` → generic notice
    - a non-ok response → `chatErrorText()`: a 4xx's own message (e.g. a missing role), else generic
    - the reader rejecting mid-reply → the partial text (grid_update stripped) + `\n\n` + generic, as a notice that replaces the streaming bubble
    - each of these sets `loading` to false and returns before grid writes, `persist`, resource routing and pathway/explorer actions
    - before this, a broken stream left `loading` stuck on with the partial reply on screen, and an error JSON was rendered as Cube's reply
  - **Pre-existing bugs fixed on the way:**
    - **`pathway-draft`** and **`analysis-doc`/`executive-summary`** never checked `res.ok`, so an error response body (a 403, or now the generic-message 500) **would have been saved as a draft / document version**. They now throw `ChatRequestError` with the 4xx message or the generic one. Their hand-written fallbacks ("Could not draft this pathway page…", "Could not generate that document…") became the generic message, per the plan-review decision.
    - `extract-insights` stays silent but now also checks `res.ok`.
  - **Explore (`ExploreLibrary.tsx`):** a network failure or a reply breaking off now keeps the text that arrived, adds the generic message under it as a `notice` (not saved, not resent), instead of replacing everything with "Sorry, I couldn't reach the assistant…".
- **Verified:**
  - `npx tsc --noEmit` is clean; eslint has 0 errors. The 5 warnings (3 in `ExploreLibrary`, 2 `react-hooks/exhaustive-deps` in `adoption-conversation`) are the same rules already on HEAD; I linted the HEAD copies and only the line numbers moved.
- **Not verified yet (owner, 💲):**
  - DevTools → Network "Offline" while a reply streams on `/analyse`, `/contribute` and `/explore`: the partial text + the generic message show, and a reload shows the partial reply wasn't saved.
  - Restart dev with `ANTHROPIC_API_KEY=invalid`: the generic message shows and an `api/chat` row appears once 0035 is applied.
  - Draft / Analysis Document generation as a user without the role shows the 403 message and creates no version.
- **Task list note:** MLC-02's invalid-key test now says the response starts as a 200 and is errored mid-stream, because the SDK fails only when the stream is read.

### 2026-10-20: Dev Supabase confirmed; migrations 0035–0037 applied; R1 verified live

- The owner confirmed that `.env.local`'s project (`pcpdgu…`) is **dev only**, despite its dashboard label. Before applying, both the URL and the DB user were checked to start `pcpdgu`.
- `pg_cron` is **not** enabled there, which confirms the opportunistic-purge design.
- **Applied, in order, each in a single transaction:** `0035_sys_errors`, `0036_ai_usage`, `0037_rate_limits`.
- **Live checks** (anon key through Supabase REST, and the app on a dev server at `localhost:3123`):
  - **Anon key:**
    - `select` on `sys_errors`/`ai_usage`/`rate_limits` → `[]`
    - insert into `sys_errors` → `42501` RLS violation
    - `rpc/check_rate_limit` and `rpc/purge_old_sys_errors` → `42501` permission denied
  - **`sys_errors` rows:**
    - an invalid Explore request → 400 "Invalid request." and a row `api/chat | expected | 400 | /api/chat | env dev | no stack`
    - `POST /api/errors/client` → 204 and a row `client:/explore | unexpected`, with the stack kept, the query string stripped, and **`password=hunter2` stored as `password=[redacted]`**
  - **`rate_limits`:** two 64-hex keys (the `explore` and `client-error` scopes) and no raw IP.
  - **Rate limit:** 21 more invalid Explore requests → 19 × 400, then 429, 429. The 429 body is "Too many requests. Please try again later."
    - `sys_errors` has exactly 20 `api/chat` rows and **0 rows with status 429**, so the flood protection works.
    - The minute and day counters both read 23.

### 2026-10-20: MLC-08 `ai_usage` capture

- **What was done:**
  - **`supabase/migrations/0036_ai_usage.sql`** (applied to dev): the table per the plan, `user_id … on delete set null`, an index on `(created_at desc, area)`, RLS with no policies.
  - **`lib/ai-usage.ts`:**
    - `areaFor(mode, flow)` is the single mapping: `library` → explore; `companion`/`extract-insights` by flow; `pathway-draft`/`asset-reuse`/`check-similar` → contribute; everything else → analyse
    - `recordAiUsage()` inserts inside `after()` (fallback fire-and-forget), resolves the session user when no `userId` is given, and never throws
  - **`app/api/chat/route.ts`:**
    - `asset-reuse` records `response.usage` (or `ok:false` and rethrows)
    - both streams call the new `recordStreamUsage()` (`stream.finalMessage().usage`) after closing
    - `streamFailed()` also writes an `ok:false` row
  - **`app/api/pathways/check-similar/route.ts`:** records `result.usage`. Its swallowed failure now also writes `ok:false` and a `logError` (it was `console.error` only). It still answers "no match" so pathway creation isn't blocked.
  - **`lib/adoption-conversation.ts`:** the `extract-insights` call now sends `flow`. Without it, contributor uploads would have counted as Analyse.
- **Verified:**
  - `npx tsc --noEmit` is clean; eslint has 0 errors.
  - **💲 one real call:** an Explore kickoff for `blue-dots` → 200 with a 1,511-char reply, and a row `explore | library | claude-sonnet-4-6 | input 3465 | output 349 | cache 0/0 | ok | user NULL` (signed out).
- **Open (owner, 💲):** one call per area signed in (Analyse companion + document, Contribute companion + draft + duplicate check, an upload in each flow), to confirm area/flow and `user_id`.

### 2026-10-20: MLC-09 Google Sheets logging removed

- **What was done:**
  - `lib/logger.ts` deleted.
  - The `logConversation` import and call removed from `app/api/chat/route.ts`.
  - `googleapis` removed from `package.json`.
  - **`package-lock.json`:** `npm uninstall` removed 58 transitive packages and marked 31 shared ones `"dev": true`, both legitimate. It also stripped `"libc"` from 43 platform packages (local npm 10.9.8 format noise), which **was restored from HEAD**. The net diff is removals plus `dev` flags only.
- **Verified:**
  - `npx tsc --noEmit` is clean.
  - `grep` for `googleapis|logConversation|GOOGLE_SHEET_ID|GOOGLE_SERVICE_ACCOUNT_JSON` across `app lib components proxy.ts instrumentation.ts package.json` → nothing.
  - The Explore call above ran with the Sheets code gone.
- **Open:**
  - Remove `GOOGLE_SERVICE_ACCOUNT_JSON` / `GOOGLE_SHEET_ID` from `.env.local`, Vercel and any Docker env file. Nothing reads them now.
  - Revoking the key is out of scope (architecture Q24).

### 2026-10-20: MLC-10 `/admin/usage` and MLC-11 `/admin/errors`

- **What was done:**
  - **`supabase/migrations/0038_admin_usage_stats.sql`** (applied to dev): `admin_usage_stats()` returns one JSON object:
    - users: total, new in the last 7 days, active in the last 7 and 30 days
    - conversations per area, total and last 7 days
    - `ai_usage` per area: calls, failed, input/output/cache tokens
    - `errors_per_day` (UTC) and `errors_per_source`, split by kind

    It is `security definer` (it reads `auth.users`) with `search_path` set, and execute is revoked from `public`/`anon`/`authenticated` and granted to `service_role`.
  - **`app/admin/usage/page.tsx`:** `isAdmin` gate → redirect. One RPC through the service role, plus the published count from `listWikiPathways()` deduplicated by slug. It shows:
    - user tiles
    - activity tiles and a per-area table
    - an AI usage table (calls, failed, input, output, cached input)
    - errors per day and per source, with a "See the most recent errors" link
    - a "No errors recorded" empty state
  - **`app/admin/errors/page.tsx`:** the latest 50 `sys_errors` rows, newest first. Each shows the time (UTC), source, kind badge, environment, the user's email (resolved via `getUserById` only for the ids on the page), the message, the context IDs, and the stack in a collapsed `<details>`. Everything renders as text.
  - **`app/admin/page.tsx`:** "Usage · Recent errors" links under the heading.
- **Corrections made while building** (recorded in the architecture decisions and the task list):
  - Contribute conversations are contributor `designs`, not `pathways` rows.
  - The pages follow `/admin`'s real standalone layout (no `AppShell`).
- **Verified (dev):**
  - `admin_usage_stats()` output matched direct SQL counts: 9 users; conversations analyse 10 / contribute 19 / explore 17; `ai_usage` explore 1 call / 3,465 in / 349 out; errors 2026-10-20 = 20 expected + 1 unexpected, by source `api/chat` 20 / `client:/explore` 1.
  - Anon `rpc/admin_usage_stats` → `42501` permission denied.
  - Signed out, `/admin/usage` and `/admin/errors` → 307 to login.
  - **Signed in as a temporary dev admin** (created via the Admin API with an `admin` role and a password sign-in; cookies built with `@supabase/ssr`; **deleted afterwards**, with no user or role left), against the running dev server:
    - `/admin/usage` → 200 with every section
    - `/admin/errors` → 200 with the `client:/explore` and `api/chat` rows, `password=[redacted]` and "Stack trace"
    - `/admin` → 200 with both new links
  - `npx tsc --noEmit` and eslint on `app/admin` are clean.
- **Open (owner):**
  - Look at both pages in a browser at phone and laptop width.
  - Check that a signed-in non-admin is redirected.

### 2026-10-20: MLC-13 Unused `plan-document` and `pathway-exec-summary` modes removed

- **What was done:**
  - Both removed from `MODES`, along with their branches in `app/api/chat/route.ts` and their imports.
  - `planDocumentSystemPrompt` and `pathwaySubmissionExecutiveSummarySystemPrompt` deleted from `lib/system-prompts.ts`, with their comment blocks. That includes the stale `PathwaySubmissionsPanel` note left from MLC-12.
  - `versionNumber`, used only by `plan-document`, dropped from the request destructure.
  - The helpers they used (`frameworkBlock`, `standingContext`) stay; other prompts use them.
- **Verified:**
  - `grep` finds no remaining reference.
  - `npx tsc --noEmit` and eslint are clean.
  - Dev server: POST `/api/chat` with either mode → 400 `{"error":"Unknown mode."}` (recorded as expected).

### 2026-10-20: MLC-14 `<deliverable>` handling removed

- **What was done:**
  - `lib/grid-update.ts`: `DELIVERABLE_START`/`END` and their comment removed.
  - `components/ChatPanel.tsx` removed:
    - `extractDeliverable`, `deliverableTitle`, `slugify` and `DeliverableCard`
    - the deliverable branch in `renderMessageContent` and in `isRich`
    - the per-message `generatingDoc` field and its "Generating your document…" bubble
    - the now-unused `downloadPlanAsPdf` import
  - **The component's `generatingDoc` *prop* stays**: it drives "Generating document…" while an Analysis Document / Executive Summary is being made, which is unrelated to `<deliverable>`.
  - `lib/adoption-conversation.ts`: the live-typing freeze logic in `runTurn` became a plain update of the stripped text.
  - `app/api/chat/route.ts`: the `max_tokens` comment was rewritten without the deliverable rationale. `companion` keeps 8192.
- **Verified:**
  - `lib/system-prompts.ts` contains no "deliverable", so no prompt emits the tag.
  - `grep -i deliverable` leaves one ordinary English use (`adoption-conversation.ts:237`).
  - `npx tsc --noEmit` is clean; eslint has 0 errors (2 warnings already on HEAD).
  - Dev DB: **0** `designs` rows contain `<deliverable>`, so no saved chat on dev changes appearance.
- **Risk:** on live, any old conversation holding a `<deliverable>` block would now show it as raw text (the accepted tradeoff). Check on the live project before deploying: `select count(*) from designs where messages::text like '%<deliverable>%'`.
- **Open:** 💲 one Analyse conversation, plus Analysis Document and Executive Summary generation, in a browser.

### 2026-10-20: MLC-18 Per-mode loading and in-memory static files

- **What was done:**
  - **`lib/static-content.ts`** (new): `readStaticFile()` memoises reads of committed `content/` files per server instance **in production only** (development re-reads every call). A failed read returns `''` and isn't cached. Database content is never cached here.
  - `lib/wiki-loader.ts` and `lib/wiki-content.ts` read through it.
  - `loadWikiContext()` still queries `published_pathways` on every call, so a publish shows up on the next request.
  - **`app/api/chat/route.ts`:** the blanket load of corpus + framework + resources became per-mode:
    - the corpus is skipped for `extract-insights` and `pathway-draft`
    - resources are loaded only for the Explorer `companion`
  - Every builder's inputs were checked: none of the skipped values was ever passed to those modes' builders, so **every mode's system prompt is unchanged by construction**.
- **Verified:**
  - `npx tsc --noEmit` and eslint are clean.
  - `static-content.ts` transpiled and run 6/6 in both modes:
    - production keeps the first read (v1 after the file changed to v2)
    - development re-reads (v2)
    - a missing file → `''` and isn't cached; it's picked up once created
  - `/api/wiki-pathways` → 200.
- **Found (pre-existing, not changed): `.env.local` has `WIKI_PATH=` set to an empty string.**
  - `process.env.WIKI_PATH ?? default` keeps `''`, so locally the static grounding corpus (`content/wiki/pathways/`) is **never loaded**. Local Analyse grounding and `/api/wiki-pathways` only see the 3 published pathways.
  - HEAD behaves the same. **Fix: delete that line from `.env.local`.** Vercel/Docker are fine as long as the variable is unset there.
- **Not done here:** the library loader (`lib/library-wiki-loader.ts`) is part of MLC-16, which is still blocked on Program Team publishing.

### 2026-10-20: MLC-19 Prompt caching

- **Approach: no reordering.**
  - In every builder, all stable content (corpus, framework, resources, toolkit assets, and the existing-published/merge doc, which is constant within a conversation) **already came before** the per-turn content (`currentProgressBlock` / `standingContext` / grid / `generatedAt`).
  - So instead of splitting builders into `{stable, variable}` as the plan proposed, a sentinel `PROMPT_CACHE_BREAK` is inserted at that existing boundary in 6 builders: explorer, contributor, analysis-doc, executive-summary, pathway-draft, document-insight.
  - **The text Claude receives is byte-for-byte what it was**, so the plan's main risk (answers shifting from reordered instructions) doesn't arise. `git diff` of `lib/system-prompts.ts` template text shows only `${PROMPT_CACHE_BREAK}` insertions.
- **`lib/prompt-cache.ts`** (new):
  - `systemForMode()`: for cached modes, `[stable + cache_control: ephemeral, perTurn]`. With no marker (library), the whole prompt is cached. For uncached modes, a plain string with the marker removed.
  - `messagesForMode()`: a breakpoint on the last message (a string becomes a text block; an array gets it on its last block), so the history is reused too. It never mutates the input.
  - **Cached modes for now: `companion` and `library`** (multi-turn). One-shot modes (documents, drafts, extraction, asset-reuse) stay uncached, because a cache write costs 1.25× and they rarely repeat within 5 minutes. **Whether to cache those too is an open question for the owner.**
- **`app/api/chat/route.ts`:** both `messages.stream` calls use `systemForMode`/`messagesForMode`. `check-similar` and `asset-reuse` are unchanged.
- **Usage page:** "Input tokens" now shows **total** input (uncached + cache read + cache write), because with caching the API's `input_tokens` covers only the uncached part. "Cached input tokens" shows cache reads.
- **Verified:**
  - `npx tsc --noEmit` and eslint are clean.
  - `prompt-cache.ts` transpiled with stubs: 10/10 checks passed:
    - joined blocks equal the original text
    - the breakpoint is on the stable block only
    - no empty block
    - the message breakpoint is on the last block only, with the input untouched
    - uncached modes are passed through as-is
  - **💲 Live:** two identical Explore kickoffs (`blue-dots`) on the owner's dev server:
    - call 1: `input 3 | cache_creation 3462 | cache_read 0`
    - call 2: `input 3 | cache_creation 0 | cache_read 3462`

    Both replies were normal.
- **Not verified yet (💲, owner):** a signed-in Analyse/Contribute companion conversation (the large ~22K-token corpus prefix); expect `cache_read_tokens` > 0 from the 2nd turn within 5 minutes. Also do the plan's sample-question before/after comparison if the Program Team still wants it, though the text is provably unchanged.
- **Note:** this shipped earlier than the planned "after a few days of baseline", on the owner's instruction (2026-10-20), because of the 28-Oct Anthropic expiry. The baseline is just the call-1 vs call-2 comparison above, plus whatever `ai_usage` collects.

### 2026-10-20: MLC-21 Wiki refreshed (targeted)

- **What was done:** a subagent made targeted edits to the existing pages under `docs/wiki/diffusion-cube/`. No pages were created and no code was changed. Every claim was checked against the code.
  - Pages from the task list:
    - `ai-context.md`, `application/database.md`, `application/api-specification.md`, `application/backend.md`, `application/frontend.md`
    - `architecture/configuration.md`
    - `integrations/ai-llm.md`, `integrations/third-party-integrations.md`, `integrations/caching.md`
    - `operations/monitoring.md`, `operations/troubleshooting.md`
    - `knowledge/technical-debt.md` (TD-01/10/12 resolved; TD-05 and TD-15 partial; TD-02/11/13/14 open)
    - `wiki-index.md`
  - Stale lines found along the way, also fixed:
    - `repository-map.md`, `business/workflows.md`
    - `architecture/coding-patterns.md` (new convention: routes are exported through `withErrorHandling`)
    - `architecture/component-diagram.md`, `sequence-diagrams.md`, `architecture-overview.md`, `integrations/async-processing.md`
- **Confirmed:** all 24 `route.ts` files (23 existing + `/api/errors/client`) go through `withErrorHandling`.
- **Clarification from the subagent:** `EXPLORE_RATE_LIMIT_PER_MIN`/`_PER_DAY` also apply to the `client-error` scope (`/api/errors/client`). The two scopes are counted separately but share the same limits.
- **Spec corrections applied** (from its discrepancy report): the 0035/0037 rows now say applied to dev; the MLC-07 entry is marked superseded by MLC-03's rate-limit-first order.
- **Pre-existing wiki drift, only partly documented:** the toolkit-assets feature (migrations 0033/0034, `asset-reuse`, `/api/toolkit-assets/*`, `/api/contributions/[designId]`, `contribution_units` now in use) got short notes only. A full `llm-wiki` regeneration should cover it; that's an open owner decision.
- **Still unverified, so the wiki words it carefully:** signed-in 404s on the removed routes; `pg_cron` absent on live (only checked on dev).

### 2026-10-20: Env vars completed; `.env.example` added

- **Why the warning appeared:** `[rate-limit] RATE_LIMIT_SALT is not set` was logged because the new variables from MLC-03/07 had never been added to `.env.local`.
- **`.env.local`** (backed up first; no values printed). Appended:
  - `APP_ENV=dev`
  - `RATE_LIMIT_SALT` (a freshly generated 64-hex random value)
  - `EXPLORE_RATE_LIMIT_PER_MIN=20`, `EXPLORE_RATE_LIMIT_PER_DAY=200`
  - the optional `NEXT_PUBLIC_SUPPORT_EMAIL` / `SMTP_SECURE` as commented lines with their defaults, so behaviour is unchanged

  The owner had already removed `GOOGLE_*` and the empty `WIKI_PATH=`.
- **`.env.example`** (new, committed): every variable the code reads (`NODE_ENV`/`VERCEL_ENV`/`NEXT_RUNTIME` are platform-set and excluded), with placeholders and one-line notes, plus `SUPABASE_DB_URL` (used for psql migrations). A script checked that no variable is missing.
- **`.gitignore`:** `!.env.example` added after `.env*`. `git check-ignore` confirms `.env.local` is still ignored.
- **Wiki:** `architecture/configuration.md` now points to `.env.example`.
- **Per environment:** set `RATE_LIMIT_SALT` (a different random value each) in Vercel and any Docker env file, and `APP_ENV=prod` on Docker/AWS. Next dev reloads `.env.local` automatically, so the warning should stop on the next request.

### 2026-10-21: MLC-16 + MLC-20 Library uses the grounding corpus; `content/library-wiki/` deleted

- **Owner decisions (business Q30–Q33):**
  - the library reads the **grounding corpus + DB**
  - **Data Dhara and CEEW move into the grounding corpus**
  - the **grounding-corpus version** wins for the 6 duplicates
  - **cards unchanged**
- **What was done:**
  - **`lib/library-documents.ts`** (new; replaces the deleted `lib/library-wiki-loader.ts`):
    - `readLibraryPathwayDocument(slug)` reads `content/wiki/pathways/<slug>.md` via `readStaticFile` (memoised in production) and strips the Source Trace appendix
    - `libraryDocumentFromPublished()` strips the appendix from DB documents
    - `buildLibraryOverview()` covers exactly the card set (8 `lib/library-pathways.ts` ids + `published_pathways`, DB wins)
  - **`app/api/chat/route.ts`:** imports the new module, applies the strip to the `published_pathways` fallback, and has an updated comment.
  - **`content/wiki/pathways/`:** `data-dhara.md` and `ceew-climate-intelligence.md` moved in with `git mv` (content unchanged). `index.md` gained "Data Infrastructure" and "Climate & Public Health" entries, so both now also ground Analyse.
  - **`content/library-wiki/` deleted** (the 6 remaining duplicates).
  - Comments updated in `lib/library-pathways.ts`, `lib/system-prompts.ts`, `lib/slug.ts` and `lib/wiki-content.ts` (`stripProvenanceAppendix` is now exported).
- **Found and fixed (pre-existing):** the public library chat was sending `published_pathways` documents to Claude **with** their contributor-only Source Trace appendix. All 3 dev DB documents have one, and the library prompt has no rule against surfacing it (wiki business rule 4). Both static and DB documents are now stripped.
- **Verified:**
  - Before deleting, all 8 card ids were confirmed to have `content/wiki/pathways/<id>.md`.
  - No references remain in code or the Dockerfile.
  - `npx tsc --noEmit` and eslint are clean.
  - Loader transpiled against the real files: 12/12. Every card document loads (8K–38K chars); the appendix is stripped from the 6 that had one; an unknown slug → null; a published doc is stripped; the overview has all 8 cards + the DB row and no card-less corpus files.
  - **💲 Live:** library kickoffs for `data-dhara` (the moved file) and `mahavistaar` (largest) → both 200 with normal replies and no Source Trace/provenance text. `ai_usage` cache writes were 3,659 and 10,088 tokens.
  - `/api/wiki-pathways` → 11 items, including both moved pathways.
- **Cost note:** grounding documents are longer than the old library copies (`mahavistaar` is about 10K tokens of input per call versus about 3.5K before), so library calls cost more; caching cuts repeat turns to about a tenth for that part.
- **Docs:**
  - **Requirement:** item 9 rewritten; Decision 13 superseded.
  - **Business clarifications:** Q30–Q33.
  - **Architecture:** 2 plan-review decisions.
  - **Task list:** MLC-16/20 notes. **Plan:** risk resolved.
  - **Wiki:** `ai-llm.md` "One pathway corpus" section; TD-02 moved to Resolved; `library-wiki` references fixed in 12 other pages; component diagram updated.

### 2026-10-21: Explore input caps moved to env vars
- **Why:** the three caps in `lib/explore-guard.ts` were hard-coded. The total cap counts Cube's own replies (about 2–4K chars each), so a visitor hits "Please shorten it or start a new chat" after about 7 ordinary questions. The caps can now be tuned per environment without a code change. The defaults (the customer's numbers) are unchanged.
- **What was done:**
  - **`lib/explore-guard.ts`:** the exported constants `EXPLORE_MAX_MESSAGES` / `EXPLORE_MAX_USER_MESSAGE_CHARS` / `EXPLORE_MAX_TOTAL_CHARS` were replaced by env vars of the same names (defaults 20 / 1000 / 20000). They are read on each request through a `limitFromEnv` helper that follows the same rule as `lib/rate-limit.ts`: a missing, invalid or non-positive value falls back to the default. Nothing else imported the constants.
  - **`.env.example`:** the three vars were added under the rate-limit block.
  - **Wiki:** `configuration.md` table rows were added; `troubleshooting.md` and `api-specification.md` now mention the env override.
- **Verified:** nothing run (per request). Only the code paths were checked by reading: the guard is used only in `app/api/chat/route.ts` (server), so the vars don't need a `NEXT_PUBLIC_` prefix.
- **Open:**
  - **Whether to raise the defaults:** this is the customer's decision.
  - **The better fix is trimming old turns instead of rejecting:** see `tests/real-user-breaks/01-explore-long-chat.test.ts`.
  - **Per-environment values:** set them in Vercel/AWS if they should differ from the defaults.

### 2026-10-22: Error catalogue added to the plan
- **Why:** the plan and the requirement defined the expected/unexpected categories with a few examples, but there was no itemised list of the actual errors.
- **What was done:** added a new section, "Error catalogue (as built)", to `plan_monitoring_logging_cleanup.md`, right under "Error classification". It is built from the code on this branch:
  - every expected 4xx, with its message and route
  - the expected cases that are deliberately not recorded (429s, proxy 401, page `notFound()`, login wrong password)
  - every unexpected source, with what the user sees and its `sys_errors.source`
- **Verified:** by reading the code (`grep` over `app/api`, `lib`, `proxy.ts`, `instrumentation.ts`). Nothing run. All 24 routes are confirmed wrapped in `withErrorHandling`.
- **Open (doc vs code, not yet decided):**
  - **Page not-found:** the requirement says it is recorded as expected; the code doesn't record it.
  - **Proxy 401:** architecture Q6 says every 4xx is recorded; the proxy's 401 for signed-out `/api/*` calls isn't.
  - **429 in the plan:** the classification table doesn't note that 429 is unrecorded, but the requirement and the code agree it isn't recorded.

### 2026-10-22: Audit High findings fixed (H1–H4)
- **Why:** the full-codebase audit (`docs/audits/2026-10-22/`) raised four High findings. Two of them (H3, H4) are gaps in this branch's own rate-limit and error-logging work.
- **What was done:**
  - **H1 — new pathways can't take a curated slug:**
    - **The rule:** `isReservedPathwaySlug()` (new, `lib/wiki-loader.ts`) treats every slug `content/wiki/pathways/index.md` lists, plus `index` itself, as taken.
    - **Where it applies:**
      - `uniqueSlug` in `app/api/pathways/route.ts` skips reserved slugs. "Blue Dots" becomes `blue-dots-1` and "Index" becomes `index-1`.
      - `assemble` refuses a reserved slug with 409 before any GitHub write. This covers rows created before the rule.
  - **H2 — assembled drafts are not served:**
    - `curatedPathwaySlugs()` (new, `lib/wiki-loader.ts`) is the curated corpus, i.e. what `index.md` lists.
    - `readLibraryPathwayDocument` (the /explore chat) and `getWikiPathway` (`/wiki/[slug]`) now read a static file only for a curated slug. Anything else falls back to `published_pathways`, so an assembled-but-unpublished file in the folder is no longer public. This matches the documented rule that assemble does not make a pathway visible.
    - `getWikiPathway` also now refuses a slug that fails `isValidSlug` (the audit's Medium path-traversal finding at the same spot).
    - `content/wiki/pathways/test-assets-langchat.md` stays in the repo but is no longer served from disk. On dev it is published, so it is served from the DB copy.
  - **H3 — sys_errors can't be flooded:**
    - **`/api/chat`:** the rate limit now runs first, before the body is parsed. A body that isn't a JSON object returns 400 `Invalid request.` instead of 500.
    - **`withErrorHandling` (`lib/errors.ts`):** an anonymous caller's 4xx is recorded only while their IP is within a new `anon-error` allowance (EXPLORE_RATE_LIMIT_* values, 20/min, 200/day). The response itself is unchanged. 5xx errors and signed-in 4xx are always recorded.
    - `lib/rate-limit.ts` is loaded with a dynamic import, because rate-limit records its own failures through errors.ts.
  - **H4 — Claude spend is bounded per account and gated by role:**
    - **Rate limits:** signed-in `/api/chat` callers are rate-limited per account (new `chat-user` scope keyed on the user id; `CHAT_USER_RATE_LIMIT_PER_MIN`/`_PER_DAY`, defaults 30/300). Anonymous callers stay per IP on the `explore` allowance.
    - **Role gates** (`requiredRole`, via the new `currentRoles()` in `lib/roles.ts`, one query):
      - `pathway-draft`, `asset-reuse`, and `companion`/`extract-insights` with `flow: 'contributor'` need `pathway_contributor`.
      - Everything else needs `adopter`. That includes `analysis-doc`, `executive-summary`, and a companion call with a missing or unknown flow, which closes the CH-07 gap.
    - **Message checks:** every non-library mode now needs a non-empty array of user/assistant turns, at most 500 (`isValidMessages`). Anything else returns 400 before any Claude call.
  - **`lib/rate-limit.ts`:** limits are now set per scope (the `LIMITS` table), and `checkRateLimit(req, scope, subject?)` takes an optional subject.
  - **`.env.example`:** added `CHAT_USER_RATE_LIMIT_PER_MIN`/`_PER_DAY`, and rewrote the rate-limit comment.
- **Verified:**
  - **Static checks:**
    - `tsc --noEmit`: exit 0.
    - `eslint .`: the same 11 problems as before (3 errors, 8 warnings, all of them existing ones). Nothing new.
  - **Live, on the local dev server against DEV Supabase (`pcpdgu…`), with no Claude calls:**
    - `library` with `pathwayId` `community-health` / `citizen-help` (assembled files, unpublished) → 404. `index` → 404.
    - Malformed JSON → 400; a `null` body → 400. Both were 500 before.
    - An anonymous companion call → 403.
    - 22 unknown-mode requests from one IP → 20×400, then 429×2.
    - 25 anonymous 404s on `/api/toolkit-assets/<uuid>/download` from one IP → still 25×404, but only **20** `sys_errors` rows (2 → 22).
  - **Unit, in-process (vitest, from the scratchpad — not committed):**
    - The 16 new tests pass: curated set = the 8 index entries; reserved slugs; library and `/wiki` read curated files only and fall back to the DB; traversal is rejected; POST `/api/pathways` gives `blue-dots-1` / `index-1`; chat applies the limiter before parsing (both scopes); every role and flow combination; message-shape caps (500 OK, 501 rejected); the anonymous-4xx recording throttle.
    - The QA suite's Supabase mock was made awaitable, like the real builder. With that, CH-07, CH-08, CH-09 and CH-11 pass.
    - The remaining 25 failures are the audit's known Medium/Low defects, not regressions. SL-08 still fails because it tests `slugify` alone, not `uniqueSlug`.
- **Not verified:**
  - Signed-in role gates and the per-account limit against the real dev server (no test accounts). They are covered only by in-process tests.
  - Assemble's 409 with a real GitHub write.
- **Open:**
  - **Rate limits:** the `chat-user` defaults (30/300) are a judgement call; tune them with real usage. The per-IP limiter still trusts the first X-Forwarded-For hop (audit Medium), which matters on the Docker/AWS path.
  - **Payload size:** no cap per message or on the total payload yet; attachments make the legitimate size unclear.
  - **Wiki:** `api-specification.md`, `configuration.md` and `business-rules.md` need a refresh for the new limits, role gates and curated-only serving.
