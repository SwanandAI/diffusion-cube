# QA Report — Full Codebase (2026-10-22)

**Agent:** `qa-tester` (`.claude/agents/qa-tester.md`).
**Branch / commit:** `monitoring-logging-cleanup` @ `d240a18`.
**Summary:** [audit-summary.md](audit-summary.md)

**Result:** 17 defects — 1 High, 6 Medium, 10 Low. No unauthenticated data-access path was found: with no session, every protected route returns 401, and the anon key can read no private table and call none of the three locked RPCs.

## Environment and side effects

All writes went to the DEV Supabase project (`pcpdgu…`) only:
- About 190 `sys_errors` rows, a side effect of the negative probes and flood tests.
- Rate-limit counters for the reserved test IP ranges 203.0.113.x, 198.51.100.x and 192.0.2.x.
- One live Claude call in `library` mode, which produced one `ai_usage` row.

The live project (`ixcooe…`) was never contacted. No migrations were applied, nothing was deleted, and no delete, publish or admin-mutation route was called with a session. No real email was sent. No source files were changed.

No acceptance criteria were given, so tests were written against the code's own comments and the wiki pages `api-specification.md`, `testing.md` and `technical-debt.md`.

## How it was tested

- **Unit and in-process route tests:** run with Vitest 3.2.4, which is in `node_modules` as an *extraneous* package (not in `package.json`), using a scratchpad config.
  - 183 tests in total: **155 pass, 28 fail**. Every failure is a real code behaviour.
  - Supabase, Next `after()`, SMTP, the Anthropic SDK and the rate limiter were mocked.
- **Live probes:** run against the dev server on `:3000`.
- **Static checks:**
  - `tsc --noEmit`: PASS.
  - `npm run lint`: FAIL, 3 errors and 8 warnings.
  - `npm run build`: PASS, ~21 s, 37 pages.

The test scripts were not committed. They live in the session scratchpad (`scratchpad/qa/`): `vitest.config.mjs`, `unit/` (the eight test files), `probe-unauth.sh`, `probe-chat.sh`, `probe-ratelimit.sh`, `probe-errors-email.mjs`, `probe-rls.mjs`, and their `.out` files.

## Test-case table

