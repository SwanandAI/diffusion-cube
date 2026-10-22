# Task List: System Error Handling, Usage Monitoring and Technical Cleanup

> Status: **Draft 2026-10-19** (task-creation), derived from the approved
> [`plan_monitoring_logging_cleanup.md`](plan_monitoring_logging_cleanup.md). Requirement:
> [`requirement_monitoring_logging_cleanup.md`](requirement_monitoring_logging_cleanup.md).
> Clarifications: [business](business_clarifications_monitoring_logging_cleanup.md),
> [architecture](architecture_clarifications_monitoring_logging_cleanup.md).

## High-level summary

The implementation backlog has 21 user stories (MLC-01 to MLC-21). Each has acceptance criteria and a manual test plan covering positive, edge, negative and non-functional cases, because the repo has no automated tests.

- **R1, the foundation (P0/P1):**
  - MLC-01: the `sys_errors` table and `lib/errors.ts`
  - MLC-02: wrap every API route
  - MLC-03: error pages and `/api/errors/client`
  - MLC-04: handling replies that break off partway
  - MLC-05: the `x-user-email` reset
  - MLC-06: Explore input checks
  - MLC-07: the per-IP rate limit
- **R2, monitoring:**
  - MLC-08: `ai_usage`
  - MLC-09: remove Google Sheets logging
  - MLC-10: `/admin/usage`
  - MLC-11: `/admin/errors`
- **R3, cleanup and loading:**
  - MLC-12 to MLC-17: dead and duplicate code
  - MLC-18: per-mode loading and in-memory static files
- **R4 and after:**
  - MLC-19: prompt caching
  - MLC-20: delete `content/library-wiki/` (done 2026-10-20)
  - MLC-21: refresh the wiki
- **Also in this file:**
  - a dependency graph and the release plan
  - a closing list of what no story covers: Anthropic account renewal, revoking the Google key, `pg_cron`, and an automated test framework
- **Status.** This list doesn't track per-story progress. Only MLC-16 (changed) and MLC-20 (done) carry status notes.

> **Testing note.** This repo has **no automated test suite** (no test runner, no CI test job; `.github/workflows/deploy.yml` only deploys). Every case below is a **manual verification step**: a concrete action and an observable result in the running app (`npm run dev` unless stated), in Supabase (table editor or SQL editor), or with `curl`.
>
> Cases marked 💲 call the real Anthropic API. Run them sparingly; they depend on the Anthropic account, which expires **28-Oct-2026** (TD-16).
>
> Run migrations and tests against a **dev Supabase project first**. `.env.local` points at a different project than the live site, so confirm which project you are on before applying any migration.

Test accounts needed: one each of `general_user` (pending, zero roles), `adopter`, `pathway_contributor` and `admin`, plus a signed-out browser window.

## Build order

```
MLC-01 (sys_errors + lib/errors) ─┬─► MLC-02 (wrap 26 routes) ─► MLC-04 (stream failures)
                                  ├─► MLC-03 (error pages + /api/errors/client) ◄── MLC-07
                                  └─► MLC-11 (/admin/errors)
MLC-05 (x-user-email reset)          independent, ship early
MLC-06 (Explore guard, 400) ─► MLC-07 (rate limit, 429; also used by MLC-03)
MLC-08 (ai_usage capture) ─┬─► MLC-09 (remove Sheets, same release as MLC-08)
                           └─► MLC-10 (/admin/usage) ◄── MLC-01
Dead code: MLC-02 ─► MLC-12 ─► MLC-13      MLC-04 ─► MLC-14      MLC-15, MLC-17 independent
           MLC-16 (library reads DB only, 8-slug check) ─► MLC-20 (delete folder, after Program Team sign-off)
MLC-13 + MLC-16 ─► MLC-18 (per-mode loading + memoisation) ─► MLC-19 (prompt caching, after MLC-08 baseline)
MLC-21 (wiki refresh) last
```

Suggested releases:

| Release | Stories |
|---|---|
| R1 | MLC-01, MLC-02, MLC-03, MLC-04, MLC-05, MLC-06, MLC-07 |
| R2 | MLC-08, MLC-09, MLC-10, MLC-11 |
| R3 | MLC-12, MLC-13, MLC-14, MLC-15, MLC-16, MLC-17, MLC-18 |
| R4 | MLC-19, after a few days of `ai_usage` baseline |
| — | MLC-20, after Program Team sign-off |
| — | MLC-21, last |

---

## Stories

### MLC-01: `sys_errors` table and the shared error library

**As a** system administrator
**I want** every error Cube's server sees to be stored in one table, scrubbed of sensitive data and kept for 30 days
**So that** I can review what failed, where and for whom, without raw logs

**Priority:** P0 · **Depends on:** None

**Acceptance Criteria:**
- Given `supabase/migrations/0035_sys_errors.sql`, then:
  - Its header comment states its purpose.
  - It creates `sys_errors` with: `id uuid pk default gen_random_uuid()`, `created_at timestamptz not null default now()`, `source text not null`, `message text not null`, `stack text`, `context jsonb`, `user_id uuid references auth.users(id) on delete set null`, `environment text not null check (environment in ('prod','dev'))`.
  - It adds indexes on `(created_at)` and `(source, created_at)`.
  - It enables RLS with **no** policies.
  - It creates `purge_old_sys_errors(days int default 30)`, which deletes rows older than `days`.
  - It is additive only.
- Given a signed-in browser client (any role) or the anon key, when it selects or inserts on `sys_errors`, then it is denied (requirement Decision 1; architecture Q4).
- Given `lib/errors.ts`, then it exports:
  - `GENERIC_ERROR_MESSAGE = "System encountered an error. Please try sometime later."`, word for word (Decision 12)
  - `ValidationError` (400), `AuthError` (401/403) and `NotFoundError` (404)
  - `logError(source, error, context)`
- Given `logError()` is called, then:
  - it writes one row through the service-role client (`lib/supabase/admin.ts`) inside Next's `after()`
  - `message` is capped at 2,000 characters and `stack` at 8,000
  - `context` keeps only `user_id`, `mode`, `flow`, `pathway_slug`, `design_id`, `path`, `method`, `status`, `kind`, and drops every other key
  - patterns matching `sk-ant-…`, `Bearer …`, JWTs (`eyJ…`) and `password=…` are masked in message, stack and context (architecture Q11)
- Given `APP_ENV` is set, then `environment` takes its value. Otherwise `environment` is `prod` when `VERCEL_ENV === 'production'` and `dev` in every other case (architecture Q9).
- Given the insert fails (e.g. Supabase unreachable), then `logError()` writes only to `console.error`, never throws, and never delays or changes the caller's response (Decision 14).
- Given `logError()` runs, then at most once per server instance per hour it calls `purge_old_sys_errors(30)` (plan Assumption 1).

