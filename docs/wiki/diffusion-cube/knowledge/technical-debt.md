# Technical Debt

Single register for all debt, bugs, limitations, and architectural risks in this repository. Every entry was re-verified against the code at HEAD `0a1ca00` (plus the uncommitted prompt-rule changes) on **2026-11-06**. Resolved items keep their `TD-XX` anchor (other pages link to them) and say what resolved them.

Inputs: code and migration tracing; the codebase audit in [`docs/audits/2026-10-22/`](../../../audits/2026-10-22/audit-summary.md) (its High findings H1–H4 were closed in commit `8bb17cc`; open Medium/Low findings are carried below as TD-19, TD-21, TD-23–TD-25); and the Product Charter. The only `TODO`-style marker in `app/`/`lib/`/`components/` is a "TEMPORARY dev-only diagnostic" in `app/api/chat/route.ts` (see TD-25).

## Summary Register

### P0 — Critical

*(none identified)*

### P1 — High

| ID | Debt | Impact | Remediation |
|---|---|---|---|
| [TD-16](#td-16) | **Operational**: the Anthropic API account was recorded as a free grant expiring **28-Oct-2026** (now passed); the AWS account expires **December 2026** | If the Anthropic account lapsed unrenewed, every AI feature fails (chat, classifier, check-similar, seed). Renewal status can't be seen from code | Confirm with the account holder that `ANTHROPIC_API_KEY` is on a renewed/paid account; finish the AWS replacement plan (due Nov-2026). See [`../operations/deployment.md#operational-dependency-risk-from-the-product-charter`](../operations/deployment.md#operational-dependency-risk-from-the-product-charter) |
| [TD-17](#td-17) | Pathway content now exists **only in Supabase** (no Git copy since `0042`), with no export/backup tooling in the repo; `0042` itself drops the old `published_pathways` table and its rows | A lost/corrupted project, a bad delete, or running `0042` without a backup loses contributor pathways for good | Confirm Supabase backup/PITR (incl. Storage), back up before `0042`, add a periodic export of published versions. See [`../operations/disaster-recovery.md`](../operations/disaster-recovery.md) |

### P2 — Medium

| ID | Debt | Impact | Remediation |
|---|---|---|---|
| [TD-03](#td-03) | **Partially resolved.** A Vitest suite now exists (~105 test files), but CI runs no tests, lint or typecheck before deploying | A regression merged to `main` deploys straight to production | Add `npm test`, `npm run lint` and `tsc --noEmit` steps to `.github/workflows/deploy.yml` (or a separate PR workflow) |
| [TD-05](#td-05) | No app-level retry/timeout policy on Anthropic calls (only the SDK's implicit defaults); nothing retries a reply that fails mid-stream | Intermittent API errors still surface as the generic error; timeouts default to the SDK's 10 min | Set explicit `maxRetries`/`timeout` on the three Anthropic clients; decide on a mid-stream policy |
| [TD-08](#td-08) | Root docs stale: `ARCHITECTURE.md` (static corpus, `content/library-wiki/`, `published_pathways` table), `README.md`/`AGENTS.md` boilerplate | New contributors or agents form a wrong mental model | Update or retire `ARCHITECTURE.md`; point `README.md` at the wiki |
| [TD-21](#td-21) | Rate limiter trusts the first `X-Forwarded-For` hop | Per-IP limits can be bypassed by a spoofed header where the platform doesn't overwrite it (likely on Docker/AWS) | Take the client IP from a trusted, platform-specific header/hop |
| [TD-23](#td-23) | Admin publish publishes the pathway's **latest** version at click time, not the one the admin reviewed | A contributor re-sending for review mid-review can get unreviewed content published | Send the reviewed `version_id` from the admin panel and refuse on mismatch |
| [TD-24](#td-24) | RLS insert policies don't restrict columns (`pathway_contributors`, `contributor_registrations`) | A user can self-insert into `pathway_contributors` (bypassing `/join`'s role check) or create a registration with `access_status='approved'`; neither grants a role | Add `with check` column constraints or move inserts to the service role |

### P3 — Low

| ID | Debt | Impact | Remediation |
|---|---|---|---|
| [TD-06](#td-06) | Historical: silent draft-insert failures before migration `0027` | Already fixed; kept for memory | — |
| [TD-09](#td-09) | `ARCHITECTURE.md` says the grid is "chips, not a table"; `HeatmapGrid.tsx` renders a `<table>` | One stale line (now part of TD-08's wider drift) | Fix with TD-08 |
| [TD-11](#td-11) | Brand hex colours hardcoded in React code (`lib/dimensions.ts`, `app/explore/ExploreLibrary.tsx`, `app/contribute/ContributeGrid.tsx`) instead of `app/globals.css` tokens | Theme changes need multi-file edits | Reference theme tokens (email/PDF copies are structurally necessary) |
| [TD-13](#td-13) | `SHOW_ORG_FILTER = false` in `app/contribute/ContributeGrid.tsx` hides a built feature | Unreachable code | Flip on behind a real flag, or remove |
| [TD-14](#td-14) | `app/explore/ExploreLibrary.tsx` keeps its own bold renderer, textarea and send button, separate from `ChatPanel.tsx` | Fixes to one chat UI don't reach the other | Extract shared primitives if the surfaces keep converging |
| [TD-15](#td-15) | **Mostly resolved.** Rate limits and input caps now cover every `/api/chat` caller; still no PII screening of uploads | Uploaded documents go into prompts and contributor drafts unscreened | Charter backlog item "checking of PII data while ingesting into pathway" |
| [TD-18](#td-18) | `published_pathways` view runs with owner rights (not `security_invoker`) — **intentional** | Supabase's linter flags it; someone may "fix" it and break `/explore`, or add a column that leaks unpublished data | Leave as is; review any change to the view's `select` list carefully |
| [TD-19](#td-19) | `/api/chat`'s `ReadableStream` has no `cancel` handler | Client disconnects likely log spurious `sys_errors` / `ai_usage ok:false` rows | Add `cancel` that aborts the Anthropic stream and skips error logging |
| [TD-20](#td-20) | Model IDs hardcoded per call site: `claude-sonnet-4-6` (chat ×3 call sites, check-similar, seed) and `CLASSIFIER_MODEL = 'claude-haiku-5-5'` (`lib/retrieval.ts`) | A model retirement or upgrade means editing several files; a wrong classifier id silently degrades grounding (fails soft) | Centralise model ids in one module/env var |
| [TD-22](#td-22) | `pathways.status = 'retired'` allowed by `0042` but nothing sets it; delete is the only way to take a pathway down, and it is permanent | No reversible unpublish | Add a retire/unpublish action, or drop the value |
| [TD-25](#td-25) | Remaining open audit Low findings (grouped) | Individually minor | See detail |
| [TD-26](#td-26) | Units saved without vectors after an embedding failure are only re-embedded when the pathway is re-published | Silently weaker search for those pathways until someone notices | Re-embed null-vector units on a schedule or from an admin action |

### Resolved (kept for reference)

| ID | Debt | Resolved by |
|---|---|---|
| [TD-01](#td-01) | Dead code referencing the dropped `pathway_submission*` tables | MLC-12 — routes, `lib/pathway-submission-versions.ts`, `components/PathwaySubmissionsPanel.tsx` deleted |
| [TD-02](#td-02) | Two independently-maintained pathway corpora | MLC-16/20 merged them; since `0042` there are **no pathway files at all** — `content/wiki/` is deleted and every pathway lives in Supabase |
| [TD-04](#td-04) | `contribution_units` built but never written | Migration `0034` + the toolkit-assets feature: the table is now written and read by `lib/toolkit-assets*.ts`, `app/api/toolkit-assets/*`, assemble, publish, delete and account deletion |
| [TD-07](#td-07) | Six pathway files not linked from `content/wiki/pathways/index.md` | Moot — the pathway-storage work deleted `content/wiki/pathways/`; pathways are listed from the database |
| [TD-10](#td-10) | Duplicate `parseFrontmatter` in the admin publish route | MLC-17 |
| [TD-12](#td-12) | Dead `pathwaySubmissionExecutiveSummarySystemPrompt` | MLC-13 |

## Roadmap-Acknowledged Gaps

The Product Charter (`docs/raw_documents/AI DIffusion Cube - Product Charter.docx`) independently names several items on this register as known future work:

| This register's item | Charter's own framing | Status in code (2026-11-06) |
|---|---|---|
| [TD-03](#td-03) | "Creation of test cases across all flows and testing" | Vitest suite in place; not wired into CI |
| [TD-05](#td-05) | "Error handling and graceful degradation (failed AI calls, malformed uploads)" and "defined timeout/retry policy" | Error handling/degradation done; retrieval degrades softly; embeddings retry; no explicit Anthropic retry/timeout policy |
| [TD-15](#td-15) | "Security & Privacy... rate limiting on conversation turns... checking of PII data while ingesting into pathway" | Rate limiting done (per IP anonymous, per account signed-in); PII screening not started |
| Structured logging (see [`../operations/monitoring.md`](../operations/monitoring.md)) | "Structured logging: latency, errors, per-user/per-pathway usage" | Errors (`sys_errors`) and per-area AI usage (`ai_usage`) done; latency and per-pathway usage not started |
| [TD-04](#td-04) | "Enhance the Framework and Pathway schema to enrich the know-how" | `contribution_units` now carries toolkit assets; per-unit search rows live in `pathway_units` (`0042`) |
| Docker/AWS path (see [`../operations/infrastructure.md`](../operations/infrastructure.md)) | "Deployment in AWS environment" | Not started (image builds; no automation) |

## Detailed Register

<a id="td-01"></a>
### TD-01 — Dead code referencing a dropped database table

**Priority:** P1 — **Resolved** (MLC-12)
**Location:** formerly `app/api/pathway-submissions/push/route.ts`, `app/api/admin/pathway-submissions/{publish,review}/route.ts`, `lib/pathway-submission-versions.ts`, `components/PathwaySubmissionsPanel.tsx`

`pathway_submissions`, `pathway_submission_versions` and `pathway_submission_exec_summaries` were dropped by migration `0018`. The five files that still queried them were deleted; nothing imported them. Only historical comments mention the tables now (e.g. `lib/adoption-conversation.ts`). The live contributor flow is assemble → admin publish, now backed by `pathway_versions` (see [`../business/workflows.md#w2--contributor-publish`](../business/workflows.md#w2--contributor-publish)).

<a id="td-02"></a>
### TD-02 — Two independently-maintained pathway corpora

**Priority:** P2 — **Resolved**
**Location:** formerly `content/wiki/pathways/`, `content/library-wiki/pathways/`

First merged by MLC-16/20 (2026-10-20, `content/library-wiki/` deleted). The pathway-storage work then removed the file corpus entirely: `content/` now holds only `framework.md`, `pathway-generation-prompt.md`, `resources.md` and `legal/`, and `lib/library-documents.ts` / `lib/library-pathways.ts` were deleted. Explore, `/wiki` and Analyse all read the same published versions from `lib/pathway-store.ts`.

<a id="td-03"></a>
### TD-03 — Automated tests exist but are not enforced

**Priority:** P2 — **Partially resolved** (was P1 "no tests anywhere")
**Location:** `tests/`, `vitest.config.mts`, `.github/workflows/deploy.yml`

Resolved part: commit `da2c3aa` added a Vitest 3 suite — ~105 test files under `tests/{unit,api,client,db,features,pages,proxy}`, Testing Library + jsdom for components, every external client mocked; `npm test`, `npm run test:watch`, `npm run test:coverage` (v8, to `tests/coverage`). Open part: the only workflow, `deploy.yml`, deploys on push to `main` without running tests, lint or `tsc` (the 2026-10-22 audit also found 3 lint errors and noted CI runs neither). See [`../architecture/testing.md`](../architecture/testing.md).

<a id="td-04"></a>
### TD-04 — `contribution_units` table built, never used

**Priority:** P2 — **Resolved** (by the toolkit-assets feature)
**Location:** `supabase/migrations/0022_contribution_units.sql`, `0025_contribution_units_content.sql`, `0034_contribution_units_toolkit_assets.sql`

Originally a fully-specified table with careful RLS that no code wrote to (the per-contributor GitHub-draft plan it belonged to was abandoned). Migration `0034` added toolkit-asset columns and the `toolkit-assets` bucket, and the table is now live: written/read by `lib/toolkit-assets.ts`, `lib/toolkit-assets-server.ts`, `app/api/toolkit-assets/*`, `app/api/pathways/assemble`, `app/api/admin/pathways/{publish,delete}`, `app/api/contributions/[designId]`, `lib/account-deletion-server.ts` and `app/admin/page.tsx`. Removed from [`legacy-artifacts.md`](legacy-artifacts.md) accordingly.

<a id="td-05"></a>
### TD-05 — No explicit retry/timeout policy on Anthropic calls

**Priority:** P2
**Location:** `app/api/chat/route.ts`, `app/api/pathways/check-similar/route.ts`, `lib/retrieval.ts`, `scripts/seed-pathways.ts`

Re-verified and **reworded**: the earlier "no retry logic anywhere" was imprecise. All four `new Anthropic({ apiKey })` clients leave `maxRetries` and `timeout` unset, so the SDK's defaults apply implicitly — **2 retries with back-off on connection errors, 408, 409, 429 and 5xx, before a response starts**, and a 10-minute timeout (`@anthropic-ai/sdk` 0.106). What is missing is a deliberate policy: nothing is configured or documented, and nothing retries a reply that fails **mid-stream** (the user gets the partial reply + generic message, nothing saved, recorded in `sys_errors` + `ai_usage ok:false`). The retrieval classifier fails soft to a default classification; `check-similar` degrades to `{matchId: null}`.

The repo's first explicit retry logic is in `lib/embeddings.ts`: 2 retries (1 s, 2 s) on `503`/`504`/`546` and dropped connections, 20 s timeout per try. `plan_pathway_storage.md` lists TD-05 under "Not fixed here". The Product Charter names a "defined timeout/retry policy" in its backlog.

<a id="td-06"></a>
### TD-06 — Historical: silent draft-insert failures before migration 0027

**Priority:** P3 (fixed, kept for institutional memory)
**Location:** `supabase/migrations/0027_design_documents_draft_type.sql`

The migration's own comment states every Contributor draft insert had been silently failing the `design_documents.doc_type` check constraint for a real window, so assemble could never find a draft. The class of bug (constraint drift) is the kind the new Vitest suite's `tests/db` tests can catch — but only if CI runs them (TD-03).

<a id="td-07"></a>
### TD-07 — Six grounding-corpus pathway files not linked from the index

**Priority:** P2 — **Resolved (moot)**
**Location:** formerly `content/wiki/pathways/index.md`

`lib/wiki-loader.ts` and `lib/wiki-content.ts` used to discover pathways by parsing `index.md`, leaving six on-disk files invisible. The directory no longer exists; `lib/wiki-loader.ts` now loads only the framework, generation prompt and resources, and `lib/wiki-content.ts` lists published pathways from the database. Whether those six deployments were included in the seed manifest is an operational question, not visible in code.

<a id="td-08"></a>
<a id="td-09"></a>
### TD-08 / TD-09 — Stale reference documentation

**Priority:** P2 (TD-08), P3 (TD-09)
**Location:** `ARCHITECTURE.md`, `README.md`, `AGENTS.md`, `conversation_design.md`

Changed since the last refresh: `CLAUDE.md` was rewritten as a short pointer into this wiki (no longer stale), and `SIGNUP_APPROVAL_OPTIONS.md` is gone from the repo root. Still stale: **`ARCHITECTURE.md`** now describes a corpus that no longer exists — `content/wiki/` "13 pathway docs", `content/library-wiki/pathways/`, `published_pathways` as an RLS'd table that admin publish writes — plus TD-09's "chips, not a table" line (`components/HeatmapGrid.tsx` renders a `<table>`). `README.md` is `create-next-app` boilerplate and `AGENTS.md` holds only the generic Next.js agent rule. `conversation_design.md` (last changed 2026-10-14) predates the retrieval and prompt-rule changes; treat `lib/system-prompts.ts` as the source of truth. See the reconciliation tables in [`../architecture/architecture-overview.md`](../architecture/architecture-overview.md) and [`../business/business-overview.md`](../business/business-overview.md).

<a id="td-10"></a>
<a id="td-12"></a>
### TD-10, TD-12 — Resolved cleanups

TD-10 (duplicate frontmatter parser, MLC-17 — the unused `diff` dependency went too) and TD-12 (dead prompt function, MLC-13, with the unused `plan-document` / `pathway-exec-summary` modes) are resolved.

<a id="td-11"></a>
<a id="td-13"></a>
<a id="td-14"></a>
### TD-11, TD-13, TD-14 — Open UI cleanups

- **TD-11:** hex literals remain in `lib/dimensions.ts`, `app/explore/ExploreLibrary.tsx` and now `app/contribute/ContributeGrid.tsx` (`text-[#8a6b00]` badge colour). `lib/email.ts` / `lib/adoption-plan-pdf.ts` copies are structurally necessary (outside the browser).
- **TD-13:** `SHOW_ORG_FILTER = false` still at `app/contribute/ContributeGrid.tsx:59`.
- **TD-14:** `ExploreLibrary.tsx` still has its own `renderBold`, auto-growing textarea and send button. Removing `lib/library-*` did not touch this; the Library prompts are no longer verbatim ports from the old Diffusion Library app, but the UI duplication remains.

<a id="td-15"></a>
### TD-15 — Security/rate-limiting/PII-screening hardening

**Priority:** P3 — **Mostly resolved**
**Location:** `lib/rate-limit.ts`, `lib/explore-guard.ts`, `app/api/chat/route.ts`

**Done:** anonymous `/api/chat` (Explore) is limited per salted IP (20/min, 200/day) with input caps (≤ 20 messages, visitor messages ≤ 1,000 chars, ≤ 20,000 total); **signed-in `/api/chat` is limited per account in every mode** (`chat-user`, 30/min, 300/day); every non-library request is capped (body ≤ 32 MB → 413, ≤ 500 messages, total text ≤ 800,000 chars → 413) and validated (400); roles are checked per mode by `requiredRole` (closing audit H4); the rate limit runs before body parsing and anonymous 4xx logging is itself rate-limited (closing H3); `0040` stopped every signed-in user reading unreviewed `pathways.content_cache` via REST. **Still open:** no PII screening between an uploaded document and its use in prompts/drafts or in seeded sources; uploads themselves (toolkit assets) are not content-screened; IP spoofing is TD-21.

<a id="td-16"></a>
### TD-16 — Time-sensitive: free-trial Anthropic/AWS account expiry

**Priority:** P1
**Location:** operational, not code — `ANTHROPIC_API_KEY` ([`../architecture/configuration.md`](../architecture/configuration.md)), the Docker/AWS path ([`../operations/infrastructure.md`](../operations/infrastructure.md))

Per the Product Charter's "Dependencies" section, the Anthropic API account was a free grant expiring **28-Oct-2026** and the AWS account a free grant expiring **December 2026** (replacement to be planned by November 2026). As of this refresh (2026-11-06) the Anthropic date has passed; **whether the account was renewed or replaced cannot be determined from the repository**. If it lapsed, every AI-backed feature fails — `/api/chat` (Sonnet), the retrieval classifier (Haiku, fails soft so grounding just weakens), `check-similar`, and `npm run seed:pathways` — and there is no fallback provider. Failures would appear as `unexpected` rows in `/admin/errors` and `ok:false` rows in `ai_usage`. Re-verify with whoever holds the account relationships, then close or re-date this entry.

<a id="td-17"></a>
### TD-17 — Pathway content has no copy outside Supabase; 0042 is destructive

**Priority:** P1 (new)
**Location:** `supabase/migrations/0042_pathway_storage.sql`, `lib/pathway-store.ts`, `app/api/admin/pathways/delete/route.ts`

Before `0042`, Git held the curated corpus and every assembled contributor pathway. Now all pathway versions live only in `pathway_versions`, seeded originals only in the private `pathway-sources` bucket (and wherever the seed operator kept the manifest), toolkit assets only in `toolkit-assets`. `0042` drops the old `published_pathways` table with its rows (business decision Q21) and unpublishes every `pathways` row; admin delete is permanent and cascades everything (TD-22). No export or backup tooling exists in the repo, and whether the Supabase plan backs up Storage objects is not recorded. See [`../operations/disaster-recovery.md`](../operations/disaster-recovery.md) and [`../operations/deployment.md`](../operations/deployment.md#supabase-project-setup-per-environment).

<a id="td-18"></a>
### TD-18 — `published_pathways` view runs with owner rights (intentional)

**Priority:** P3 (informational guard-rail)
**Location:** `supabase/migrations/0042_pathway_storage.sql`

The view is deliberately not `security_invoker`, so anonymous `/explore` can read published pathways exactly as the old table's `using (true)` policy allowed; it filters `status = 'published'` and joins only the published version. Supabase's linter flags it; the migration comment and `plan_pathway_storage.md` (Key Tradeoffs) say **do not "fix" it**. The debt is the guard-rail: any future column added to the view is publicly readable.

<a id="td-19"></a>
### TD-19 — Chat stream has no cancel handler

**Priority:** P3 (open audit Medium, 2026-10-22)
**Location:** `app/api/chat/route.ts`

No `cancel` on the response `ReadableStream`, so a client disconnect likely surfaces as a stream failure — a spurious `sys_errors` row and an `ai_usage ok:false` row without token counts — and the Anthropic stream isn't aborted.

<a id="td-20"></a>
### TD-20 — Model IDs hardcoded per call site

**Priority:** P3 (new)
**Location:** `app/api/chat/route.ts` (`claude-sonnet-4-6`, three call sites + the failure-usage record), `app/api/pathways/check-similar/route.ts`, `scripts/seed-pathways.ts` (`GENERATION_MODEL`), `lib/retrieval.ts` (`CLASSIFIER_MODEL = 'claude-haiku-5-5'`)

There is no longer one model everywhere, and no single place to change them. A retired or mistyped classifier id fails soft (default classification, logged), so it can degrade answer quality for a long time unnoticed. `plan_pathway_storage.md` also lists a pending "Sonnet 4.6 → 5.5 upgrade".

<a id="td-21"></a>
### TD-21 — Rate limiter trusts the first `X-Forwarded-For` hop

**Priority:** P2 (open audit Medium, 2026-10-22)
**Location:** `lib/rate-limit.ts` (`clientIp`)

The code takes the first comma-separated value of `x-forwarded-for` (falling back to `x-real-ip`), with a comment asserting the platform sets it. The audit confirmed on dev that a spoofed header changes the bucket. On Vercel this is probably safe but unverified; behind an AWS load balancer that appends rather than overwrites, the anonymous Explore limit (and the anon-error logging limit) can be bypassed. Signed-in limits are per account and unaffected.

<a id="td-22"></a>
### TD-22 — `retired` status unused; no reversible unpublish

**Priority:** P3 (new)
**Location:** `supabase/migrations/0042_pathway_storage.sql` (`pathways_status_check`), `app/api/admin/pathways/delete/route.ts`

`status` allows `draft | in_review | published | retired`, and readers already exclude `retired`, but no route sets it. Taking a pathway out of the library therefore means deleting it, which also removes its versions, units, sources, contributors, toolkit assets and stored files.

<a id="td-23"></a>
### TD-23 — Admin publish isn't pinned to the reviewed version

**Priority:** P2 (open audit Medium, 2026-10-22, re-verified against the new store)
**Location:** `app/api/admin/pathways/publish/route.ts`, `lib/pathway-store.ts` (`latestVersion`)

The request carries only `pathway_id`; the route publishes `latestVersion(pathway_id)`. If a contributor sends a newer version while the admin is reviewing the older one (via `/api/admin/pathways/document`), the newer, unreviewed version goes live.

<a id="td-24"></a>
### TD-24 — RLS insert policies don't restrict columns

**Priority:** P2 (open audit Medium, 2026-10-22)
**Location:** `supabase/migrations/0016_contributor_registrations.sql`, `0021_pathway_contributors.sql`

Unchanged since the audit: a signed-in user can insert their own `pathway_contributors` row for any pathway (bypassing `/api/pathways/[id]/join`'s role check — and, since `0040`/`0042`, that membership is what grants read access to the pathway's unpublished versions) or a `contributor_registrations` row with `access_status='approved'`. Neither grants a role.

<a id="td-25"></a>
### TD-25 — Remaining open audit Low findings (grouped)

**Priority:** P3
**Location:** various — re-verified as still present on 2026-11-06:

- Leftover "TEMPORARY dev-only diagnostic" `console.log` of the contributor `grid_update` in `app/api/chat/route.ts`.
- `app/admin/page.tsx` calls `listUsers({ perPage: 1000 })` once — no pagination past 1,000 users.
- The send-email hook does not de-duplicate `webhook-id`, so a captured request can be replayed within its 5-minute tolerance.
- `safeNextPath` (`app/login/page.tsx`) doesn't reject control characters (possible open redirect, rated "plausible").
- OTP codes appear in the email subject line (`lib/email.ts`).
- About a dozen FK / RLS-filter columns from migrations `0001`–`0036` lack indexes (`designs.user_id`, `sys_errors.user_id`, `ai_usage.user_id`, …).
- The full conversation incl. base64 images is resent every turn (`toApiMessages`); on Vercel a large one likely hits the platform's request-size limit before the route's 32 MB cap, showing the generic error.
- `seed-pathway` `ai_usage` rows fall into the "analyse" area (`areaFor` has no case for them).
- Stale code comments: `lib/supabase/admin.ts` still mentions `pending_signups`.

<a id="td-26"></a>
### TD-26 — No automatic re-embedding of units saved without vectors

**Priority:** P3 (new)
**Location:** `lib/pathway-store.ts` (`publishVersion`), `lib/embeddings.ts`

By design, an embedding failure during publish stores units with a null embedding (logged as `lib/pathway-store`, `step: embed units`) and search falls back to full text + labels for them. Nothing retries later; the admin panel's publish message mentions it, but the only fix is publishing the pathway again.

## Remediation Roadmap

| Priority | Items | Typical effort |
|---|---|---|
| P1 | **TD-16** (confirm Anthropic account status; AWS replacement) — account/procurement action. **TD-17** (confirm Supabase backups incl. Storage; export job) | Hours (confirmation) to a day (export job) |
| P2 | TD-03 (CI test/lint/tsc steps), TD-05, TD-08, TD-21, TD-23, TD-24 | Each a few hours to a day |
| P3 | TD-09, TD-11, TD-13, TD-14, TD-15 (PII screening — feature-sized), TD-18 (guard-rail only), TD-19, TD-20, TD-22, TD-25, TD-26 | Mostly under a day each; TD-15 is new-feature work |
| Done | TD-01, TD-02, TD-04, TD-07, TD-10, TD-12; audit H1–H4 (commit `8bb17cc`) | — |

## Related Documentation

[`legacy-artifacts.md`](legacy-artifacts.md), [`../architecture/architecture-overview.md`](../architecture/architecture-overview.md), [`../architecture/testing.md`](../architecture/testing.md), [`../integrations/ai-llm.md`](../integrations/ai-llm.md), [`../application/database.md`](../application/database.md), [`../operations/deployment.md`](../operations/deployment.md), [`../operations/disaster-recovery.md`](../operations/disaster-recovery.md), [`../operations/troubleshooting.md`](../operations/troubleshooting.md), [`../business/business-overview.md#roadmap-planned-not-yet-implemented`](../business/business-overview.md#roadmap-planned-not-yet-implemented).

## Source Files

All files named inline above; `docs/audits/2026-10-22/{audit-summary,code-review-report,qa-report}.md`; `docs/features/pathway-storage/plan_pathway_storage.md`; migrations `0018`, `0022`, `0025`, `0027`, `0034`, `0039`–`0042`; `docs/raw_documents/AI DIffusion Cube - Product Charter.docx`.