| ID | Area | Type | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|---|
| U01–U20 | Proxy auth, all non-public routes | neg | curl with no cookie | 401 | 401 for all 20 | PASS |
| U21 | Proxy matcher skips `*.png` | edge | `DELETE /api/contributions/<uuid>.png`, no cookie | 401 from the route | 401 | PASS |
| U23/U24 | wiki-pathways | pos/neg | GET, then POST | 200, then 405 | 200, then 405 | PASS |
| U25/U33 | Wrong method | neg | GET on /api/chat and /api/errors/client | 405 | 405 | PASS |
| U26 | toolkit-assets GET | neg | `?ids=garbage,../../x` | `{"assets":[]}` | same | PASS |
| U27/U28 | toolkit-assets POST and upload-url | neg | no session | 401 | 401 | PASS |
| U29–U32 | toolkit-assets DELETE and download, bad id | neg | invalid or nonexistent id | 404 | 404 | PASS |
| U34 | Forged auth cookie | neg | GET /api/pathways | 401 | 401 | PASS |
| C01, C14 | /api/chat with malformed JSON or a `null` body | neg | POST `{bad` / `null` | 400 | **500** | FAIL (D9) |
| C02/C03/C13 | Mode missing, removed, or body is an array | neg | POST | 400 | 400 | PASS |
| C04–C06 | companion, pathway-draft, asset-reuse with no session | neg | POST | 403 | 403 | PASS |
| C07–C10 | library guard: non-array, `system` role, 1001-char message, last message not from user | neg/edge | POST | 400 | 400 | PASS |
| C11/C12 | library traversal `pathwayId` and an unknown slug | neg | POST | 404, no Claude call | 404 | PASS |
| LIVE-1 | library happy path | pos | `blue-dots`, one question | 200 streamed | 200 in 5.3 s, grounded | PASS |
| R1 | library rate limit, fixed XFF | neg | 22 requests | 429 from request 21 | 400×20, then 429×2 | PASS |
| R2/R7 | library limiter vs spoofed XFF | neg | rotate or prepend XFF | still limited | **never 429** | FAIL (D3) |
| R3/R4 | /api/chat unknown mode or malformed JSON flood | neg | 22 from one IP | capped | **never 429**, each one logged | FAIL (D4) |
| R5 | errors/client flood, fixed XFF | neg | 22 | 429 from request 21 | 400×20, then 429×2 | PASS |
| R6 | errors/client flood, rotating XFF | neg | 22 | limited | never 429 | FAIL (D3) |
| E01 | errors/client valid report | pos | POST | 204 | 204 | PASS |
| E02/E03 | 17 KB and 5 MB reports | neg | POST | 400 | 400 | PASS (see D8) |
| E04 | errors/client `null` body | neg | POST | 400/204 | **500** | FAIL (D8) |
| E05/E06 | JSON string body; malformed JSON | edge/neg | POST | 204 / 400 | 204 / 400 | PASS |
| E07 | 16,000 three-byte characters (~48 KB) | edge | POST | rejected | **204 accepted** | FAIL (D8) |
| H01–H04 | send-email: no headers, wrong signature, stale timestamp, tampered body | neg | POST | 401 | 401 | PASS |
| H05–H07 | send-email, valid signature, bad payloads | neg | POST | 400, no email | 400 | PASS |
| RLS-01..17 | Anon SELECT on 17 tables | neg | PostgREST with the anon key | 0 rows (except `published_pathways`) | as expected | PASS |
| RPC-1..3 | Anon calls to the locked RPCs | neg | RPC | 42501 | 401/42501 | PASS |
| STG-1/2 | Anon list and read of the `toolkit-assets` bucket | neg | storage API | nothing returned | `[]` / 400 | PASS |
| XUE | Spoofed `x-user-email` on /explore | neg | header set to the admin address | ignored | ignored | PASS |
| GU-01..22 | `parseGridUpdate` / `stripGridUpdate` | all | malformed, missing, duplicate blocks, etc. | as documented | 22/22. Note: `cells`/`meta`/`pathwayAction` are unvalidated. | PASS |
| SL-01..04 | `isValidSlug`, `slugify` happy path | pos/neg | 20 inputs | — | pass | PASS |
| SL-05/06/07 | `slugify` edge cases (emoji, Devanagari, dashes, 80-char cut) | edge | slugify, then isValidSlug | valid slug | `""`, `"hello-"`, `"-leading-dash"`, `"-1"` | FAIL (D2) |
| SL-08 | Slug vs static corpus files | edge | slugify("Blue Dots"/"MahaVISTAAR"/"Index"/"Data Dhara") | no collision | all four collide | FAIL (D1) |
| ER-01..04, 09–20, 22–26 | `scrub`, `cleanContext`, `withErrorHandling` | all | — | — | pass | PASS |
| ER-05..08 | `scrub` gaps | edge | postgres URL, `sb_secret_`, Basic auth, quoted value with a space | redacted | leaked | FAIL (D10) |
| ER-21 | `withErrorHandling` with a SyntaxError from `req.json()` | neg | — | 400 | 500 | FAIL (D9) |
| RL-01..09 | `clientIp`, `checkRateLimit` | all | — | — | pass | PASS |
| RO-01..05 | Role helpers | all | — | — | pass | PASS |
| EG-01..08 | `isValidExploreConversation` boundaries | boundary | — | — | pass | PASS |
| TA-01, 03–12 | Toolkit-asset helpers | all | — | — | pass | PASS |
| TA-02 | `assetExtension(".pdf")` | edge | — | null | `pdf` | FAIL (D14) |
| S4-01..09, 11, 12, 14 | Section 4 parse and link | all | — | — | pass | PASS |
| S4-10 | Link URL containing `\|` | edge | applyToolkitAssetFiles | 6 pipes | 8 | FAIL (D12) |
| S4-13 | `### Problem…` sub-heading in Section 4 | edge | section4Rows | `['Kit']` | `[]` | FAIL (D12) |
| SP-01, 03, 04, PC-*, AU-01, FM-01..03, CR-01..02 | Prompt builders, cache, frontmatter, sharing | all | — | — | pass | PASS |
| SP-02 | Mistyped `cubeAssessment` | neg | `coveredDimensions` given as a string | no throw | TypeError | FAIL (D5) |
| PC-05 / CH-11 | Non-array `messages`, authenticated | neg | — | 400 | 500 | FAIL (D9) |
| FM-04 | YAML-quoted frontmatter | edge | `title: "Quoted"` | `Quoted` | `"Quoted"` | FAIL (D13) |
| SE-01..10, 12 | send-email in-process | all | — | — | pass | PASS |
| SE-11 | Replaying a signed request within 5 minutes | edge | POST twice | second rejected | second email sent | FAIL (D11) |
| CE-01..03 | errors/client in-process | boundary | — | — | pass | PASS |
| CE-04/05 | UTF-16 size cap; `null` body | edge | — | — | as E07/E04 | FAIL (D8) |
| CH-01..03, 05, 06, 09, 10 | Chat route, mocked | all | — | — | pass | PASS |
| CH-04 | `stream()` throws before streaming | edge | — | 500 plus an ok:false usage row | no usage row | FAIL (D15) |
| CH-07 / CH-08 | companion with `flow` omitted; `pathway-draft` by an adopter-only account | neg | — | 403 | **200, model called** | FAIL (D6) |
| CS-01..04 | check-similar, mocked | all | — | — | pass | PASS |
| CS-05 | check-similar with a numeric title | neg | — | 400 | 500 | FAIL (D9) |
| AUTH-* | Signed-in wrong-role and non-owner probes, authenticated RLS | neg | — | — | needs test accounts | NOT RUN |
| ADM-* | Admin routes beyond the 401 check | all | — | — | needs an admin session; these mutate data | NOT RUN |
| GH/STG-W | assemble GitHub commit; real upload/download | pos | — | — | real writes | NOT RUN |
| MIG | Migration sequence | static | ls | 0001–0038 contiguous | no gap or collision | PASS (static) |

