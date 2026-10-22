# Code Review Report — Full Codebase (2026-10-22)

**Agent:** `code-reviewer` (`.claude/agents/code-reviewer.md`), read-only.
**Branch / commit:** `monitoring-logging-cleanup` @ `d240a18`.
**Summary:** [audit-summary.md](audit-summary.md)

## Scope and method

This was a static review covering:
- every route under `app/api/` (21 handlers)
- `proxy.ts`, `instrumentation.ts` and `next.config.ts`
- all of `lib/`, including `lib/supabase/`
- the auth and gating pages, and the relevant components
- all 38 migrations

`tsc` and `eslint` were run from the local `node_modules/.bin`; nothing was installed.

Not done: `npm audit` (it needs network access), running the app, and browser flows. Findings that depend on runtime or infrastructure behaviour are marked **Plausible**.

## Static checks

- **`tsc --noEmit`:** exit 0, **0 errors**.
- **`eslint`:** exit 1, **11 problems (3 errors, 8 warnings)**.
  - Error: `app/analyse/StrengthenWorkspace.tsx:66:35` — "Cannot access refs during render" (`createdInSessionRef.current`), `react-hooks/refs`.
  - Errors: `components/AdoptionWorkspace.tsx:205:42` and `:211:30` — "Calling setState synchronously within an effect", `react-hooks/set-state-in-effect`.
  - Warnings:
    - `app/api/pathways/route.ts:34`: `req` unused.
    - `app/explore/ExploreLibrary.tsx:133/140/147`: `no-unused-expressions`.
    - `components/AdoptionWorkspace.tsx:225`: `pathwayDocPublishedSlug` unused.
    - `lib/adoption-conversation.ts:2173` and `:2356`: `exhaustive-deps`.
    - `lib/explorer-intents.ts:95`: `_intent` unused.
- CI (`.github/workflows/deploy.yml`) runs neither lint nor typecheck.

## Ranked findings

There are no Critical findings.

