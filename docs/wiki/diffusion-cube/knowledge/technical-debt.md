# Technical Debt

Single register for all debt, bugs, limitations, and architectural risks in this repository. No `TODO`/`FIXME`/`HACK` markers exist anywhere in `app/`, `lib/`, or `components/` (verified by repo-wide grep) — every item below was found by tracing actual code and migration history, not by reading inline markers.

## Summary Register

### P0 — Critical

*(none identified — no data-loss or security-critical issue was found)*

### P1 — High

| ID | Debt | Impact | Remediation |
|---|---|---|---|
| [TD-01](#td-01) | Three route files + one lib module + one component reference a table dropped two migrations ago | These endpoints 500 (relation does not exist) if ever invoked; dead code actively misleads anyone searching for "how contributor drafts persist" | Delete `app/api/pathway-submissions/push/route.ts`, both `app/api/admin/pathway-submissions/*` routes, `lib/pathway-submission-versions.ts`, `components/PathwaySubmissionsPanel.tsx` |
| [TD-03](#td-03) | No automated tests anywhere in the repository | Regressions like TD-06 (below) ship silently; no CI gate on correctness | Start with unit tests for pure `lib/` modules, then integration tests for `app/api/` routes — see [`architecture/testing.md`](../architecture/testing.md) |
| [TD-16](#td-16) | **Operational, time-sensitive**: the Anthropic/Claude API access and AWS account this app depends on are both free-trial grants with imminent expiry dates | Claude API expiry (28-Oct-2026) is under a month away as of this wiki's last update — every AI-backed feature in the app would stop working if it lapses unrenewed | Renew/replace the Anthropic account before 28-Oct-2026; plan an AWS account replacement by Nov-2026. See [`../operations/deployment.md#operational-dependency-risk-from-the-product-charter`](../operations/deployment.md#operational-dependency-risk-from-the-product-charter) |

### P2 — Medium

| ID | Debt | Impact | Remediation |
|---|---|---|---|
| [TD-02](#td-02) | Two overlapping-but-separately-maintained pathway corpora (`content/wiki/pathways/` vs `content/library-wiki/pathways/`) share several pathway names | Content drift risk — an update to one copy of "MahaVISTAAR" doesn't propagate to the other | Either consolidate to one corpus with per-surface rendering, or explicitly document (beyond this wiki) that the two are intentionally independent |
| [TD-04](#td-04) | `contribution_units` table fully built (migrations 0022/0025) with correct RLS, never written by any code path | Wasted schema/RLS design; anyone reading the schema alone would assume it's live | Either wire it up (if still intended) or drop it in a future migration |
| [TD-05](#td-05) | No retry logic on any Anthropic API call anywhere in the app | An intermittent API error surfaces as a raw, unhandled 500 to the user on every mode | Add retry/backoff around `anthropic.messages.stream`/`.create`, especially for the un-cached companion mode |
| [TD-07](#td-07) | Six pathway `.md` files on disk in `content/wiki/pathways/` are not linked from `index.md` | Excluded from both prompt-grounding and the `/wiki` browse listing, though still directly reachable at `/wiki/<slug>` — silent, easy-to-miss gap | Link the six files (`ai-advisory-for-dairy-farmers.md`, `ai-assisted-job-matching.md`, `ai-crop-diagnosis-advisory.md`, `assisted-language-math-learning.md`, `nivesh-suvidha.md`, `unififed-ai-driven-agri-ecosystem.md`) from `index.md`, or confirm they're superseded by `published_pathways` rows and remove them |
| [TD-08](#td-08) | Root docs (`CLAUDE.md`, `conversation_design.md`, `SIGNUP_APPROVAL_OPTIONS.md`, `README.md`, `AGENTS.md`) are substantially stale relative to current code | New contributors or AI agents reading these first will form an incorrect mental model | Treat this generated wiki (or `ARCHITECTURE.md`) as current; consider retiring or clearly dating the stale docs |
| [TD-09](#td-09) | `ARCHITECTURE.md` §5 itself contains one stale claim (grid is "chips, not a table") despite `HeatmapGrid.tsx` rendering a literal `<table>` | Even the doc written to correct `CLAUDE.md` has drifted on one detail | Update that paragraph in `ARCHITECTURE.md` |

### P3 — Low

| ID | Debt | Impact | Remediation |
|---|---|---|---|
| [TD-06](#td-06) | Migration `0027`'s own commit documents that every Contributor draft insert silently failed a check constraint for a real prior window | Historical — already fixed, but the class of bug (constraint drift undetected without tests) recurs without TD-03 | Covered by TD-03's remediation |
| [TD-10](#td-10) | Duplicate `parseFrontmatter` logic (`lib/strip-frontmatter.ts` vs. a private copy in `app/api/admin/pathways/publish/route.ts`) | Two implementations can drift silently | Import the shared version in the admin publish route |
| [TD-11](#td-11) | Brand hex colors hardcoded literally in several React components (`lib/dimensions.ts`, `components/AdoptionPlanModal.tsx`, `app/explore/ExploreLibrary.tsx`) instead of referencing the CSS custom properties in `app/globals.css` | Theme changes require updating multiple files; `lib/email.ts`/`lib/adoption-plan-pdf.ts` duplication is structurally necessary (outside the browser pipeline), but the two React components' duplication is not | Reference `app/globals.css` theme tokens from the two ordinary React components |
| [TD-12](#td-12) | `pathwaySubmissionExecutiveSummarySystemPrompt` (`lib/system-prompts.ts`) has no caller anywhere in the codebase | Dead prompt code from the `pathway_submissions`-era architecture | Remove alongside TD-01's cleanup |
| [TD-13](#td-13) | `SHOW_ORG_FILTER = false` hardcoded constant in `app/contribute/ContributeGrid.tsx` disables a fully-built organisation-filter feature for everyone | Built feature sits unreachable | Either flip it on (with a real feature-flag mechanism) or remove the dead branch |
| [TD-14](#td-14) | `app/explore/ExploreLibrary.tsx` has its own fourth, independent markdown/inline-bold renderer, textarea, and send button, not shared with `ChatPanel.tsx` | Real duplication (Library was ported verbatim from a separate standalone app) — a bug fix to one chat renderer won't propagate to the other | Consider extracting shared primitives if the two surfaces continue to converge in behavior |
| [TD-15](#td-15) | No security/privacy hardening: no encryption-at-rest note beyond Supabase's own defaults, no rate limiting on conversation turns or uploads, no PII screening on ingested documents | A single user (or a bug) can currently spam unbounded calls to the Anthropic API through `/api/chat`; uploaded documents are never screened for PII before being folded into corpus-grounding prompts or contributor drafts | Named explicitly in the Product Charter's non-functional backlog (status: Not started) — see [`../business/business-overview.md#roadmap-planned-not-yet-implemented`](../business/business-overview.md#roadmap-planned-not-yet-implemented) |

## Roadmap-Acknowledged Gaps

The Product Charter (`docs/raw_documents/AI DIffusion Cube - Product Charter.docx`) independently names several items on this register as known, already-sequenced future work rather than purely organic discoveries — worth knowing so a reviewer doesn't treat them as surprises:

| This register's item | Charter's own framing | Charter status |
|---|---|---|
| [TD-03](#td-03) (no tests) | "Creation of test cases across all flows and testing" | Not started |
| [TD-05](#td-05) (no Anthropic retry logic) | "Error handling and graceful degradation (failed AI calls, malformed uploads)" and "Reliability & Serving architecture... defined timeout/retry policy" | Not started |
| [TD-15](#td-15) (no rate limiting/PII screening/security hardening) | "Security & Privacy... rate limiting on conversation turns... checking of PII data while ingesting into pathway" | Not started |
| No structured logging beyond `console.error` + Sheets (see [`../operations/monitoring.md`](../operations/monitoring.md)) | "Structured logging: latency, errors, per-user/per-pathway usage" | Not started |
| [TD-04](#td-04) (`contribution_units` built, unused) | Possibly early groundwork toward "Enhance the Framework and Pathway schema to enrich the know-how" | Not started (as a completed enhancement) |
| Docker/AWS path is built but not the live deploy target (see [`../operations/infrastructure.md`](../operations/infrastructure.md)) | "Deployment in AWS environment" | Not started |

## Detailed Register

### TD-01 — Dead code referencing a dropped database table

**Priority:** P1
**Location:** `app/api/pathway-submissions/push/route.ts`, `app/api/admin/pathway-submissions/publish/route.ts`, `app/api/admin/pathway-submissions/review/route.ts`, `lib/pathway-submission-versions.ts`, `components/PathwaySubmissionsPanel.tsx`

`pathway_submissions`, `pathway_submission_versions`, and `pathway_submission_exec_summaries` were all dropped by `supabase/migrations/0018_drop_retired_tables.sql`, replaced by the `pathways` + `design_documents` + GitHub-commit architecture. The five files above still query the dropped tables (`.from('pathway_submissions')` etc.) and would fail at runtime with a Postgres "relation does not exist" error if ever invoked. Confirmed unreferenced from any live UI path — `app/admin/page.tsx` renders `AdminDashboard` + `AdminContributorRegistrationsPanel` + `AdminPathwaysPanel`, not `PathwaySubmissionsPanel`. `CLAUDE.md`'s description of the Contributor's self-serve publish button matches this dead code's intended design, not the current, actually-live two-step assemble/admin-publish flow (see [`../business/workflows.md#w2`](../business/workflows.md#w2--contributor-publish)).

### TD-02 — Two independently-maintained, overlapping pathway corpora

**Priority:** P2
**Location:** `content/wiki/pathways/`, `content/library-wiki/pathways/`

Both directories contain documents for several of the same real deployments (e.g. `mahavistaar.md`, `blue-dots.md`, `bhili-language-enablement.md`, `african-voice-ai.md`, `voice-ai-adoption-barriers.md`, `voice-ai-for-inclusion.md` appear in both). They are structurally and tonally different by design (see [`../integrations/ai-llm.md#two-corpora`](../integrations/ai-llm.md#two-corpora)), but nothing keeps their factual content in sync — an update to one deployment's story in the grounding corpus does not propagate to the Library's copy or vice versa.

### TD-03 — No automated test coverage

**Priority:** P1
**Location:** repository-wide

See [`../architecture/testing.md`](../architecture/testing.md) for the full current-state table. No test files, no runner config, no CI test job, no `test` script exist anywhere.

### TD-04 — `contribution_units` table built, never used

**Priority:** P2
**Location:** `supabase/migrations/0022_contribution_units.sql`, `0025_contribution_units_content.sql`

A fully-specified table with correct, non-trivial RLS (own-drafts-plus-others'-published select, update-own-only, described in its own migration comment as "THE EDIT BOUNDARY") that no application code writes to. Migration `0018`'s comment proposed this table plus per-contributor GitHub draft files as the `pathway_submissions` replacement; migration `0025` then dropped the `git_commit_sha` column that plan depended on, confirming the plan itself was abandoned before this table saw real use. The actual replacement mechanism that shipped is whole-document `design_documents` drafts + a single GitHub commit on assemble. Possibly early, abandoned groundwork toward the Product Charter's "Enhance the Framework and Pathway schema" requirement (status: Not started) — see [`../business/business-overview.md#roadmap-planned-not-yet-implemented`](../business/business-overview.md#roadmap-planned-not-yet-implemented).

### TD-05 — No retry logic on any Anthropic API call

**Priority:** P2
**Location:** `app/api/chat/route.ts`, `app/api/pathways/check-similar/route.ts`

Streaming calls have no surrounding try/catch at all; the one non-streaming call (`check-similar`) catches and swallows failures to a default value but still makes no retry attempt. See [`../integrations/ai-llm.md#response-handling`](../integrations/ai-llm.md#response-handling). The Product Charter independently names both "error handling and graceful degradation (failed AI calls...)" and a "defined timeout/retry policy" in its non-functional requirements backlog, status Not started — this is roadmapped, tracked work, not just an organically-discovered gap.

### TD-06 — Historical: silent draft-insert failures before migration 0027

**Priority:** P3 (resolved, kept for institutional memory)
**Location:** `supabase/migrations/0027_design_documents_draft_type.sql`

The migration's own comment states every Contributor draft insert had been silently failing the `design_documents.doc_type` check constraint (which didn't yet permit `'draft'`) for the entire period between the start of the multi-contributor rework and this migration landing — meaning `/api/pathways/assemble` could never find a draft to commit during that window. Fixed by widening the constraint, but the underlying detection gap (no tests) is TD-03.

### TD-07 — Six grounding-corpus pathway files not linked from the index

**Priority:** P2
**Location:** `content/wiki/pathways/index.md`

`lib/wiki-loader.ts` (prompt grounding) and `lib/wiki-content.ts` (`/wiki` browse listing) both discover pathway files exclusively by parsing `index.md`'s `(slug.md)` links. Six on-disk files are not linked: `ai-advisory-for-dairy-farmers.md`, `ai-assisted-job-matching.md`, `ai-crop-diagnosis-advisory.md`, `assisted-language-math-learning.md`, `nivesh-suvidha.md`, `unififed-ai-driven-agri-ecosystem.md` (note also the unfixed filename typo "unififed"). They remain individually reachable at `/wiki/<slug>` (which reads straight off disk by slug) but are invisible to both the companion's grounding corpus and the `/wiki` index page. Whether they're also present as `published_pathways` rows (and thus reachable via that separate path) cannot be confirmed from the repository alone.

### TD-08 / TD-09 — Stale reference documentation

**Priority:** P2
**Location:** `CLAUDE.md`, `conversation_design.md`, `SIGNUP_APPROVAL_OPTIONS.md`, `README.md`, `AGENTS.md`, `ARCHITECTURE.md` §5

See the reconciliation tables in [`../architecture/architecture-overview.md#reconciliation-with-raw-architecture-documents`](../architecture/architecture-overview.md#reconciliation-with-raw-architecture-documents) and [`../business/business-overview.md#reconciliation-with-raw-business-documents`](../business/business-overview.md#reconciliation-with-raw-business-documents) for the specific claim-by-claim breakdown. `README.md` and `AGENTS.md` are unmodified `create-next-app` boilerplate with zero project-specific content — a new engineer gets no real onboarding from either.

### TD-10 through TD-14

See summary table above — each is a small, independently fixable item (duplicate frontmatter parser, hardcoded brand colors, one dead prompt function, one disabled feature flag, one duplicated chat UI).

### TD-15 — No security/rate-limiting/PII-screening hardening

**Priority:** P3
**Location:** repository-wide (no code to point to — this is an absence)

No rate limiting exists on conversation turns or document uploads through `/api/chat` — a single user or a bug could issue unbounded calls against the Anthropic API. No PII-screening step exists between an uploaded document and its use in corpus-grounding prompts or contributor drafts. Named explicitly, with this exact scope, in the Product Charter's non-functional requirements backlog (status: Not started).

### TD-16 — Time-sensitive: free-trial Anthropic/AWS account expiry

**Priority:** P1 (urgent — see date below)
**Location:** operational, not code — `ANTHROPIC_API_KEY` (see [`../architecture/configuration.md`](../architecture/configuration.md)), the Docker/AWS deploy path (see [`../operations/infrastructure.md`](../operations/infrastructure.md))

Per the Product Charter's "Dependencies" section: the Anthropic/Claude API account this app uses is a free grant expiring **28-Oct-2026** (a new account/license must be arranged before then), and the AWS account is a free grant expiring **December 2026** (plan a replacement by November 2026). As of this page's last update (2026-09-28), the Anthropic expiry is under a month away. If it lapses without renewal, every AI-backed feature in the app (`/api/chat`, `/api/pathways/check-similar`) stops working outright — there is no fallback model or provider configured anywhere in code (see [`../integrations/third-party-integrations.md`](../integrations/third-party-integrations.md)). This is not visible anywhere in application code or CI — it is recorded here only because the Product Charter documented it, and should be re-verified directly with whoever holds these account relationships.

## Remediation Roadmap

| Priority | Items | Typical effort |
|---|---|---|
| P1 (urgent) | **TD-16 (renew/replace Anthropic account before 28-Oct-2026)** | Not a code task — an account/procurement action with a hard external deadline |
| P1 | TD-01 (delete 5 dead files), TD-03 (stand up a test framework + first unit tests) | TD-01: hours. TD-03: days to establish, ongoing after |
| P2 | TD-02, TD-04, TD-05, TD-07, TD-08, TD-09 | Each independently a few hours to a day |
| P3 | TD-06 (documentation only, already fixed), TD-10 through TD-15 | Each under an hour, except TD-15 which is genuinely new-feature-sized work |

## Related Documentation

[`../architecture/architecture-overview.md`](../architecture/architecture-overview.md), [`../architecture/testing.md`](../architecture/testing.md), [`../integrations/ai-llm.md`](../integrations/ai-llm.md), [`../application/database.md`](../application/database.md), [`../business/business-overview.md#roadmap-planned-not-yet-implemented`](../business/business-overview.md#roadmap-planned-not-yet-implemented), [`../operations/deployment.md#operational-dependency-risk-from-the-product-charter`](../operations/deployment.md#operational-dependency-risk-from-the-product-charter).

## Source Files

All files named inline above; migration history in `supabase/migrations/0018_drop_retired_tables.sql`, `0022_contribution_units.sql`, `0025_contribution_units_content.sql`, `0027_design_documents_draft_type.sql`; `docs/raw_documents/AI DIffusion Cube - Product Charter.docx`.