**Test Plan:**
- *Positive:*
  - Apply 0035 on the dev project. In the SQL editor, confirm the table, both indexes, `relrowsecurity = true` and zero rows in `pg_policies` for `sys_errors`.
  - From a scratch route or a dev console call, run `logError('test/manual', new Error('boom'), { user_id: '<uuid>', mode: 'library' })`. Confirm a row with `source = 'test/manual'`, the stack populated, `environment = 'dev'` and the context keys intact.
- *Edge cases:*
  - Log an error whose message is 5,000 characters and whose stack is 20,000. The stored values are exactly 2,000 and 8,000 characters.
  - Pass `context` with `{ messages: [...], password: 'x', email: 'a@b.c', mode: 'companion' }`. Only `mode` is stored.
  - Insert a row with `created_at = now() - interval '31 days'`, then trigger `logError()` on a fresh dev-server start. The old row is gone and a 29-day-old row remains.
  - Set `APP_ENV=prod` locally. The new row says `prod`.
- *Negative cases:*
  - With the anon key, `curl` the Supabase REST endpoint `GET /rest/v1/sys_errors`. It returns an empty list or a permission error, never rows.
  - Log an error whose message contains `sk-ant-api03-ABC…` and `Bearer eyJhbGciOi…`. Both are masked in the stored row.
  - Temporarily set a wrong `SUPABASE_SERVICE_ROLE_KEY` and call `logError()`. The caller still completes, and only `console.error` shows the failure.
- *Non-functional:*
  - 0035 applies cleanly on top of 0034.
  - **First automated test candidate:** the scrubbing and capping helpers in `lib/errors.ts` are pure string/JSON transforms, the cheapest place to start a test suite per `architecture/testing.md`. This is a suggestion, not part of this story.

---

### MLC-02: Every API route goes through `withErrorHandling`

**As a** user of any Cube area
**I want** unexpected failures to show one generic message, and expected ones to keep their specific wording
**So that** I never see raw technical text, and the administrator sees every failure

**Priority:** P0 · **Depends on:** MLC-01

**Acceptance Criteria:**
- Given `withErrorHandling(source, handler)` in `lib/errors.ts`, when it wraps a handler, then:
  - a returned response with status 400–499 passes through unchanged and is logged with `kind: expected`
  - a returned response with status ≥ 500 has its body replaced with `{ error: GENERIC_ERROR_MESSAGE }` and is logged with `kind: unexpected`
  - a thrown `ValidationError`/`AuthError`/`NotFoundError` returns that class's status and message, logged as expected
  - any other throw returns 500 `{ error: GENERIC_ERROR_MESSAGE }`, logged as unexpected with the stack (plan → Error path)
- Given all 26 `app/api/**/route.ts` files, then every exported handler (`GET`/`POST`/`DELETE`) is wrapped, with `source` set to the route path (e.g. `api/admin/roles`).
- Given the 11 responses that return raw `error.message` or `String(err)`, then each returns the generic message instead:
  - `app/api/admin/roles/route.ts` L38, L46, L56
  - `app/api/auth/grant-default-role/route.ts` L39, L46, L54
  - `app/api/pathways/route.ts` L45, L112
  - `app/api/pathways/[id]/join/route.ts` L58, L69
  - `app/api/admin/reject/route.ts` L32
- Given the existing hand-written 500 messages (e.g. "Could not delete your account.", "Could not save your choice. Please try again.", "Could not delete this contribution. Try again."), then they also return the generic message (architecture plan-review decision).
- Given an existing expected message (e.g. "Not signed in.", "The Explorer flow requires the Adopter role.", "Unknown pathway.", "Incorrect password.", "This account already has access — it is no longer a pending signup.", "Too many attempts. Please wait a few minutes and try again."), then its status and wording are unchanged.
- Given a route that knows the signed-in user, then the logged row's `user_id` is set; for a signed-out caller it is empty.
- Given the client surfaces that display `{ error }` from these routes (admin console panels, account page, contribute flows), then they show the returned message as they do today; no client shows a stack or raw text.

**Test Plan:**
- *Positive:*
  - Signed out, `curl -X POST localhost:3000/api/account/delete`. You get 401 "Not signed in.", and `sys_errors` has a row with `source = 'api/account/delete'`, `context.kind = 'expected'` and `context.status = 401`.
  - As `adopter`, POST to `/api/chat` with `mode: 'companion', flow: 'contributor'`. You get 403 "The Contributor flow requires the Contributor role." and an expected row with the adopter's `user_id`.
  - As `admin`, call `/api/admin/pathways/publish` with an unknown `pathway_id`. You get 404 "Pathway not found." and an expected row.
- *Edge cases:*
  - A route with several exported methods (e.g. `app/api/toolkit-assets/[id]/route.ts`): confirm each method is wrapped by triggering a 4xx on each.
  - A 409 (`/api/admin/reject` on an account that already has roles) is logged as expected, with the message unchanged.
  - A route that streams (`/api/chat`) still streams normally on success; the wrapper doesn't buffer the response.
- *Negative cases:*
  - 💲 Set `ANTHROPIC_API_KEY=invalid` locally (restart `npm run dev`) and, as `adopter`, send a companion message. The SDK only fails once the stream is read, so the response starts as a 200 and is then errored (MLC-04). The chat shows exactly the generic message, and the row is `kind: unexpected`, `source = api/chat`, with an Anthropic stack and no message text in `context`.
  - Point `NEXT_PUBLIC_SUPABASE_URL` at an unreachable host locally and, as `admin`, change a role. The response body is the generic message, **not** a Postgres or fetch error string. (After this test, restore the URL. The `sys_errors` write fails too, which is expected; it shows in `console.error`.)
  - `grep -rn "error.message\|String(err)" app/api` finds no response bodies built from raw errors.
- *Non-functional:*
  - Response time on a normal request is unchanged (the write happens in `after()`).
  - Spot-check the admin console, the account page and contributor "join" in the browser: messages appear in the same places as before.

---

### MLC-03: Cube error pages and browser error reporting

**As a** user whose page crashes or who opens a link that doesn't exist
**I want** a Cube-styled page with the generic message and a way home, or Cube's own not-found page
**So that** I'm never left on the framework's default error screen

**Priority:** P1 · **Depends on:** MLC-01; MLC-07 (rate limit for the public endpoint)

