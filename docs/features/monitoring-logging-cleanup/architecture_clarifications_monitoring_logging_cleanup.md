# Architecture Clarifications: System Error Handling, Usage Monitoring and Technical Cleanup

Technical clarifications (`architecture-plan`). **Answered 2026-10-19.** Business decisions are
in [`business_clarifications_monitoring_logging_cleanup.md`](business_clarifications_monitoring_logging_cleanup.md).

## High-level summary

This file holds the technical questions and answers from the architecture-plan step, plus the decisions made during plan review and development (2026-10-19 to 2026-10-20).

- **Starting point (repo findings).** On 2026-10-19 the code had:
  - no shared error handling or error pages
  - no try/catch around the chat streams
  - no limits on the public Explore chat
  - an `x-user-email` header that could pass straight through from the browser
  - no token-usage capture
  - prompts not structured for caching
  - three corpus loaders reading from disk on every request
- **Core design (Q4–Q25).**
  - **Errors:** one `withErrorHandling` wrapper in `lib/errors.ts` on every route. `sys_errors` is written server-side only, scrubbed, and purged after 30 days.
  - **Usage:** a new `ai_usage` table with one mode→area map (Explore, Analyse, Contribute). The `admin_usage_stats()` function feeds the new `/admin/usage` page; `/admin/errors` lists the latest error rows.
  - **Rate limit:** stored in a Supabase table with hashed IPs, 20/min and 200/day, and fails open if the check can't run.
  - **Header:** `x-user-email` is deleted at the top of `proxy.ts` on every request.
  - **Cost:** prompt caching with a 5-minute TTL, and static files memoised in production.
- **Changed during development.**
  - The rate limit runs before the input guard, and 429s aren't recorded, so a flood can't fill the error table.
  - The Explore 1,000-character cap applies to user messages only.
  - Server render errors are recorded through `instrumentation.ts`.
  - Caching uses a `PROMPT_CACHE_BREAK` sentinel instead of reordering prompts. So far only `companion` and `library` are cached.
  - The library reads the grounding corpus with Source Trace stripped, and `content/library-wiki/` was deleted.
- **Still open.**
  - Whether `pg_cron` is enabled in production is unknown.
  - The Google service-account key stays valid until someone revokes it.
  - The "8 library slugs" open item is superseded by the 2026-10-20 decisions.

## Repo findings these questions are based on

Checked directly against the code on branch `feature/toolkit-assets`, 2026-10-19. The wiki (generated 2026-09-28, lists 32 migrations) is behind the code (34 migrations). Decision: proceed on a direct code scan; refresh the wiki afterwards (Q25).

- **Hosting.** The live path is Vercel (Hobby plan, serverless, plain source deploy via `.github/workflows/deploy.yml`). The Docker/AWS path (`Dockerfile`) exists but is not CI-deployed. A rate limit or cache held in process memory is per instance on Vercel, so it is not reliable.
- **Routes.** There are 26 `app/api/**/route.ts` handlers and no server actions (`'use server'` appears nowhere). Expected errors are returned inline as `Response.json({ error }, { status: 4xx })`. Nothing catches unexpected throws, so an Anthropic or Supabase failure surfaces as a raw Next.js 500.
- **Error pages.** There is no `app/error.tsx`, `app/global-error.tsx` or `app/not-found.tsx`.
- **Streaming.** Both stream loops in `app/api/chat/route.ts` (library at ~L150, the main path at ~L245) have no try/catch. A mid-stream failure leaves the client with a stream that stops partway.
- **Explore client.** `app/explore/ExploreLibrary.tsx:195-200` never checks `res.ok`, so a JSON error body would be rendered as Cube's reply text.
- **Public chat route.** `/api/chat` is in `proxy.ts` `PUBLIC_PATHS`. The route re-checks roles internally for every mode except `library`. Library input today gets only `isValidSlug(pathwayId)` checking. There are no limits on message count, size or shape, and no rate limit.
- **The `x-user-email` header.** `proxy.ts:96-102` sets it only when `user` exists. Otherwise the incoming request headers pass through untouched, so a browser-supplied `x-user-email` reaches the pages. Five pages read it: `(app)/layout.tsx`, `analyse`, `contribute`, `account` and `explore`. `explore` passes it to `isAdmin()`. The proxy matcher covers every path except static assets.
- **Claude call sites.** Two:
  - `app/api/chat/route.ts`: `messages.stream`, 9 modes
  - `app/api/pathways/check-similar/route.ts`: `messages.create` with a forced tool

  No `cache_control` is used anywhere. Token usage is not captured anywhere.
