# References

## Raw documents (`docs/raw_documents/`)

| Document | Status | Use it for |
|---|---|---|
| [`Pathway Framework.pdf`](../../../raw_documents/Pathway%20Framework.pdf) | Current and accurate — the original spec | The authoritative source for the 4×4 framework, unit types, and pathway document structure. `content/framework.md`/`content/pathway-generation-prompt.md` are a verified, near-verbatim, current transcription — no gap found |
| [`AI DIffusion Cube - Product Charter.docx`](../../../raw_documents/AI%20DIffusion%20Cube%20-%20Product%20Charter.docx) | Current (roadmap through 15-Mar-27). Several backlog statuses in it are behind the code | Product vision, scope, team/execution model, milestone roadmap and the prioritised requirements backlog. See [`../business/business-overview.md#roadmap-planned-not-yet-implemented`](../business/business-overview.md#roadmap-planned-not-yet-implemented) (charter status alongside code evidence) and the time-sensitive dependency note in [`../operations/deployment.md#operational-dependency-risk-from-the-product-charter`](../operations/deployment.md#operational-dependency-risk-from-the-product-charter) |

## Feature planning docs (`docs/features/`)

Each folder holds the `brd-validation` → `architecture-plan` → `task-creation` output for one feature.

| Folder | Status | Use it for |
|---|---|---|
| [`docs/features/pathway-storage/`](../../../features/pathway-storage/) | Implemented (migration `0042`, `lib/pathway-store.ts`, `lib/retrieval.ts`, `scripts/seed-pathways.ts`) | Why pathways moved from committed files + GitHub into Supabase, the business decisions (e.g. seeded pathways skip review, source files contributor-only unless marked public), the architecture decisions behind hybrid search and the `embed` function, the task list, and `test_set_pathway_storage.md` (the question set used to tune retrieval limits) |
| [`docs/features/toolkit-asset-files/`](../../../features/toolkit-asset-files/) | Implemented (migration `0034`, `app/api/toolkit-assets/*`) | Requirement, clarifications, plan and task list for toolkit asset sharing — see [`../business/workflows.md#w5--toolkit-asset-sharing-and-reuse`](../business/workflows.md#w5--toolkit-asset-sharing-and-reuse) |
| [`docs/features/monitoring-logging-cleanup/`](../../../features/monitoring-logging-cleanup/) | Implemented (migrations `0035`–`0038`, `0041`) | Error log (`sys_errors`), AI usage recording, admin usage page, and the technical cleanup that removed the second corpus |

## Audits (`docs/audits/`)

| Document | Status | Use it for |
|---|---|---|
| [`docs/audits/2026-10-22/audit-summary.md`](../../../audits/2026-10-22/audit-summary.md) | Point-in-time (commit `d240a18`); High findings H1–H4 since fixed (commit `8bb17cc`) | Merged code-review + QA findings across the whole codebase, with severities |
| [`docs/audits/2026-10-22/code-review-report.md`](../../../audits/2026-10-22/code-review-report.md) | Point-in-time | Full static review by the `code-reviewer` subagent |
| [`docs/audits/2026-10-22/qa-report.md`](../../../audits/2026-10-22/qa-report.md) | Point-in-time | Full test-case table, defects and coverage gaps from the `qa-tester` subagent |

## In-repository documents (see also the raw-document inventory in [`../wiki-index.md#source--raw-documents`](../wiki-index.md#source--raw-documents))

| Document | Status | Use it for |
|---|---|---|
| [`CLAUDE.md`](../../../../CLAUDE.md) | Mostly current — a short pointer into this wiki plus the list of tailored skills/subagents; two table cells are stale (testing row says "there are none"; third-party row still lists GitHub and Sheets) | AI-agent entry point: which wiki page to load for which task |
| [`ARCHITECTURE.md`](../../../../ARCHITECTURE.md) | Stale since the pathway-storage feature (last changed 2026-09-24): still describes committed `content/wiki/` pathways, a `published_pathways` *table* and the admin copy step | Historical architecture narrative; use [`../architecture/architecture-overview.md`](../architecture/architecture-overview.md) instead |
| [`conversation_design.md`](../../../../conversation_design.md) | Well over 100 commits stale | Companion tone/posture philosophy; not routing, roles or schema |
| [`specs/README.md`](../../../../specs/README.md) | Index of specs | Where feature specs live and how to name them |
| [`specs/SIGNUP_OTP_SPEC.md`](../../../../specs/SIGNUP_OTP_SPEC.md) | Current and accurate | Exact OTP signup/reset flow spec |
| [`specs/ACCOUNT_DELETION_SPEC.md`](../../../../specs/ACCOUNT_DELETION_SPEC.md) | Current and accurate | Self-serve account deletion (migration 0033), password Show/Hide, sign-out confirmation |
| [`specs/TOOLKIT_ASSETS_SPEC.md`](../../../../specs/TOOLKIT_ASSETS_SPEC.md) | Progress log for the toolkit-asset feature (status line dated 2026-10-16) | What was built per task (TA-01…TA-11) |
| [`specs/MONITORING_LOGGING_CLEANUP_SPEC.md`](../../../../specs/MONITORING_LOGGING_CLEANUP_SPEC.md) | Progress log (code complete, 2026-10-22) | What was built per task (MLC-01…MLC-21), including the H1–H4 fixes |
| [`specs/SIGNUP_APPROVAL_OPTIONS.md`](../../../../specs/SIGNUP_APPROVAL_OPTIONS.md) | Superseded twice: first by the in-app approval dashboard, then by automatic `adopter` at signup (migration `0039`) | Historical decision record only |
| [`.env.example`](../../../../.env.example) | Current | Every environment variable the app reads, with placeholders — see [`../architecture/configuration.md`](../architecture/configuration.md) |
| [`vitest.config.mts`](../../../../vitest.config.mts), [`tests/setup.ts`](../../../../tests/setup.ts), `tests/helpers/` | Current | The automated test suite (Vitest, ~105 test files under `tests/{unit,api,client,db,features,pages,proxy}`; `npm test`, `npm run test:coverage` → `tests/coverage/`). Every external client (Supabase, Anthropic, SMTP) is mocked. See [`../architecture/testing.md`](../architecture/testing.md) |
| [`scripts/seed-manifest.example.json`](../../../../scripts/seed-manifest.example.json), [`scripts/vite-node.config.mts`](../../../../scripts/vite-node.config.mts) | Current | Manifest format and runner config for `npm run seed:pathways` — see [`../business/workflows.md#w6--seeding-pathways-operator-one-time`](../business/workflows.md#w6--seeding-pathways-operator-one-time) |
| [`README.md`](../../../../README.md), [`AGENTS.md`](../../../../AGENTS.md) | Unmodified `create-next-app` boilerplate | Neither has project-specific content |

## External systems referenced by code (no dashboards/URLs provided in-repo)

- **Anthropic API** — via `@anthropic-ai/sdk`. `claude-sonnet-4-6` for chat, documents, drafts, `check-similar` and the seed script; a Claude Haiku model (`CLASSIFIER_MODEL` in `lib/retrieval.ts`) for the per-question retrieval classifier. See [`../integrations/ai-llm.md`](../integrations/ai-llm.md).
- **Supabase project** — Postgres (with pgvector), Auth, RLS, Storage (private buckets `toolkit-assets` and `pathway-sources`) and the `embed` Edge Function (`supabase/functions/embed/`, `gte-small` embeddings — no separate embeddings vendor or key). Project URL/keys are environment-specific (see [`../architecture/configuration.md`](../architecture/configuration.md)); no dashboard link is committed to this repository.
- **Vercel project** (`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`) — the live deploy target (`.github/workflows/deploy.yml`, which deploys only and does not run tests).
- **SMTP relay** — signup/reset OTP emails and the "your pathway is published" email (`lib/email.ts`).

> **Note:** Google Sheets conversation logging (`GOOGLE_SHEET_ID`) was removed in commit `d240a18`; nothing in the code reads that variable any more.

> **Note:** GitHub is no longer an application dependency. Contributor pathways used to be committed through the GitHub Contents API (`GITHUB_REPO`/`GITHUB_BRANCH`); the pathway-storage feature removed `lib/github.ts` and those settings. GitHub remains only the source repository and the CI host.

> **Note:** This repository does not commit any dashboard URLs, ticket-tracker project keys or Slack channel references. The Product Charter describes requirements/feedback tracking as living in "additional tabs within this document" (a Requirements tab and a Feedback tab inside the same `.docx`), not in a separate ticket tracker, so there is no external issue-tracker link to record here.

## Framework source document

The "AI Diffusion Pathway Framework" is transcribed in full into [`content/framework.md`](../../../../content/framework.md). This is the canonical, prompt-injected version; editing it changes model behaviour with no code change. `lib/dimensions.ts` mirrors only its structural shape (dimension/sub-category codes, weights) for the app's own JSON state and UI, and `lib/pathway-units.ts` validates published units against that vocabulary.

## Source files

All documents listed above.
