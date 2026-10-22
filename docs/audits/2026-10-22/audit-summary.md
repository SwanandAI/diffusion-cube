# Codebase Audit — Summary (2026-10-22)

**Scope:** whole codebase — `app/`, `components/`, `lib/`, `proxy.ts`, `instrumentation.ts`, `scripts/`, `supabase/migrations/0001–0038`.
**Branch / commit:** `monitoring-logging-cleanup` @ `d240a18`.
**Method:** two repo subagents run in parallel — `code-reviewer` (read-only static review) and `qa-tester` (unit tests, in-process route tests, live probes against the local dev server on the DEV Supabase project). Findings below are merged and de-duplicated.

Detailed reports:
- [code-review-report.md](code-review-report.md) — full static review
- [qa-report.md](qa-report.md) — full test-case table, defects, coverage gaps

## Overall

Healthy foundations: every protected route returns 401 unauthenticated, anon access to every private table returns 0 rows, all 21 route handlers use `withErrorHandling`, and the toolkit-asset and monitoring code is careful. The serious issues are structural: where assembled drafts are written, who can spend Claude tokens, and how the new error log can be flooded.

| Check | Result |
|---|---|
| `tsc --noEmit` | PASS — 0 errors |
| `npm run build` | PASS — ~21 s, 37 pages |
| `npm run lint` | FAIL — 3 errors, 8 warnings (`app/analyse/StrengthenWorkspace.tsx:66`, `components/AdoptionWorkspace.tsx:205`, `:211`). CI runs neither lint nor typecheck. |
| QA test suite (scratchpad only, not committed) | 183 tests — 155 pass, 28 fail; every failure is a real code behaviour |

## High

| # | Issue | Where | Evidence |
|---|---|---|---|
| H1 | A contributor pathway's slug can collide with a curated corpus file; assemble then overwrites that file on GitHub before any admin review. A title of "Index" would replace `index.md`, which grounds every Explorer answer. | `app/api/pathways/route.ts:17-31`, `app/api/pathways/assemble/route.ts:109-111` | Found by both agents; unit-tested (SL-08); verified manually |
| H2 | Assembled-but-unpublished pathways are publicly served. `/wiki/[slug]` and library-mode chat read any file in `content/wiki/pathways/` with no `published_pathways` check. `content/wiki/pathways/test-assets-langchat.md` is already there, not in `index.md`, and would be public once this branch deploys. | `lib/wiki-content.ts`, `app/api/chat/route.ts` | File verified present |
| H3 | Unauthenticated callers can flood `sys_errors`: `/api/chat` parses JSON and checks the mode before the rate limit runs; every 4xx is logged via the service role. | `app/api/chat/route.ts:77-87`, `lib/errors.ts:263-266` | Live on dev: 44 bad requests → 44 rows, no 429 |
| H4 | Claude spend is effectively open to any signup. Every signup is auto-granted `adopter`, there is no per-user rate limit or payload cap, `pathway-draft` / `analysis-doc` / `executive-summary` need only *some* role, and a companion call with `flow` omitted skips both role checks. Urgent: the Anthropic trial account (TD-16) expires **28-Oct-2026**. | `app/api/auth/grant-default-role/route.ts:42-43`, `app/api/chat/route.ts:100-118` | In-process tests CH-07 / CH-08 returned 200 |

## Medium

| Issue | Where |
|---|---|
| The per-IP limiter trusts the first `X-Forwarded-For` hop, so it can be bypassed by spoofing the header. Confirmed on dev. On Docker/AWS it is likely exploitable; on Vercel it is probably fine but unverified. | `lib/rate-limit.ts:23-26` |
| Possible path traversal: `getWikiPathway` puts the raw slug into a file path with no `isValidSlug` check. The guard is confirmed missing; exploitability depends on how Next.js decodes `%2F`. | `lib/wiki-content.ts:141`, `app/(app)/wiki/[slug]/page.tsx:15` |
| `slugify` produces slugs that `isValidSlug` rejects (`""` for Hindi or emoji titles, `-1`, leading or trailing `-`); those pathways can never be assembled or published. | `app/api/pathways/route.ts:7-15,97` |
| Admin publish TOCTOU: publish copies whatever `content_cache` holds at click time, not the version the admin reviewed. | `app/api/admin/pathways/publish/route.ts:27-37,59-73` |
| `pathways.content_cache` (unreviewed drafts) is readable through REST by any signed-in account, including accounts with no role. | `supabase/migrations/0020_pathways.sql` |
| `cubeAssessment` fields written by the model are not type-checked; one bad value (e.g. a string where a list is expected) makes every later Explorer turn return 500. | `lib/grid-update.ts:180`, `lib/adoption-conversation.ts:2075-2084`, `lib/system-prompts.ts:272-281` |
| The chat `ReadableStream` has no `cancel` handler, so client disconnects probably log spurious `sys_errors` rows and `ai_usage ok:false` rows without token counts. | `app/api/chat/route.ts:194-209,279-322` |
| Prompts grow without limit: every Explorer turn includes the full corpus `index.md` (~174 KB) plus all published pathways and assets. The Source Trace appendix is not stripped for Explorer modes. | `lib/wiki-loader.ts:84-111`, `app/api/chat/route.ts:257` |
| The full history, including base64 images, is resent every turn; this probably hits Vercel's 4.5 MB request limit and fails with an unhandled 413. | `lib/adoption-conversation.ts:610-623` |
| Deleting a pathway leaves `published_pathways` live and removes its published assets; no route can unpublish. | `app/api/admin/pathways/delete/route.ts:33-43` |
| Contributor attribution (`contributor_org`) and contact-sharing consent are collected but never used. | `app/api/admin/pathways/publish/route.ts`, `lib/wiki-loader.ts:105-108` |
| RLS insert policies don't restrict columns: users can self-insert into `pathway_contributors` (bypassing `/join`'s role check) or create a registration with `access_status='approved'`. Neither grants a role. | migrations `0016`, `0021` |
| About 12 foreign-key and RLS-filter columns lack indexes (`designs.user_id`, `sys_errors.user_id`, `ai_usage.user_id`, …). | migrations 0001–0036 |