**Acceptance Criteria:**
- Given `app/error.tsx` (client component), when any page segment throws during render (server or client), then it shows `GENERIC_ERROR_MESSAGE`, a "Back to home" link and Cube's styling (`app/globals.css` tokens), and never `error.message` or a stack.
- Given `app/global-error.tsx`, when the root layout itself fails, then the same message and link render in a minimal standalone `<html>`.
- Given `app/not-found.tsx`, when a user opens an unknown path, then Cube's own not-found page renders, with a link home.
- Given `error.tsx` or `global-error.tsx` renders for a **browser-side** error (no `digest`), then it POSTs `{ message, stack, path }` once to `/api/errors/client`. A server-side error (with a `digest`) is not re-sent: `instrumentation.ts`'s `onRequestError` has already recorded it with its real stack (`source = render:<route>` / `action:<route>` / `proxy:<route>`; added in development 2026-10-19).
- Given `app/api/errors/client/route.ts` (public, added to `proxy.ts` `PUBLIC_PATHS`), then:
  - a body over 16 KB returns 400
  - a valid body returns 204 and writes a `sys_errors` row with `source = 'client:<path>'`, `kind: unexpected`, and the user's `user_id` if a session exists
  - a caller over the per-IP limit (MLC-07) gets 429 and no row is written (the limit is checked first, before the size check)