- **Prompt assembly.** The `lib/system-prompts.ts` builders interleave the stable corpus with per-turn values (grid, meta, `generatedAt`) in one string, so the stable part is not a clean prefix. The main path loads `loadWikiContext()`, `loadFrameworkContent()` and `loadResourcesContent()` for every mode, even modes that don't use them (`extract-insights` uses only the framework; `pathway-draft` doesn't use the wiki).
- **Corpus loaders.** Three loaders read files with `fs/promises.readFile` on every call:
  - `lib/wiki-loader.ts` (also queries `published_pathways`)
  - `lib/wiki-content.ts`
  - `lib/library-wiki-loader.ts` (`content/library-wiki/pathways/`, 8 files)
- **Sheets logging.** `lib/logger.ts` exports `logConversation()`, which is called once at `route.ts:253` and uses `GOOGLE_SERVICE_ACCOUNT_JSON` and `GOOGLE_SHEET_ID`. The `googleapis` dependency is used only there.
- **Dead code.** The dropped tables (`pathway_submissions`, `pathway_submission_versions` and `pathway_submission_exec_summaries`) are still referenced by:
  - `app/api/admin/pathway-submissions/{review,publish}/route.ts`
  - `app/api/pathway-submissions/push/route.ts`
  - `lib/pathway-submission-versions.ts`
  - `components/PathwaySubmissionsPanel.tsx`
  - comments in `lib/system-prompts.ts`, `lib/wiki-content.ts` and `lib/adoption-conversation.ts`

  The other dead-code locations:
  - the `plan-document` and `pathway-exec-summary` branches in the route, plus their prompt builders (`planDocumentSystemPrompt`, `pathwaySubmissionExecutiveSummarySystemPrompt`)
  - `<deliverable>` handling across `lib/grid-update.ts`, `lib/adoption-conversation.ts`, `components/ChatPanel.tsx` and `app/api/chat/route.ts` (27 references)
  - the `mode` prop of `components/AdoptionPlanModal.tsx`, which defaults to `'modal'`; its only caller passes `"panel"`
- **Data for the Usage page.** Each of these tables has a `user_id` and a timestamp:
  - `designs` (Analyse)
  - `pathways` (Contribute)
  - `library_conversations` (Explore, signed-in users, migration 0029)

  Registered users live in `auth.users`. A service-role client exists (`lib/supabase/admin.ts`). The admin console is `app/admin/page.tsx`, gated by `isAdmin(supabase, email)`.

## Technical questions