| Sev | Location | Issue | Failure scenario | Suggested fix |
|---|---|---|---|---|
| **High** | `app/api/pathways/route.ts:7-31,97`; `app/api/pathways/assemble/route.ts:109-111` | `uniqueSlug` only checks the `pathways` table, never the static corpus filenames. Assemble then overwrites `content/wiki/pathways/<slug>.md` on GitHub, passing the existing file's `sha`. | A contributor creates a pathway titled "Index" or "Blue Dots". Assemble replaces the corpus `index.md` (which drives all Analyse grounding via `parsePathwaySlugs`) or the curated EkStep file. `check-similar` doesn't see static pathways either. | Reserve every static slug plus `index` in `uniqueSlug`, and refuse in assemble when the target file isn't one this pathway created. |
| **High** | `assemble/route.ts:109-111` + repo history | The "assemble ≠ live" rule is porous. Assemble commits go into this same repo, and `/wiki/[slug]` and library-mode chat read **any** file in `content/wiki/pathways/` by slug, with no `published_pathways` check. | Commit `8c2816f "publish pathway: test-assets-langchat"` (a test pathway that only passed assemble) is on this branch. Once deployed, it is publicly chattable at `/explore` and browsable at `/wiki/test-assets-langchat` without any admin publish. | Commit assemble output to a separate path or a non-deployed branch. Serve only `index.md`-listed static files plus `published_pathways`. Remove the test file before merging. |
| **High** | `lib/errors.ts:263-266`; `app/api/chat/route.ts:77-81,100-105`; `proxy.ts:19-45` | Every 4xx from a wrapped route is written to `sys_errors` through the service role. On public routes this happens before any rate limit: chat's `req.json()` parse error (500), unknown mode (400), non-library 403. The same applies to the `toolkit-assets` 401/404s and the `send-email` 401. | An anonymous script loops `POST /api/chat`. Each request writes one row plus a Supabase `getUser` call, with no cap. This bloats `sys_errors` and pushes real errors out of `/admin/errors` (latest 50 only). | Rate-limit before parsing on public paths, or skip recording 4xx for anonymous callers. Sample or aggregate expected errors. Parse JSON safely and return 400. |
| **High** | `app/api/auth/grant-default-role/route.ts:42-43`; `app/api/chat/route.ts:100-118,268-276` | Any self-registered account is auto-granted `adopter`. Non-library modes only check `hasAnyRole`. `messages`, `grid`, `meta` and `existingPublishedDoc` have no size or shape validation, and signed-in users have no rate limit. `pathway-draft` (9000 max tokens), `analysis-doc` and `executive-summary` (about 50k-token uncached prompt) are open to any role. A companion call with `flow` omitted skips both role checks. | Someone signs up with email OTP and scripts `mode=analysis-doc` calls with large `messages`, draining the Anthropic bill and the trial account (TD-16). | Add a per-user `check_rate_limit` keyed on `user_id`. Cap message count and size per mode. Gate `pathway-draft`/`asset-reuse` on `pathway_contributor` and the explorer document modes on `adopter`. Reject a companion call whose `flow` isn't `explorer` or `contributor`. |
| Med | `app/(app)/wiki/[slug]/page.tsx:15`; `lib/wiki-content.ts:141` | `getWikiPathway(slug)` joins the slug into a file path with no `isValidSlug` check, although the library path guards this exact case. **Plausible.** | An approved user requests `/wiki/..%2F..%2FCLAUDE`, and any `.md` file on the server is rendered. | Add an `isValidSlug` check and `notFound()` at the top of `getWikiPathway`. |
| Med | `app/api/admin/pathways/publish/route.ts:27-37,59-73`; `components/AdminPathwayRowCard.tsx:72-76` | TOCTOU: publish only sends `pathway_id` and copies whatever `content_cache` holds at click time. | A contributor re-assembles after the admin opened the review, and unreviewed content goes live. | Send `assembled_design_doc_id` (or a content hash) from the reviewed view, and refuse on mismatch. |
| Med | `supabase/migrations/0020_pathways.sql` | `pathways` (including `content_cache` and `review_requested`) is readable by any authenticated session, including zero-role accounts. | Any signup reads every unpublished assembled document with the anon key. | Restrict SELECT on `content_cache` via a view, column grants, or a contributors/admin-only policy. |
| Med | `app/api/chat/route.ts:194-209,279-322` | The `ReadableStream` has no `cancel` handler. **Plausible.** | Every navigate-away mid-reply produces an "unexpected" `sys_errors` row and an `ai_usage ok:false` row with no tokens. | Add `cancel() { stream.abort() }`, treat an abort as a non-error, and record the usage reached. |
| Med | `app/api/pathways/route.ts:7-15`; `lib/slug.ts` | `slugify` can produce `''`, a leading `-`, or a trailing `-` after `slice(0,80)`. | A Hindi-titled pathway can never be assembled (400 "invalid slug"). | Validate with `isValidSlug` at creation, with a `pathway-<shortid>` fallback. |
| Med | `admin/pathways/publish/route.ts:59-73`; `lib/wiki-loader.ts:105-108`; `lib/contributor-registration.ts:176-182` | `published_pathways.contributor_org` is never written. `share_name`/`share_contact`/`contact_info` are written but never read. | The consent UI promises contributor visibility that never happens. | Set `contributor_org` (and the consented name/email) at publish, or remove the options from the UI. |
| Med | `lib/rate-limit.ts:23-26` | The IP comes from the first `x-forwarded-for` hop. **Plausible** on Docker/AWS, where an ALB appends to a client-supplied XFF. | A random XFF per request bypasses the explore and client-error limits. | Use the last trusted hop or a platform header, and document it. |
| Med | `app/api/admin/pathways/delete/route.ts:33-43` | Delete removes all toolkit assets (including published ones) but leaves `published_pathways` live. There is no unpublish route. | The published library document stays public with broken Section 4 download links. | Add an admin unpublish. On delete, also remove `published_pathways` or keep the published assets. |
| Med | `lib/wiki-loader.ts:84-111`; `app/api/chat/route.ts:257`; `check-similar/route.ts:53-66` | Unbounded prompt growth: the full `index.md` (~174 KB) plus all published pathways and assets on every Explorer turn. Source Trace is not stripped for Explorer modes. | Cost grows linearly until calls fail on the context window. A prompt slip can surface Source Trace data. | Strip Source Trace in `loadWikiContext`, cap or rank the published content, and paginate `check-similar`. |
| Med | `lib/adoption-conversation.ts:610-623` | Every turn resends the whole history, including base64 images and extracted document text. **Plausible.** | Two images exceed Vercel's 4.5 MB limit, and every later turn gets an unhandled 413. | Summarise attachments into meta, drop images from replayed history, and cap the payload server-side. |
| Med | Migrations 0001, 0003, 0010, 0020-0024, 0033, 0035, 0036 | Missing indexes: `designs.user_id`, `designs.pathway_id`, `design_documents.user_id`, `adoption_queries.(user_id,design_id)`, `pathway_contributors.user_id`, `contribution_units.(user_id,design_id)`, `pathways.(created_by, assembled_design_doc_id, published_design_doc_id)`, `published_pathways.published_by`, `contributor_registrations.org_id`, `sys_errors.user_id`, `ai_usage.user_id`. | RLS-scoped reads scan whole tables, and account-deletion cascades slow down as the logs grow. | Add one additive migration (0039) with these indexes. |
| Low | `0016` insert policy + `lib/contributor-registration.ts:78` | The client insert to `contributor_registrations` can set any column. | `access_status='approved'` shows as Approved in the admin panel. No privilege gain. | Move the insert server-side, or add a `WITH CHECK`. |
| Low | `0021` insert policy | Any authenticated user can insert their own `pathway_contributors` row with any `org_id`/`role`. | Org attribution can be spoofed. No escalation. | Drop the client insert policy and use the service role in `/join`. |
| Low | `0003`, `0010`, `0024` | RLS insert checks only `user_id`, not ownership of `design_id`. There is no unique `(design_id, doc_type, version_number)`. | Rows can be attached to someone else's design, and duplicate version numbers are possible. | Add an `exists(...)` check and a unique index. |
| Low | `app/login/page.tsx:50-53,173,310` | `safeNextPath` doesn't reject control characters. **Plausible.** | `?next=/%09/evil.com` becomes `//evil.com`, an open redirect after sign-in. | Parse with `new URL(next, origin)` and require the same origin. |
| Low | `components/WikiMarkdown.tsx:15` | `ASSET_HREF` accepts any `https://\S+`. | A phishing link inside a published pathway. | Restrict it to the asset download route plus the assets' own `link_url`s. |
| Low | `lib/adoption-conversation.ts:2046-2049`; `lib/grid-update.ts:233-246` | Model-supplied `cells` and `pathwaysReferenced` are unvalidated. | A malformed density value breaks the heatmap, and the `adoption_queries` insert fails silently. | Validate the cell shape, clamp density to 0-3, and filter with `isValidSlug`. |
| Low | `app/api/chat/route.ts:186,268` | Anthropic validation errors arrive after a 200 has been sent. | The client gets a broken stream, recorded as "unexpected". | Await the first stream event before returning. |
| Low | `app/admin/page.tsx:32` | `listUsers({perPage:1000})`, and the other admin queries are unpaginated. | Users past the 1000th disappear from role management. | Paginate. |
| Low | `app/api/errors/client/route.ts:16-17` | `req.text()` reads the whole body before the 16 KB check. | Memory use is bounded only by the platform body limit. | Check `content-length` first. |
| Low | `lib/organisations.ts:39` | An unescaped `.ilike` means `%`/`_` act as wildcards. | An org named `%` matches an arbitrary existing org. | Escape `%`/`_`, or compare on `lower(name)`. |
| Low | `assemble/route.ts:114-118`; `publish/route.ts:80-83` | `pathways` update results are ignored. | GitHub has new content while `content_cache` is stale. | Check the error and return 500. |
| Low | `app/api/chat/route.ts:296-302` | A "TEMPORARY dev-only diagnostic" `console.log` is still in the code. | Dead debug code. | Delete it. |
| Low | `lib/email.ts:115,130,144` | The OTP or reset code is in the email subject. | It is visible in lock-screen notifications and mail logs. | Keep codes in the body only. |
| Low | `0002`, `0004`, `0005` | Inert tables (`pathway_cache`, `wiki_cache`, `pending_signups`); the first two are writable by any authenticated user. | A writable surface nothing reads. | Drop them in a new migration. |
| Low | Migration hygiene | 0017 is not idempotent. 0026's renames and every `create policy` fail on re-run. 0031 and 0032 have no purpose comment. 0007 hard-codes admin emails. 0038 uses `search_path = public, auth`; it is acceptable (only `service_role` can execute it), but `''` plus qualified names is safer. | Replaying a migration breaks. | Use `if not exists` / `drop policy if exists`, and add comments. |