- Given the route is itself wrapped by `withErrorHandling`, then a failure inside it is logged once and never loops (the error pages don't report their own reporting failure).

**Test Plan:**
- *Positive:*
  - Open `/this-does-not-exist`. Cube's not-found page shows.
  - Temporarily add `throw new Error('render test')` to a client component on `/account` (local only). The Cube error page shows the generic message, and a `client:/account` row appears in `sys_errors`. Revert afterwards.
  - Do the same in a server component. The error page shows, and the row's message is the digest-only error.
- *Edge cases:*
  - Click "Back to home" on the error page. It navigates to `/` (or `/explore` for a signed-out user, as the proxy does today).
  - The same render error on two tabs gives two rows, not a loop of rows.
  - Signed-out crash: the row has an empty `user_id`.
- *Negative cases:*
  - `curl -X POST /api/errors/client` with a 20 KB body returns 400, and no row is written.
  - `curl` it 25 times in a minute from one IP. Requests over the limit return 429.
  - Send a body containing `password=hunter2` in the stack. The stored stack is masked.
- *Non-functional:*
  - Check the error and not-found pages at mobile and desktop widths with the brand colours.
  - Confirm `/api/errors/client` is the only new public path in `proxy.ts`.

---

### MLC-04: Replies that break off partway

**As a** user chatting with Cube in Explore, Analyse or Contribute
**I want** to see the generic message when a reply fails partway, without the broken reply being saved
**So that** a half-reply isn't mistaken for Cube's answer

**Priority:** P1 · **Depends on:** MLC-01, MLC-02

**Acceptance Criteria:**
- Given both stream loops in `app/api/chat/route.ts` (library ~L150, main ~L245), when iterating the Anthropic stream throws, then the error is logged as `kind: unexpected` with `mode`, `flow` and `user_id`, and `controller.error()` is called.
- Given `app/explore/ExploreLibrary.tsx`, when `reader.read()` rejects, then the text already shown stays, the generic message appears below it, and the turn is **not** saved to `library_conversations`.
- Given `lib/adoption-conversation.ts` / `components/ChatPanel.tsx` (Analyse and Contribute), when the stream breaks, then the generic message appears after any text received, the partial reply isn't added to the saved conversation, and no grid write happens (the `<grid_update>` never arrived).
- Given a non-2xx response before streaming starts, then each client shows the response's `error` text (expected) or the generic message (5xx), never the raw JSON.
- Given the user sends another message after a failure, then the conversation continues normally.

**Test Plan:**
- *Positive:*
  - 💲 As `adopter` on `/analyse`, ask for a long answer and, once text starts appearing, switch DevTools → Network to "Offline". The generic message appears under the partial text. Reload: the partial reply isn't in the saved conversation.
  - 💲 Repeat on `/explore` (signed in) and `/contribute`.
- *Edge cases:*
  - Failure before the first token (`ANTHROPIC_API_KEY=invalid`): the generic message appears with no partial text, and nothing is saved.
  - Go back online and resend. The reply streams and saves normally.
  - Mid-stream failure during the lazy `designs` row creation on a brand-new Analyse conversation: confirm the existing `creatingRef` dedup still prevents a duplicate row.
- *Negative cases:*
  - The response JSON `{"error": ...}` is never rendered as a chat bubble in any of the three clients.
  - No `sys_errors` row contains message or reply text (inspect `context` and `message`).
- *Non-functional:*
  - Invariant check: the partial companion reply causes no `designs.grid_state` change. All grid writes still go only through the client parsing `<grid_update>`.

---

### MLC-05: Reset `x-user-email` on every request

**As a** Cube operator
**I want** the internal sign-in header to be cleared on every request and set only from a verified session
**So that** nobody can pretend to be signed in, or be an admin, by sending their own header

**Priority:** P0 · **Depends on:** None

**Acceptance Criteria:**
- Given any request through `proxy.ts`, then a copy of the incoming headers is made with `x-user-email` deleted, before any branch runs.
- Given a signed-in user, then the copy gets `x-user-email` set to the verified `user.email`, as today.
- Given a signed-out request to a public path (`/explore`, `/api/chat`, etc.), then the forwarded request carries **no** `x-user-email`, whatever the browser sent.
- Given each `NextResponse.next()` the proxy returns, then it forwards the cleaned headers and keeps the Supabase cookie-copy behaviour unchanged.
- Given the five pages that read the header (`app/(app)/layout.tsx`, `app/analyse/page.tsx`, `app/contribute/page.tsx`, `app/account/page.tsx`, `app/explore/page.tsx`), then they behave as before for real users.

**Test Plan:**
- *Positive:*
  - Signed in as `admin`, open `/explore` and `/admin`. The admin links show as today.
  - Signed in as `adopter`, open `/analyse`. It works as today.
- *Edge cases:*
  - A session that expires mid-visit: the next request is treated as signed out (no header), and the proxy's existing redirect behaviour is unchanged.
  - A signed-in `admin` sends `x-user-email: someone-else@x.com`. Pages show the admin's own email, not the forged one.
- *Negative cases:*
  - Signed out, `curl -H "x-user-email: <a real admin's email>" localhost:3000/explore`. The HTML shows the signed-out library with no admin controls, and `isAdmin` isn't granted.
  - Signed out, the same forged header to `/account`. Redirected to login as today.
- *Non-functional:*
  - The page-load time for signed-in navigation is unchanged (no extra `getUser()` call).

---

### MLC-06: Explore input checks (400 before Claude)

**As a** Cube operator paying for AI calls
**I want** the public library chat to reject oversized or malformed conversations before Claude is called
**So that** misuse can't run up cost or break the chat

**Priority:** P0 · **Depends on:** MLC-02

**Acceptance Criteria:**
- Given `lib/explore-guard.ts`, when `/api/chat` receives `mode: 'library'` (with or without `pathwayId`), then, after the rate limit (MLC-07) and **before any other database read or Claude call**, it rejects with 400 `{ error: "Invalid request." }` if any of these hold:
  - `messages` is not an array
  - any item's `role` is not `"user"` or `"assistant"`
  - any item's `content` is not a plain string
  - the last message is not from `"user"` (an empty array is the kickoff and passes; the first message may be Cube's overview)
  - there are more than 20 messages
  - any `user` message is longer than 1,000 characters
  - the total length, `assistant` messages included, is over 20,000 characters

  (Requirement item 7; architecture Q18, Q19; adjusted in development 2026-10-19, see architecture plan-review decisions.)
- Given a valid conversation, then the route continues to `isValidSlug`, the pathway lookup and Claude, as today. (Order changed in development, 2026-10-19: the rate limit runs first, so malformed floods are capped too.)
- Given each rejection, then a `sys_errors` row is logged with `kind: expected` and `mode: 'library'` (through `withErrorHandling`), and no AI call is made.
- Given `app/explore/ExploreLibrary.tsx`, when the response isn't `ok`, then it shows a short plain notice ("Your message couldn't be sent. Please shorten it or start a new chat.") instead of rendering the JSON. The rejected message goes back into the input box; the notice is never resent as history or saved.
- Given the Analyse and Contribute chats, then none of these checks apply (requirement item 7).

**Test Plan:**
- *Positive:*
  - 💲 Signed out, chat with a pathway on `/explore` for a few turns. Replies work.
  - 💲 Use the general library chat (no pathway selected). Replies work.
- *Edge cases:*
  - Exactly 20 turns, a message of exactly 1,000 characters, and exactly 20,000 characters in total are accepted (boundaries inclusive).
  - An empty-string user message: `content` is a string, so it passes the shape check. Confirm the behaviour is the same as today.
  - Unicode (Hindi text, emoji): length is counted in JavaScript string length. Note this in the PR.
- *Negative cases:*
  - With `curl`, send each of these:
    - 21 messages
    - a 1,001-character message
    - 21 × 999-character messages
    - `role: "system"`
    - `content: [{type:"text",text:"hi"}]`
    - a conversation ending with `assistant`
    - `messages: "hi"`

    Each returns 400 "Invalid request.", and no `ai_usage` row appears (once MLC-08 is live).
  - In the browser, paste a 1,500-character message into the library chat. The plain message shows; no JSON appears in the chat.
  - As `adopter`, send a 1,500-character message on `/analyse`. It is accepted (no Explore checks there).
- *Non-functional:*
  - **Automated test candidate:** `lib/explore-guard.ts` is a pure function and ideal as a first unit test. This is a suggestion only.

---

### MLC-07: Per-IP rate limit for Explore (429)

**As a** Cube operator
**I want** each address limited to 20 Explore messages a minute and 200 a day (adjustable)
**So that** one visitor or script can't flood the AI service

**Priority:** P0 · **Depends on:** MLC-01, MLC-06

**Acceptance Criteria:**
- Given `supabase/migrations/0037_rate_limits.sql`, then:
  - its header comment states its purpose
  - it creates `rate_limits(key text, bucket text, window_start timestamptz, count int, primary key (key, bucket))` with RLS on and no policies
  - it creates `check_rate_limit(p_key text, p_per_min int, p_per_day int) returns boolean` as security definer, with execute revoked from `anon` and `authenticated`
  - the function increments both buckets atomically, resets a bucket whose window has passed, deletes stale rows, and returns `false` when either limit is exceeded
- Given `lib/rate-limit.ts`, then:
  - the IP comes from the first hop of `x-forwarded-for`
  - it is hashed with SHA-256 and `RATE_LIMIT_SALT` before it leaves the server
  - the limits come from `EXPLORE_RATE_LIMIT_PER_MIN` (default 20) and `EXPLORE_RATE_LIMIT_PER_DAY` (default 200)

  (Decision 10; architecture Q16, Q17.)
- Given an Explore request, when the limit is exceeded, then it returns 429 `{ error: "Too many requests. Please try again later." }` **before** the input guard, the pathway lookup or Claude. 429s are **not** recorded in `sys_errors` (flood protection; changed in development 2026-10-19).
- Given the RPC errors, then the request is **allowed** and the failure is logged as `kind: unexpected` (fail open; plan Key Tradeoffs).
- Given a signed-in visitor on Explore, then the same per-IP limit applies.
- Given `ExploreLibrary.tsx` receives 429, then it shows "Too many requests. Please try again later." as a plain message.
- Given `/api/errors/client` (MLC-03), then it uses the same limiter.

**Test Plan:**
- *Positive:*
  - Apply 0037 on dev. Set `EXPLORE_RATE_LIMIT_PER_MIN=3`. 💲 Send 3 Explore messages: all are answered. The 4th within the minute gets 429 and the plain message.
  - Wait a minute. The next message is answered (the window reset).
- *Edge cases:*
  - Two near-simultaneous `curl` requests at count 2 of 3 both succeed and the count becomes 4. The next request is rejected, proving there was no lost update.
  - Set the day limit to 5 and the minute limit to 100: the 6th message of the day is rejected.
  - `rate_limits.key` holds a 64-character hex hash, never a raw IP.
- *Negative cases:*
  - With the anon key, call `rpc('check_rate_limit', …)` from the browser console. Permission is denied.
  - Temporarily rename the function in dev (or revoke service-role execute) and send an Explore message. 💲 It is answered, and an unexpected `sys_errors` row records the limiter failure. Restore afterwards.
  - The 429 response never includes the hash or the count.
- *Non-functional:*
  - Measure Explore time-to-first-token before and after on dev. Expect roughly 20–50ms added. Record the number in the PR.
  - 0037 applies cleanly after 0036/0035.

---

### MLC-08: Record every Claude call in `ai_usage`

**As a** product administrator
**I want** each Claude call's area and token counts recorded, without any content
**So that** the Usage page can show AI usage per area, and we can measure prompt-caching savings

**Priority:** P1 · **Depends on:** MLC-01

**Acceptance Criteria:**
- Given `supabase/migrations/0036_ai_usage.sql`, then:
  - its header comment states its purpose
  - it creates `ai_usage(id, created_at, user_id references auth.users on delete set null, area check in ('explore','analyse','contribute'), mode, flow, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, ok boolean not null)`
  - it adds an index on `(created_at, area)`, enables RLS, and has no policies
- Given `lib/ai-usage.ts` `areaFor(mode, flow)`, then:
  - `library` → explore
  - `companion` (flow ≠ contributor), `analysis-doc`, `executive-summary` and `extract-insights` (flow ≠ contributor) → analyse
  - `companion` (contributor), `pathway-draft`, `asset-reuse`, `extract-insights` (contributor) and check-similar → contribute

  (Architecture Q13.)
- Given a streamed `/api/chat` call completes, then one row is written inside `after()` from `stream.finalMessage().usage`. The row includes `cache_read_input_tokens` and `cache_creation_input_tokens` (0 when absent), `model`, the user's `user_id` (empty for signed-out Explore) and `ok: true`.
- Given the non-streamed `asset-reuse` call and `app/api/pathways/check-similar/route.ts`, then each writes a row from `result.usage`.
- Given a Claude call fails, then a row is written with `ok: false` and whatever usage is known.
- Given any `ai_usage` row, then it holds no message, prompt or reply text.

**Test Plan:**
- *Positive:*
  - 💲 Make one call in each area:
    - Explore: a signed-out pathway chat
    - Analyse: an adopter companion turn, then an analysis document
    - Contribute: a contributor companion turn, a draft, and a duplicate check when creating a pathway

    Each produces one row with the right `area`/`mode`/`flow` and non-zero tokens.
  - Compare one row's token counts with the Anthropic console usage for that minute. They match.
- *Edge cases:*
  - `extract-insights` from an Analyse document upload → `analyse`; from a Contribute upload → `contribute`.
  - A signed-out Explore call → `user_id` is null.
  - Delete a test account that has rows. Its rows remain with `user_id` null.
- *Negative cases:*
  - 💲 With `ANTHROPIC_API_KEY=invalid`, send a companion message. An `ok: false` row is written, and the user sees the generic message (MLC-02).
  - With the anon key, select from `ai_usage`. Denied.
  - Requests rejected by MLC-06/07 produce **no** `ai_usage` row.
- *Non-functional:*
  - Chat time-to-first-token is unchanged (the write happens after the stream finishes).
  - **Automated test candidate:** `areaFor()` is a pure mapping. This is a suggestion only.

---

### MLC-09: Remove Google Sheets logging

**As the** Solution Team
**I want** the Google Sheets conversation log and its settings removed
**So that** conversation content stops going to a third place, and there's less code to maintain

**Priority:** P1 · **Depends on:** MLC-08 (ship in the same release, so there's no gap in recording)

**Acceptance Criteria:**
- Given the codebase, then:
  - `lib/logger.ts` is deleted
  - the `logConversation` import and call at `app/api/chat/route.ts:18` and `:253` are removed
  - `googleapis` is removed from `package.json` and `package-lock.json`
- Given the env configuration, then `GOOGLE_SERVICE_ACCOUNT_JSON` and `GOOGLE_SHEET_ID` are no longer read anywhere and are removed from `.env.example` (if listed), the Vercel project and any Docker env file.
- Given the app runs without those variables, then every chat mode works.
- Given the existing Sheet, then it is left untouched (business Q4). Revoking the Google Cloud key is not part of this story (architecture Q24).

**Test Plan:**
- *Positive:*
  - `npm install && npm run build` succeeds.
  - 💲 Chat in Explore, Analyse and Contribute with the Google variables unset. Every reply works, and `ai_usage` rows appear (MLC-08).
- *Edge cases:*
  - `grep -rn "googleapis\|GOOGLE_SHEET_ID\|GOOGLE_SERVICE_ACCOUNT_JSON\|logConversation" .` (excluding `node_modules`) returns only docs, never code.
  - A stale deployment still has the variables set: harmless, nothing reads them.
- *Negative cases:*
  - After deploying, send a chat turn and check the Sheet. No new row is added.
- *Non-functional:*
  - The bundle and install size drop (`googleapis` is large). Note the `npm ls` difference in the PR.

---

### MLC-10: `/admin/usage` page

**As a** product administrator (the existing `admin` role)
**I want** one read-only page with user, activity, AI usage and error figures
**So that** I can see how Cube is used and how often it fails, without asking engineering

**Priority:** P1 · **Depends on:** MLC-01, MLC-08

**Acceptance Criteria:**
- Given `supabase/migrations/0038_admin_usage_stats.sql`, then:
  - its header comment states its purpose
  - it creates `admin_usage_stats() returns jsonb` as security definer, with execute revoked from `anon` and `authenticated`
- Given that function, then it returns:
  - **users:** total in `auth.users`; new in the last 7 days; active in the last 7 and 30 days. Active = a distinct `user_id` with activity in that window in `designs.updated_at`, `pathways.updated_at`, `library_conversations.updated_at` or `ai_usage.created_at`.
  - **activity:**
    - published pathways: distinct slugs across `content/wiki/pathways/` and `published_pathways`. The static count is passed in from the page, or added in TypeScript, because SQL can't read files (plan Assumption 2).
    - conversations: total and last 7 days, with a per-area breakdown: explore from `library_conversations`, analyse from `designs` whose `meta->>'flow'` isn't `contributor`, contribute from contributor `designs` (Decision 6 corrected; source corrected in development 2026-10-20).
  - **ai_usage:** per area, calls and the sums of input, output and cached (read) tokens.
  - **errors:** counts per day and per source for the retained 30 days, split by `context->>'kind'`.

  "Last week" means the last 7 days (Decision 4).
- Given `app/admin/usage/page.tsx` (server page with the same standalone layout as `/admin`, which has no `AppShell`; corrected in development 2026-10-20), then it is gated by `isAdmin`, calls the function once through the service-role client, and renders the four sections as read-only tables or tiles, with a link to `/admin/errors`.
- Given `app/admin/page.tsx`, then it links to `/admin/usage`.
- Given a non-admin, then `/admin/usage` redirects as `/admin` does today, and the function can't be called from the browser.
- Given the figures, then they are computed when the page opens, with no auto-refresh, export, charts or date picker (Decision 9). Costs in money are not shown.

**Test Plan:**
- *Positive:*
  - As `admin`, open `/admin/usage`. All four sections show.
  - Cross-check each figure with a direct SQL count in the dev project: total users, new in 7 days, conversations per area, `ai_usage` sums per area, and `sys_errors` per day and per source.
- *Edge cases:*
  - A fresh dev project with no `ai_usage` and no `sys_errors` rows: the sections show zeros or "No data yet", not an error.
  - A user active only in Explore (signed in) counts as active.
  - A user who only signed up and never did anything is counted in total and new, but not active.
  - A pathway slug in both the static corpus and `published_pathways` is counted once.
- *Negative cases:*
  - As `adopter`, `pathway_contributor` and signed out, open `/admin/usage`. Each is redirected the way `/admin` redirects them.
  - With the anon key, `rpc('admin_usage_stats')` from the browser console is denied.
  - Make the function fail (e.g. revoke service-role execute in dev). The page shows the generic error page (MLC-03) and an unexpected row is logged.
- *Non-functional:*
  - The page loads in under 2 seconds on the dev data set.
  - Check the layout at laptop width and on a phone with Cube's brand tokens.

---

### MLC-11: `/admin/errors` recent-errors list

**As a** system administrator
**I want** a read-only list of the latest errors, with the full trace one click away
**So that** I can see what failed, where, when and for whom

**Priority:** P1 · **Depends on:** MLC-01

**Acceptance Criteria:**
- Given `app/admin/errors/page.tsx` (server page with `/admin`'s standalone layout, gated by `isAdmin`), then it lists the latest 50 `sys_errors` rows newest first, showing:
  - time
  - source
  - kind
  - message
  - user (email resolved through the service-role client when `user_id` is set, else "—")
  - environment
  - the context IDs
- Given each row, then the stack is inside a collapsed `<details>` element (Decision 1).
- Given `/admin/usage`, then its errors section links here (requirement item 5).
- Given a non-admin, then the page redirects as `/admin` does.

**Test Plan:**
- *Positive:*
  - As `admin`, trigger one expected error and one unexpected error (as in MLC-02), then open `/admin/errors`. Both appear at the top with the right kind; the stack expands on click.
- *Edge cases:*
  - Zero rows: a "No errors recorded in the last 30 days" message.
  - A row whose user has deleted their account shows "—".
  - 60 rows: only the newest 50 show.
- *Negative cases:*
  - As `adopter`, open `/admin/errors`. Redirected.
  - No message or stack is rendered as HTML (inject `<script>` in a test error message; it shows as text).
- *Non-functional:*
  - A long stack doesn't break the page layout (it wraps or scrolls inside its container).

---

### MLC-12: Remove the dropped-table code (TD-01)

**As the** Solution Team
**I want** the code that still points at the dropped `pathway_submissions*` tables deleted
**So that** nobody is misled by it and no request can hit a "relation does not exist" error

**Priority:** P2 · **Depends on:** MLC-02 (so the deleted routes' 404s are logged cleanly)

**Acceptance Criteria:**
- Given the codebase, then these files are deleted:
  - `app/api/admin/pathway-submissions/review/route.ts`
  - `app/api/admin/pathway-submissions/publish/route.ts`
  - `app/api/pathway-submissions/push/route.ts`
  - `lib/pathway-submission-versions.ts`
  - `components/PathwaySubmissionsPanel.tsx`
- Given the stale comments in `lib/system-prompts.ts` (~L601, ~L881), `lib/wiki-content.ts` (~L30) and `lib/adoption-conversation.ts` (~L53, ~L702), then they no longer describe the retired submissions flow as live.
- Given the app, then it builds, and `/admin` renders as today (it never used `PathwaySubmissionsPanel`).

**Test Plan:**
- *Positive:*
  - `npm run build` succeeds.
  - As `admin`, `/admin` shows roles, registrations and pathways as before.
- *Edge cases:*
  - `grep -rn "pathway_submission\|PathwaySubmission\|pathway-submission" app lib components` finds only intentional historical notes, if any.
- *Negative cases:*
  - `curl -X POST /api/pathway-submissions/push` and both admin submission routes return 404.
- *Non-functional:*
  - No migration is needed: the tables are already dropped (migration 0018).

---

### MLC-13: Remove the unused `plan-document` and `pathway-exec-summary` modes

**As the** Solution Team
**I want** the two chat modes nothing calls removed, with their prompts
**So that** the chat route only carries modes that are used

**Priority:** P2 · **Depends on:** MLC-12 (the exec-summary prompt belongs to the retired submissions flow)

**Acceptance Criteria:**
- Given `app/api/chat/route.ts`, then `'plan-document'` and `'pathway-exec-summary'` are removed from `MODES` and their branches (~L180, ~L201) are deleted.
- Given `lib/system-prompts.ts`, then `planDocumentSystemPrompt` (~L750) and `pathwaySubmissionExecutiveSummarySystemPrompt` (~L887) are deleted, along with any helper used only by them.
- Given a request with either mode, then it gets 400 "Unknown mode.", logged as expected.

**Test Plan:**
- *Positive:*
  - 💲 One turn in each remaining mode still works:
    - `companion` (both flows)
    - `analysis-doc`
    - `executive-summary`
    - `extract-insights`
    - `pathway-draft`
    - `library`
    - `asset-reuse`
- *Edge cases:*
  - `grep -rn "plan-document\|pathway-exec-summary\|planDocumentSystemPrompt\|pathwaySubmissionExecutiveSummarySystemPrompt" app lib components` finds nothing.
- *Negative cases:*
  - As `adopter`, `curl` `/api/chat` with `mode: 'plan-document'`. 400 "Unknown mode.", and no `ai_usage` row.
- *Non-functional:*
  - The build passes with no unused-import warnings.

---

### MLC-14: Remove `<deliverable>` handling

**As the** Solution Team
**I want** the unused `<deliverable>` tag handling removed
**So that** the chat client has one less special case (no prompt emits the tag any more)

**Priority:** P2 · **Depends on:** MLC-04 (both edit the chat clients; do MLC-04 first to avoid conflicts)

**Acceptance Criteria:**
- Given `lib/grid-update.ts`, then `DELIVERABLE_START`/`DELIVERABLE_END` and their parsing helpers are removed.
- Given `lib/adoption-conversation.ts` (~L2041) and `components/ChatPanel.tsx` (~L43), then the deliverable state and branches are removed.
- Given the `app/api/chat/route.ts` comment around `max_tokens` (~L228), then it no longer refers to `<deliverable>`. The `companion` `max_tokens` of 8192 stays.
- Given Analyse and Contribute conversations, then replies, the grid, the Analysis Document and the Executive Summary work as before.

**Test Plan:**
- *Positive:*
  - 💲 As `adopter`, hold a short companion conversation and generate an Analysis Document and an Executive Summary. Both render and save as before.
  - 💲 As `pathway_contributor`, run a companion turn and a draft.
- *Edge cases:*
  - `grep -rni "deliverable" app lib components` returns nothing (or only unrelated words).
  - Reopen an old saved conversation created before the change. It renders without errors.
- *Negative cases:*
  - Manually paste a reply containing `<deliverable>…</deliverable>` into a test message. It shows as plain text, the accepted tradeoff in the plan.
- *Non-functional:*
  - Invariant check: grid updates still arrive only through `<grid_update>` parsing.

---

### MLC-15: Remove `AdoptionPlanModal`'s modal mode

**As the** Solution Team
**I want** the never-used modal layout removed, leaving the panel layout
**So that** the component has one layout to maintain

**Priority:** P2 · **Depends on:** None

**Acceptance Criteria:**
- Given `components/AdoptionPlanModal.tsx`, then the `mode` prop (L27, L144) and the modal branch (~L198 onwards) are deleted, and the panel layout is the only render path.
- Given `components/AdoptionWorkspace.tsx` (L395), then it no longer passes `mode="panel"`.
- Given `components/PathwayDocumentPane.tsx`, which references the component, then it still compiles and behaves the same.

**Test Plan:**
- *Positive:*
  - As `adopter`, open the adoption plan side panel in `/analyse`. It looks and works as before, including resizing.
- *Edge cases:*
  - Open and close the panel repeatedly, and open it on a narrow screen. No layout regressions.
- *Negative cases:*
  - `grep -rn "mode=\"modal\"\|mode === 'modal'" components app` finds nothing. TypeScript fails the build if any caller still passes `mode`.
- *Non-functional:*
  - The PDF download from the panel (`lib/adoption-plan-pdf.ts`) still works.

---

### MLC-16: Library reads published pathways only (static-corpus code removed)

> **Changed 2026-10-20 (business Q30–Q33):** the library reads the grounding corpus (`content/wiki/pathways/`) + `published_pathways` through `lib/library-documents.ts`, with Source Trace stripped. Data Dhara and CEEW were moved into the grounding corpus, and the cards are unchanged. The ACs below that require DB-only reads and an 8-slug published check are superseded.

**As a** library visitor
**I want** the library chat to read only the published pathways
**So that** there is one source of truth and the library never shows an out-of-date duplicate

**Priority:** P2 · **Depends on:** MLC-06; the Program Team publishing Data Dhara and CEEW Climate Intelligence (Decision 13)

**Acceptance Criteria:**
- Before merging, all 8 slugs in `content/library-wiki/pathways/` exist in `published_pathways`. Record the check (a SQL query and its result) in the PR. If any are missing, the story waits.
- Given `lib/library-wiki-loader.ts`, then:
  - `readLibraryPathwayDocument(id)` reads `published_pathways.content` by slug
  - `buildLibraryOverview()` builds from `published_pathways` only
  - the `readdir`/`readFile` of `content/library-wiki/` and `LIBRARY_WIKI_DIR` are removed
- Given `lib/slug.ts`, then its comment no longer refers to `content/library-wiki/pathways/`.
- Given `/api/chat` `library` mode, then an unknown slug still returns 404 "Unknown pathway.", and a published one is answered.
- Given the folder itself, then it is **not** deleted in this story (that's MLC-20).

**Test Plan:**
- *Positive:*
  - 💲 Signed out, chat with each of the 8 pathways and the general library chat. Each answer is grounded in the published version.
  - As `admin`, publish a new pathway. It is chat-able in the library immediately, with no redeploy.
- *Edge cases:*
  - For one of the five diverged pathways, ask a question whose answer differs between the folder copy and the published copy. The answer follows the published copy.
  - Temporarily rename `content/library-wiki/` locally. The library still works, proving no code reads it.
- *Negative cases:*
  - Ask for an unknown slug (`pathwayId: 'not-real'`). 404 "Unknown pathway.", logged as expected.
  - An invalid slug (`../etc/passwd`) still fails `isValidSlug` with a 404.
- *Non-functional:*
  - Coupling check: no new reference between the grounding corpus (`content/wiki/pathways/`) and the library.

---

### MLC-17: Remove the duplicate `parseFrontmatter` and the unused `diff` package

**As the** Solution Team
**I want** the admin publish step to use the shared header parser, and the unused `diff` package removed
**So that** the two parsers can't drift apart and the install is smaller (business Q29; TD-10)

**Priority:** P2 · **Depends on:** None

**Acceptance Criteria:**
- Given `app/api/admin/pathways/publish/route.ts`, then:
  - the private `parseFrontmatter` (L11) is deleted
  - the route imports `parseFrontmatter` from `lib/strip-frontmatter.ts`
  - the field reads around L72 are adapted to the shared `PathwayFrontmatter | null` shape, with a null result handled as today's empty case
- Given a pathway published after the change, then its `published_pathways` row has the same title, sector, use case, organisation and other header fields as a pathway published before the change with identical content.
- Given `package.json`, then `diff` is removed and `package-lock.json` is updated. Nothing imports it.

**Test Plan:**
- *Positive:*
  - Before the change, as `admin`, publish a test pathway on dev and export its `published_pathways` row. After the change, delete it, publish it again and compare the rows field by field: identical.
- *Edge cases:*
  - A pathway with list-valued header fields (e.g. several sectors) gives the same arrays as before.
  - A pathway with no header block publishes the same way as before.
- *Negative cases:*
  - A pathway with a malformed header block: same behaviour as before the change (record what that is in the PR); no raw error reaches the admin (MLC-02).
  - `npm ls diff` reports that it isn't installed, and `npm run build` succeeds.
- *Non-functional:*
  - **Automated test candidate:** `parseFrontmatter` in `lib/strip-frontmatter.ts` is pure. A fixture test would lock this behaviour in. This is a suggestion only.

---

### MLC-18: Per-mode content loading and in-memory static files

**As a** Cube operator
**I want** each mode to load only the content it needs, and static files read once per server instance in production
**So that** every message does less work, with no change to answers

**Priority:** P2 · **Depends on:** MLC-13, MLC-16

**Acceptance Criteria:**
- Given `lib/wiki-loader.ts` and `lib/wiki-content.ts`, when `NODE_ENV === 'production'`, then static file reads (`content/framework.md`, `content/resources.md`, `content/pathway-generation-prompt.md`, `content/wiki/pathways/*.md`) are memoised at module level. In development they are read from disk each time (architecture Q23).
- Given `published_pathways`, then it is still queried on every request, so a newly published pathway appears immediately.
- Given `app/api/chat/route.ts`, then the blanket `Promise.all([loadWikiContext(), loadFrameworkContent(), loadResourcesContent()])` is replaced by per-mode loading:
  - `extract-insights`: framework only
  - `pathway-draft`: framework and generation prompt
  - `analysis-doc` / `executive-summary`: wiki and framework
  - explorer companion: wiki, framework, resources and toolkit assets
  - contributor companion: wiki and framework
- Given the same input, then the system prompt text each mode builds is byte-for-byte identical to before.

**Test Plan:**
- *Positive:*
  - Locally, temporarily log a hash of `systemPrompt` per mode before the change, run one request per mode, then repeat after the change. The hashes match. Remove the log afterwards.
  - Run `npm run build && npm start` (production mode) and send two requests. A temporary read counter shows each static file read once.
- *Edge cases:*
  - As `admin`, publish a pathway while a production-mode server is running. The next companion turn includes it.
  - Edit `content/framework.md` under `npm run dev`. The change shows on the next request (no memoisation in dev).
- *Negative cases:*
  - Delete a static file locally. The mode that needs it fails with the generic message and an unexpected log row; modes that don't need it still work.
- *Non-functional:*
  - Note the time-to-first-token for `extract-insights` before and after in the PR. It should drop, since the wiki is no longer loaded.

---

### MLC-19: Prompt caching

**As a** Cube operator paying for AI calls
**I want** the large, unchanging part of each prompt cached between turns
**So that** repeat turns cost less and start faster, with no change to Cube's answers

**Priority:** P2 · **Depends on:** MLC-08 (a few days of baseline `ai_usage` data), MLC-18

**Acceptance Criteria:**
- Given each live builder in `lib/system-prompts.ts`, then it returns `{ stable, variable }`:
  - **stable:** framework, corpus, and the resources and toolkit assets the mode uses, plus the library pathway document for `library`
  - **variable:** grid, meta, `generatedAt`, version
- Given `app/api/chat/route.ts`, then `system` is sent as `[{ type: 'text', text: stable, cache_control: { type: 'ephemeral' } }, { type: 'text', text: variable }]`, and a second `cache_control` breakpoint is set on the last message's content block (architecture Q22).
- Given check-similar, then it stays uncached.
- Given repeat turns in a conversation within 5 minutes, then `ai_usage.cache_read_tokens` is above zero.
- Given a fixed set of sample questions per mode (at least 3 per mode, saved in the PR description), then the answers before and after are equivalent in substance. In particular, absence framing, the matching rule and the hiding of the Source Trace appendix from adopters are unchanged.
- Given an admin publishes a pathway, then the next turn includes it. The stable text changed, so a new cache entry is written.

**Test Plan:**
- *Positive:*
  - 💲 As `adopter`, send 3 companion turns in a row. The first row shows `cache_creation_tokens > 0`; the 2nd and 3rd show `cache_read_tokens > 0`.
  - 💲 Repeat for a library pathway chat and for `pathway-draft`.
  - Compare average input cost per turn with the MLC-08 baseline on the Usage page, and record the result.
- *Edge cases:*
  - Wait more than 5 minutes between turns. The next turn writes the cache again (`cache_creation_tokens > 0`).
  - `extract-insights` (framework only) still exceeds the 1,024-token cache minimum. If it doesn't, document that it stays uncached.
  - A `general_user` (pending): still 403 before any Claude call, with nothing cached.
- *Negative cases:*
  - 💲 Ask a question with no corpus match. The absence statement is still plain, not softened (business rule 3).
  - 💲 Ask an Analyse question that would draw on a pathway's Source Trace. The appendix is still not shown to the adopter (business rule 4).
  - A malformed `cache_control` (tested locally) produces the generic message and an unexpected log row, not a raw Anthropic error.
- *Non-functional:*
  - This is the riskiest change for answer quality, which is why it ships last. Get Program Team sign-off on the sample-question comparison before deploying to production.

---

### MLC-20: Delete `content/library-wiki/`

> **Done 2026-10-20**, following business Q30–Q33. No Program Team publishing step was needed, because the grounding-corpus versions are used.

**As the** Solution Team
**I want** the duplicate library folder deleted
**So that** only one copy of each library pathway exists

**Priority:** P2 · **Depends on:** MLC-16; Program Team confirmation that the published version of each of the 5 diverged pathways is correct (Decision 13)

**Acceptance Criteria:**
- Given the Program Team's written confirmation (linked in the PR), then `content/library-wiki/` is deleted.
- Given the app, then no code or build step references the folder.

**Test Plan:**
- *Positive:*
  - `npm run build` succeeds. 💲 The library chat works for all 8 pathways.
- *Edge cases:*
  - `grep -rn "library-wiki" app lib components` returns only the loader's filename, if it is kept, and no path to the folder.
- *Negative cases:*
  - If the confirmation is missing, the PR isn't merged.
- *Non-functional:*
  - The repo is smaller; nothing else.

---

### MLC-21: Refresh the wiki

**As a** future engineer or AI agent working on Cube
**I want** the wiki to reflect the new tables, the removed code and the single library corpus
**So that** the next feature isn't planned from out-of-date docs

**Priority:** P2 · **Depends on:** MLC-01 to MLC-19 (and MLC-20 if done)

**Acceptance Criteria:**
- Given the `llm-wiki` skill is re-run, then the wiki covers:
  - `sys_errors`, `ai_usage` and `rate_limits` (with 0035–0038 in `application/database.md`)
  - `/admin/usage` and `/admin/errors`
  - `/api/errors/client`
  - the 7 remaining chat modes
  - the new env vars
  - TD-01, TD-02 (folder deleted or not), TD-05 (still open), TD-10 and TD-15 (rate limit added) updated in `knowledge/technical-debt.md`
  - Sheets removed from `integrations/third-party-integrations.md`
- Given `CLAUDE.md`'s table, then any page names it links still exist.

**Test Plan:**
- *Positive:*
  - Spot-check five wiki claims against the code.
- *Edge cases:*
  - If MLC-20 hasn't run, the wiki says the folder still exists but is unused.
- *Negative cases:*
  - `grep -rn "googleapis\|plan-document\|pathway-exec-summary" docs/wiki` returns nothing, or only historical notes.
- *Non-functional:*
  - None.

---

## Not covered by these stories

- **Renewing the Anthropic account (TD-16, expires 28-Oct-2026).** A procurement action. Every 💲 test depends on it.
- **Revoking the Google Cloud service-account key** and restricting access to the existing Sheet (architecture Q24). The user handles this outside this work.
- **Enabling `pg_cron`** for the purge. The opportunistic purge in MLC-01 works without it.
- **Automatic retry on Anthropic calls (TD-05),** email alerts, a health page, AI cost in money, and limits on the Analyse and Contribute chats. All out of scope in the requirement.
- **Deferred cleanup:** the Explore chat's separate renderer (TD-14), hard-coded brand colours (TD-11) and `SHOW_ORG_FILTER` (TD-13, a product decision).
- **Standing up an automated test framework (TD-03).** MLC-01, MLC-06, MLC-08 and MLC-17 flag good first candidates, but no story builds the framework.
- **Server-component render errors** are recorded with less detail (digest only) when they don't come from data fetching (plan → Risks).