| # | Theme | Question | Answer / decision |
|---|-------|----------|-------------------|
| 1 | Usage (business re-open) | Explore chats are saved for signed-in users (`library_conversations`), contrary to Decision 6 in the requirement. Count them? | **Yes.** Total conversations = Analyse + Contribute + Explore, with a per-area breakdown. Requirement Decision 6 is updated when the plan is approved. |
| 2 | Error UX (business) | Show a short reference code with the generic message? | **No.** The customer's message stays verbatim. |
| 3 | Requirement | Add a "How we'll know it worked" section to the requirement? | **Yes.** |
| 4 | Error log access (parked #5) | Writes server-side only via the service-role client; RLS on with no client policies; reads only from admin pages after `isAdmin`? | **Yes.** |
| 5 | Error classification (parked #1) | A shared `lib/errors.ts` (`logError`, expected-error classes, a `withErrorHandling()` wrapper applied to all 26 routes) rather than per-route try/catch? | **Yes.** |
| 6 | Error scope | "All errors" = every 4xx/5xx our server produces. Supabase sign-in failures happen browser-to-Supabase and are not recorded. Each record is tagged `kind: expected \| unexpected`. | **Yes.** |
| 7 | Browser errors (parked #2) | Add `error.tsx`, `global-error.tsx` and `not-found.tsx`; browser errors go to a public `/api/errors/client` with size caps and the per-IP rate limit? | **Yes.** |
| 8 | Streaming failures (parked #1) | On a mid-stream failure the server errors the stream; the client shows the generic message after any partial text and doesn't save the partial reply as Cube's answer? | **Yes.** |
| 9 | Environment (parked #4) | New `APP_ENV`, falling back to `VERCEL_ENV === 'production'` → prod, else dev? | **Yes.** |
| 10 | Retention | Purge records older than 30 days: `pg_cron`, Vercel Cron, or something else? | **User doesn't know whether `pg_cron` is enabled.** Decided: a SQL function `purge_old_sys_errors()`, called opportunistically from `logError()` at most once per instance per hour. It works on both deploy paths with no scheduler dependency. `pg_cron` can call the same function later if enabled. (Assumption in the plan.) |
| 11 | Scrubbing (parked #3) | `context` restricted to a fixed key list (user_id, mode, flow, pathway_slug, design_id, path, method, status, kind); message capped at 2K and stack at 8K characters; token, JWT and key patterns masked? | **Yes.** |
| 12 | AI usage capture (parked #6) | A new `ai_usage` table, one row per Claude call (user_id, area, mode, flow, input/output tokens, cache read/creation tokens, model, ok), taken from the stream's final message and from check-similar's response? | **Yes.** |
| 13 | Mode → area (parked #6) | Explore = `library`. Analyse = `companion` (explorer flow), `analysis-doc`, `executive-summary`. Contribute = `companion` (contributor flow), `pathway-draft`, `asset-reuse`, check-similar. `extract-insights` goes by its `flow`. | **Yes.** |
| 14 | Figures (parked #7) | One `admin_usage_stats()` SQL function, computed on page load. Active user = any activity in `designs`, `library_conversations`, `pathways` or `ai_usage` in the window. | **Yes.** |
| 15 | Admin pages | New `/admin/usage` and `/admin/errors` (latest 50, stack collapsed), each with its own `AppShell`, linked from `/admin`? | **Yes.** |
| 16 | Rate-limit store (parked #8) | (a) Supabase table + atomic RPC, (b) Upstash Redis, (c) in-memory? | **(a)**, IP stored hashed. |
| 17 | Rate-limit values | Env-configurable; start at 20 requests/min and 200/day per IP; signed-in users included? | **Yes.** |
| 18 | Status codes (parked #9) | 429 for rate limit and 400 for the other checks; also require the first and last message to be from the user? | **Yes.** |
| 19 | Where checks run (parked #9) | In `library` mode before any DB read, covering both the pathway chat and the overview chat; the Explore client checks `res.ok` and shows a plain message? | **Yes.** |
| 20 | `x-user-email` (parked #10) | Delete the header at the top of `proxy.ts` on every request and forward the cleaned headers on every branch, signed in or not? | **Yes.** |
| 21 | Library static corpus (parked #13) | Code reads `published_pathways` only. The code change ships first with a check that all 8 slugs are published; the folder is deleted after the Program Team confirms. | **Yes.** |
| 22 | Prompt caching (parked #11) | Stable block (framework + corpus + resources) first with `cache_control` (5-minute TTL); grid/meta after; a breakpoint on the last message; check-similar not cached (prompt too small)? | **Yes.** |
| 23 | In-memory corpus (parked #12) | Static files memoised at module level in production only; `published_pathways` still read per request; each mode loads only what it uses? | **Yes.** |
| 24 | Sheets removal (parked #14) | Remove `lib/logger.ts`, `googleapis` and the env vars in the same release as the new logging; who revokes the Google Cloud service-account key and restricts the Sheet? | **Just remove the code and env vars.** Key revocation and Sheet access are not part of this work; the user handles the data separately. |
| 25 | Wiki | Regenerate the wiki first, or proceed on the code scan? | **Proceed on the code scan; refresh the wiki afterwards.** |

## Plan-review decisions

- **2026-10-19: plan approved.**
- **2026-10-19: error classification.** Expected = 400/401/403/404/409/429 that Cube returns for the request or the user's state; unexpected = everything else (500). The 11 responses that return raw `error.message`/`String(err)` switch to the generic message.
- **2026-10-19: existing friendly 500 messages** (e.g. "Could not delete your account.") **also switch to the generic message**, following the customer's rule. The user didn't choose before approving, so this is the recommended default. It is reversible per route.
- **2026-10-19: the rate limiter fails open** if its RPC errors, and the failure is logged.
- **2026-10-19: `sys_errors.user_id` and `ai_usage.user_id` use `on delete set null`**, so account deletion anonymises rather than deletes these rows.
- **2026-10-19 (development, MLC-06): two Explore rules adjusted to how the library client works.** Both are recorded in `lib/explore-guard.ts`.
  - **First message:** the "first message must be from the user" rule (Q18) is dropped. An empty history is the pathway kickoff, and every later history starts with Cube's overview (`assistant`). Only the last message must be `user`.
  - **Per-message cap:** the 1,000-character cap applies to `user` messages only. Cube's replies are resent as history and often exceed 1,000 characters; they still count towards the 20,000 total.
  - **Turn count:** a "turn" is counted as one message, so the limit is at most 20 messages.
- **2026-10-19 (development, MLC-02): inline 500 responses kept in route code.** The plan said to replace the ~30 inline `{ error }` 500 returns with a throw or the generic message. Instead, `withErrorHandling` replaces every 5xx body with the generic message, and the route's original text (often the real database error) is kept in the `sys_errors` record. Catch blocks that held a real exception now `throw` so the stack is recorded. `send-email` uses `errorBody: hookError` to keep the Supabase Auth hook format.
- **2026-10-19 (development, MLC-07): `check_rate_limit` is an invoker function, not `security definer`.** Execute is granted only to `service_role`, which bypasses RLS, so definer rights add nothing. The limiter uses fixed minute/day windows, and the `explore` and `client-error` scopes are counted separately.
- **2026-10-19 (development, MLC-03): flood protection for "record all errors".**
  - **Rate limit first.** For `library` (and `/api/errors/client`) the rate limit now runs **before** the input guard (reversing Q19's order). Otherwise an anonymous flood of malformed requests would bypass the limiter, and each 400 would add a `sys_errors` row.
  - **429s not recorded.** `withErrorHandling` does **not** record 429 responses: they're counted in `rate_limits` already, and recording them was the flood vector. This also covers account deletion's "Too many attempts" 429.
- **2026-10-19 (development, MLC-03): server render errors are recorded through `instrumentation.ts` `onRequestError`**, with the original stack. That covers Server Components, Server Actions and the proxy; route handlers are skipped because the wrapper covers them, and so are `NEXT_*` control-flow digests (redirect/notFound). This closes the plan's "digest only" risk. `app/error.tsx`/`global-error.tsx` report only browser-side errors (no `digest`) to `/api/errors/client`, so nothing is recorded twice.
- **2026-10-20 (development, MLC-10): how conversations are counted, corrected.** Contribute conversations are `designs` rows with `meta->>'flow' = 'contributor'`, not `pathways` rows (those are pathway entities). So: Analyse = other `designs`, Contribute = contributor `designs`, Explore = `library_conversations`. "Active" uses `designs`/`library_conversations` `updated_at` plus `ai_usage`. The published-pathway count is computed on the page from `listWikiPathways()` (static + published, deduplicated by slug), so `admin_usage_stats()` takes no parameter.
- **2026-10-20 (development, MLC-10/11): admin pages follow `/admin`'s actual layout.** `/admin` has no `AppShell` (a standalone `min-h-screen` page with a back link), so `/admin/usage` and `/admin/errors` match it instead of instantiating `AppShell` (Q15).
- **2026-10-20 (development, MLC-19): prompt caching without reordering.**
  - The stable content already precedes the per-turn content in every builder. So the plan's `{stable, variable}` split was replaced by a `PROMPT_CACHE_BREAK` sentinel at that boundary, and the text Claude sees is unchanged.
  - Cached for now: `companion` and `library` (system prefix plus a last-message breakpoint, 5-minute TTL).
  - The one-shot modes are uncached pending the owner's decision.
  - The Usage page's input tokens are the total (uncached + cache read + cache write).
  - Shipped before the planned baseline period, on the owner's instruction, because of the 28-Oct Anthropic expiry.
- **2026-10-20 (development, MLC-16/20): one static corpus for the library.**
  - **Loader.** The new `lib/library-documents.ts` replaces `lib/library-wiki-loader.ts`. It reads `content/wiki/pathways/<slug>.md` through `readStaticFile` (memoised in production), with a DB fallback.
  - **Overview.** The general-chat overview covers exactly the card set (`lib/library-pathways.ts` + DB), so it never mentions a corpus file that has no card.
  - **Moved files.** `data-dhara` and `ceew-climate-intelligence` were moved into `content/wiki/pathways/` and linked from `index.md` under new "Data Infrastructure" and "Climate & Public Health" categories (named from each file's tags).
  - **Folder deleted.** `content/library-wiki/` is gone, following business Q30–Q33. Q21's "DB only + 8-slug check" design is superseded.
- **2026-10-20 (development, MLC-16): Source Trace is stripped from every library chat document.** This was a pre-existing gap: the public library chat sent `published_pathways` documents to Claude with their contributor-only Source Trace appendix, and the library prompt has no rule against it (wiki business rule 4).
  - **Fix.** Both static and published documents now go through `stripProvenanceAppendix` (exported from `lib/wiki-content.ts`).
  - **Cost.** Grounding documents are longer than the old library copies (`mahavistaar` is about 10K tokens), so library calls carry more input; prompt caching offsets repeat turns.
- **2026-10-19: cleanup scope extended (business Q29).** Added two items:
  - **TD-10:** `app/api/admin/pathways/publish/route.ts` uses `parseFrontmatter` from `lib/strip-frontmatter.ts`. The return shapes differ, so the call site is adapted.
  - **The unused `diff` dependency** is removed.

  Deferred: TD-11 (brand colours), TD-13 (`SHOW_ORG_FILTER`, a product decision) and TD-14 (the Explore chat renderer).

## Open items

- **`pg_cron` availability** in the production Supabase project is unknown. The plan doesn't depend on it (Q10).
- **The Google Cloud service-account key** behind `GOOGLE_SERVICE_ACCOUNT_JSON` stays valid after the code is removed, unless someone revokes it. Owner: the user.
- **The 8 library slugs.** The Program Team publishes Data Dhara and CEEW and confirms the 5 diverged pathways before `content/library-wiki/` is deleted.