## Dead code and drift (code trusted over the wiki)

**Never referenced:**
- `lib/design-documents.ts` `formatVersionLabel`
- `lib/dimensions.ts` `DIMENSION_CODES`, `DIMENSION_NAMES`, `UnitType`, `DENSITY_SYMBOLS`
- `lib/email.ts` `sendAdminApprovalEmail`, `sendUserApprovedEmail`
- `lib/github.ts` `ghListFiles`
- `lib/library-pathways.ts` `librarySectors`, `libraryTags`
- `lib/errors.ts` `ValidationError`, `AuthError`, `NotFoundError`
- The `contact_info` column (written, never read)

**Error-wrapper convention drift.** `ai-context.md` says routes should throw the typed errors. In fact zero routes do: every route returns `Response.json` 4xx/5xx and relies on the wrapper replacing 5xx bodies. All 21 handlers are wrapped, so there are no leaks.

**Wiki drift:**
- The chat route has **7** modes, not 8 (the `code-reviewer`/`qa-tester` agent definitions say 8; `ai-context.md`'s 7 is correct).
- The wiki and TD-05 say "no retries anywhere", but the Anthropic SDK default `maxRetries: 2` applies. The real gap is that no timeout or `maxDuration` is set for long `pathway-draft` streams.

**Stale comments:**
- `lib/supabase/admin.ts` says the service role is used "only for the signup-approval flow"; it is now used in about 20 places.
- `proxy.ts:14` mentions `/strengthen`.
- `check-similar/route.ts:11-12` cites an `EXTRACT_TOOL` that doesn't exist.
- `lib/grid-update.ts:136-137` says publish triggers the push route directly; it actually opens a consent card.
- `app/(app)/layout.tsx:22` says the gate covers `/admin`; admin is outside the route group.
- The service-role rationale at `app/explore/page.tsx:17-23` is wrong.
- `0022`'s "EDIT BOUNDARY" comment no longer matches what assemble does.

**Product drift.** The admin pending/Reject path is effectively unreachable, because every signup is auto-granted `adopter`.

**Environment variables:**
- `NEXT_PUBLIC_SUPPORT_EMAIL` and `SMTP_SECURE` are used in code but missing from `.env.example`.
- `SUPABASE_DB_URL` is in `.env.example` but unused.
- `supabase/.temp/cli-latest` is tracked.

## Overall health

The code is well commented and consistent, every route is wrapped, and the toolkit-asset and monitoring code is careful: the bucket is private, downloads are streamed, path prefixes are checked, and `SECURITY DEFINER` functions are EXECUTE-restricted. Types are clean.

The weak points are structural:
- The GitHub assemble commit feeds the same corpus the app serves.
- The public `sys_errors` write path can be flooded before any rate limit applies.
- Because every signup becomes an approved user, "any role" checks amount to "any signup" for Claude spend and for reading drafts.
- There are no tests, and CI has no lint gate.

## Top 5 to fix first

1. Close the static-corpus write path, and remove `content/wiki/pathways/test-assets-langchat.md` before this branch merges.
2. Stop unauthenticated `sys_errors` flooding.
3. Add a per-user limit and payload caps on `/api/chat`, and role-gate the document and draft modes (TD-16's trial account expires 28-Oct-2026).
4. Pin admin publish to the reviewed version, and restrict SELECT on `pathways.content_cache`.
5. Add an `isValidSlug` guard to `getWikiPathway` and fix `slugify`. Then clear the 3 ESLint errors and add `tsc` + `eslint` to CI.