## Defects

**D1 — High: a contributor pathway's slug can collide with a curated corpus file; assemble then overwrites that file on GitHub.**
- Where: `app/api/pathways/route.ts:17-31` — `uniqueSlug` only checks the `pathways` table.
- Then `assemble/route.ts:109-111` overwrites the file on `GITHUB_BRANCH` before any review.
- Repro: SL-08 — "Blue Dots", "MahaVISTAAR", "Data Dhara" and "Index" all collide.
- Fix criteria: given a static `blue-dots.md`, creating "Blue Dots" yields `blue-dots-1`, and assemble never writes to an existing static path.

**D2 — Medium: `slugify` produces empty or invalid slugs, so those pathways can never be published.**
- Where: `app/api/pathways/route.ts:7-15,97`; `assemble/route.ts:77-79` later rejects the slug with 400.
- Repro: SL-05/06/07.
- Fix criteria: any title yields a slug that passes `isValidSlug`, with a `pathway-<shortid>` fallback.

**D3 — Medium (depends on deployment): the per-IP limiter can be bypassed with a spoofed X-Forwarded-For.**
- Where: `lib/rate-limit.ts:23-26`, which takes the first hop.
- Confirmed live on dev (R2, R6, R7). Vercel probably overwrites XFF but this is unverified; on Docker/AWS the first hop is attacker-controlled.
- Fix: use the trusted right-most hop or a platform header.

**D4 — Medium: unauthenticated requests can flood `sys_errors` before the limiter runs.**
- Where: `app/api/chat/route.ts:77-87`.
- Repro: R3/R4 — 44 rows from one IP, no 429.
- Fix criteria: 25 bad requests a minute from one IP give 429 from request 21, with no further rows written.

**D5 — Medium: an unvalidated `cubeAssessment` can break an Explorer conversation for good.**
- Where: `lib/grid-update.ts:180` → `lib/adoption-conversation.ts:2075-2084` → `lib/system-prompts.ts:272-281` (`.join` on a non-array).
- Repro: SP-02.
- Fix: treat non-arrays as `[]`.