## Low (grouped)

- **Bad input returns 500 instead of 400** across about 8 routes: malformed JSON, a `null` body, non-array `messages`, a numeric `title`, or a non-UUID id.
- **`/api/errors/client`:** the 16 KB cap counts UTF-16 characters, not bytes (a 48 KB body was accepted). The whole body is read before the size check, and the caller sets the `path` label.
- **`scrub()` misses some secret formats:** Postgres URL passwords, `sb_secret_…` keys, `Basic` auth, and quoted values containing a space.
- **The send-email hook accepts replays** within its 5-minute window, because `webhook-id` is not de-duplicated.
- **Login redirect:** `safeNextPath` doesn't reject control characters, which may allow an open redirect.
- **Pathway content:** `WikiMarkdown` renders any `https://` link in pathway text as a live link. A `|` in a URL breaks Section 4 table rows. A `### Problem…` sub-heading ends Section 4 early.
- **Results ignored:** assemble and publish ignore whether their `pathways` update succeeded.
- **Pagination:** `listUsers` stops at 1000 users, and the other admin queries are not paginated.
- **Email:** OTP and reset codes appear in the email subject line.
- **Leftover debug code:** a "TEMPORARY dev-only diagnostic" `console.log` is still in the chat route.
- **Unused tables:** `wiki_cache` and `pathway_cache` are still writable by signed-in users.
- **Migrations:** 0017 and 0026 are not idempotent.
- **Parsing:** `parseFrontmatter` keeps YAML quotes. `assetExtension(".pdf")` accepts a file with no base name.
- **Dead code and stale docs:** unused exports in `lib/dimensions.ts`, `lib/email.ts`, `lib/github.ts` and `lib/errors.ts`. Stale comments in `lib/supabase/admin.ts`, `proxy.ts` and `check-similar`. Env vars missing from `.env.example`. The wiki and the agent definitions say 8 chat modes; there are 7.

## Fix first

1. Stop assemble from writing into the served corpus: reserve the static slugs and `index`, write drafts somewhere that isn't served, and serve only `index.md`-listed files plus `published_pathways`. **Remove `content/wiki/pathways/test-assets-langchat.md` before this branch merges.**
2. `/api/chat`: add a per-user rate limit and payload caps, gate the draft and document modes by role, and reject a missing `flow`. Do this before 28 Oct.
3. Rate-limit, or skip logging for, unauthenticated 4xx requests; return 400 for bad JSON.
4. Pin admin publish to the reviewed version (`assembled_design_doc_id` or a hash), and restrict who can SELECT `pathways.content_cache`.
5. Add an `isValidSlug` guard to `getWikiPathway`, fix `slugify`, clear the 3 lint errors, and add `tsc` + `eslint` to CI.

## Not tested

- Wrong-role and non-owner cases with real logged-in users (no test accounts).
- Admin actions that change data.
- Assemble's GitHub commit and real file uploads and downloads.
- Whether Vercel overwrites `X-Forwarded-For`.
- Migrations against a fresh database.
- The frontend.

## Side effects of the audit

All writes went to the DEV Supabase project (`pcpdgu…`) only:
- About 190 `sys_errors` rows from the negative probes.
- Rate-limit counters for the reserved test IP ranges.
- One live Claude call in `library` mode, which produced one `ai_usage` row.

The live project was never contacted, and no source files were changed.