**D6 — Medium: role gaps in /api/chat.**
- Where: `app/api/chat/route.ts:111-118`.
- A companion request with `flow` omitted skips the adopter check (CH-07).
- `pathway-draft`, `analysis-doc`, `executive-summary` and `extract-insights` need only *some* role (CH-08).
- Fix criteria: an adopter-only account gets 403 on `pathway-draft`; a general_user gets 403 on companion with no `flow`.

**D7 — Medium/Low: RLS insert policies don't restrict columns (traced only).**
- `0021`: any user can self-insert into `pathway_contributors` with any `org_id`/`role`.
- `0016`: any user can self-insert a registration with `access_status='approved'`.

**D8 — Low: `/api/errors/client` edge cases.**
- A `null` body returns 500.
- The 16 KB cap counts UTF-16 characters, not bytes (48 KB accepted).
- The whole body is read before the size check.
- `path` is caller-controlled.

**D9 — Low: malformed or mistyped JSON returns 500 instead of 400.**
- `/api/chat`, `admin/roles:21`, `admin/reject:17`, `contributor-registrations/approve:22` and `/reject:19`, and `admin/pathways/delete:28` (non-UUID id).
- `title?.trim()` on a non-string title in check-similar and POST /api/pathways.
- Non-array `messages` on authenticated modes.

**D10 — Low: `scrub()` misses some secret formats** (`lib/errors.ts:75-80`): Postgres URL passwords, `sb_secret_…`, `Basic` auth, and quoted values containing a space.

**D11 — Low: send-email accepts replays within 5 minutes.** `webhook-id` is not de-duplicated (`app/api/auth/send-email/route.ts:46-66`).

**D12 — Low: Section 4 edge cases** (`lib/pathway-section4.ts`).
- An unescaped `|` in `link_url` breaks the table row (lines 189, 195).
- A `### Problem…` sub-heading ends Section 4 early (line 50).

**D13 — Low: `parseFrontmatter` keeps YAML quotes** (`lib/strip-frontmatter.ts:26-36`).

**D14 — Low: `assetExtension(".pdf")` accepts a file with no base name** (`lib/toolkit-assets.ts:43-46`).

**D15 — Low: a failure before streaming starts writes no `ok:false` row to `ai_usage`** (`app/api/chat/route.ts:186,268`). Mostly theoretical.

**D16 — Low: unused tables `wiki_cache` and `pathway_cache` still accept authenticated writes** (`0002`, `0004`).

**D17 — Low: `npm run lint` fails** with 3 errors, which would block any future CI lint gate.

## Wiki drift

- `api-specification.md` says `/api/admin/roles` does a raw insert. It now upserts (`app/api/admin/roles/route.ts:38`).
- TD-05 and TD-15 still frame errors as raw 500s, but the new error handling and limiter now exist.

## Coverage gaps

- **Signed-in wrong-role, non-owner and authenticated RLS cases:** there are no test accounts. These were covered only by mocks and code reading.
- **Admin mutations, account delete, assemble's GitHub commit, real storage upload and download:** these are destructive or external writes.
- **Whether Vercel overwrites X-Forwarded-For.**
- **Migrations against a fresh database:** check constraints are untested.
- **The frontend and the `useAdoptionConversation` hook:** there is no frontend test runner.
- **Real Anthropic outages:** only simulated with mocks.

## Recommendations for a minimal test harness

1. Add `vitest` as a declared devDependency with a `test` script. Use a config with an `@/` alias, an `after()` mock, and stubbed env vars.
2. Seed it with the eight scratchpad suites. Move `slugify`/`uniqueSlug` into `lib/slug.ts` so they can be tested.
3. Test route handlers in-process with mocked Supabase and SDK clients.
4. Run RLS tests against `supabase start` with two test users and an admin.
5. Fix the 3 lint errors, then add a CI job for `lint` + `vitest run`, with sign-off before gating deploys.
