# Business Overview

## Purpose and problem statement

100 Pathways exists to make AI adoption advice **evidence-grounded** rather than generic. Organizations deploying AI (health, agriculture, education, livelihoods) tend to get either abstract best-practice advice or nothing at all about the "boring" 70% of adoption work — governance, ownership, workforce change, ecosystem coordination — that actually determines whether a deployment survives past a pilot. Diffusion Cube's answer is a structured framework (4 dimensions × 4 stages) plus a growing corpus of real, documented deployments ("pathways"), and a conversational companion that compares a user's own situation against that corpus cell by cell, rather than answering from general AI/ML knowledge. This is stated explicitly as a rule the model must follow: only documented facts are shared, never backfilled with general knowledge (`content/framework.md`, `lib/system-prompts.ts`'s `groundingRules()`).

### Product vision (from the Product Charter)

Per `docs/raw_documents/AI DIffusion Cube - Product Charter.docx`'s stated vision: the objective of the AI Diffusion Pathways initiative is to **ease and accelerate adoption of AI use cases that are beneficial to society at scale**, by helping adopters explore the know-how and lived experience of others and contextualize it to their own situation — reducing learning cost, time, and risk. Two framing points from the charter worth carrying into any product decision:

- **The Cube is deliberately not a complete self-help system** that answers every question or replaces human interaction. It surfaces the range of approaches others took, why, and the conditions that made each work or fail — the adopter judges what applies and what to act on. (This matches the code-verified rule that micro-innovations are always framed as suggestions, never recommendations — see [`business-rules.md`](business-rules.md).)
- **It is meant to be a living system**, not a one-time reference: every participant both contributes and draws value on an ongoing basis, and the corpus's collective know-how is meant to compound as more adoption experience flows through it.

## Scope (Implemented Today)

| Capability | Traced to |
|---|---|
| Public browsing + chat over the pathway library (single-pathway chat and a whole-library overview chat), no login | `app/explore/`, `lib/pathway-store.ts` (`listPublished`, `getPublishedDocument`, `buildOverview`), `lib/system-prompts.ts` (`libraryPathwaySystemPrompt`, `libraryOverviewSystemPrompt`) |
| Signed-in analysis of a user's own AI adoption against the published pathways, tracked on a 4×4 grid | `app/analyse/`, `lib/system-prompts.ts` (`explorerSystemPrompt`), `lib/dimensions.ts` |
| **Retrieval-grounded answers** — each question is classified (`specific` / `situation` / `broad` / `patterns`) and grounded only on the pathways and lessons it needs, found by hybrid (meaning + keyword) search; the whole corpus is no longer sent with every message | `lib/retrieval.ts` (`classifyQuery`, `buildGrounding`, `hybridSearch`), `lib/embeddings.ts`, `supabase/functions/embed/`, migration `0042` (`match_pathway_units`) |
| Generated Analysis Document + Executive Summary, versioned and reopenable | `lib/design-documents.ts`, `app/api/chat/route.ts` (`analysis-doc`/`executive-summary` modes) |
| Contributor pipeline: document intake → stage confirmation → auto-drafted pathway document → conversational revision | `lib/system-prompts.ts` (`contributorSystemPrompt`, `pathwayDraftSystemPrompt`) |
| **Toolkit assets** — a contributor shares the actual reusable files/links behind their pathway (explicit public-sharing consent per asset); published with the pathway; downloadable by anyone from Analyse/Explore answers that cite them | migration `0034`, `lib/toolkit-assets.ts`, `lib/toolkit-assets-server.ts`, `app/api/toolkit-assets/*`, `components/ToolkitAsset*.tsx`, `ResourceReviewCard.tsx`, `AssetShareCard.tsx`, `ReusableAssetsPanel.tsx` — see [W5](workflows.md#w5--toolkit-asset-sharing-and-reuse) |
| Two-step publish into the app's own database: contributor "Send for review" saves a new `pathway_versions` row (a `draft` pathway moves to `in_review`; an already-live one stays `published` until the new version is approved); an admin publishes it (status `published`), which indexes its units for search. No GitHub commit, no redeploy | `app/api/pathways/assemble/route.ts`, `app/api/admin/pathways/publish/route.ts`, `lib/pathway-store.ts` (`saveVersion`, `publishVersion`) |
| Admin delete of a pathway, which also unpublishes it (versions, units, sources, toolkit assets and their stored files all go with it) | `app/api/admin/pathways/delete/route.ts` |
| One-time seeding of pathways from a source-document set (generated with Claude, published without admin review, original files kept privately for contributor-only fallback passages) | `scripts/seed-pathways.ts`, `lib/seed.ts`, `npm run seed:pathways` |
| Contributor onboarding gate (organisation, point of contact, consents, MoU) before `/contribute` unlocks | `lib/contributor-registration.ts`, `components/ContributorRegistrationGate.tsx` |
| Role-based admin console (contributor/admin roles, registrations, pathway review/publish/delete with status filter and draft badges, usage stats) | `app/admin/page.tsx`, `components/AdminPathwaysPanel.tsx`, `components/AdminPathwayRowCard.tsx` |
| Email-based signup/reset via 6-digit OTP over a self-hosted SMTP relay; every new account is an Explorer (`adopter`) immediately — no approval step | `app/login/page.tsx`, `app/api/auth/send-email/route.ts`, `lib/email.ts`, migration `0039_default_adopter_role.sql` |
| Self-serve account deletion; Terms of Use and Privacy Notice pages | `app/api/account/delete/route.ts` (migration `0033`), `app/terms/`, `app/privacy/`, `content/legal/*.md` |
| Per-user and per-IP rate limits and request-size caps on every chat call | `app/api/chat/route.ts`, `lib/rate-limit.ts` (`chat-user` 30/min · 300/day; anonymous `explore` 20/min · 200/day; env-overridable) |

## Non-Scope

- **Cross-user insight surfacing.** `adoption_queries` records every companion user message tagged with which pathways it drew on, but nothing in the app currently reads or displays this data back to anyone — it is write-only today. The Product Charter's "Incentivize Contributors" and "Visibility into Pathway Usage & Reuse" scope items (see Roadmap below) are the planned consumers of exactly this data.
- **Unpublishing without deleting, or retiring a pathway.** The `pathways.status` check constraint allows `retired` (migration `0042`), and every reader already treats anything other than `published` as not public, but no route or admin action sets `retired` today. The only way to take a pathway out of the library is the admin delete, which removes it entirely.
- **Contributor-side undo.** A contributor cannot withdraw a version they sent for review; a later "Send for review" simply adds a newer version.
- **Legacy binary Office formats** (`.doc`, `.ppt`) for document upload/extraction in the chat (`lib/extract-text.ts`). (Toolkit-asset *storage* does accept them as files to share — `lib/toolkit-assets.ts` — they are just never text-extracted.)
- **A Claude-native chat channel.** The charter names "Claude Chat" (a Claude Skill integration) as a second first-class channel alongside the web app, letting a user Explore/Analyze/Contribute "without visiting the web app." No such integration (MCP server, Claude Skill export, or equivalent) exists in this repository today — the product has exactly one channel, the Next.js web app.
- **Adopter-to-Contributor transition as a guided in-product path.** The charter envisions surfacing "the option to contribute at the right moment" as a user's own adoption experience matures, without a hard switch between modes. Today each adoption is fixed to one flow by its entry point (`/analyse` vs `/contribute`), stored permanently as `designs.meta.flow` — see [`users-and-personas.md`](users-and-personas.md#planned-vs-current-adoptercontributor-relationship).
- **PII screening on ingest and encryption/session-timeout hardening** — named in the charter's non-functional requirements. Rate limiting and payload caps now exist (see Scope); the rest does not. See [`../knowledge/technical-debt.md#td-15`](../knowledge/technical-debt.md#td-15).

## Roadmap (Planned, Not Yet Implemented)

Source: `docs/raw_documents/AI DIffusion Cube - Product Charter.docx`, dated with milestones running through 15-Mar-27. This is forward-looking product intent, not current behavior — every row below is unimplemented unless a "Current status" note says otherwise. The "Status" column in the backlog is the charter's own; the "Code evidence (2026-11-06)" column is what this repository shows today, which in several places has moved past the charter.

### Milestones

| Milestone | Outcome | Target | Current status |
|---|---|---|---|
| Cube Web App fully functional with ≥20 pathways | Ready for scaled use inside EkStep and by other organizations; adopters/contributors self-serve without hand-holding | 15-Nov-26 | Partially in place — the core Explorer/Contributor/Library flows are live, pathways now live in the app's database and can be bulk-seeded (`scripts/seed-pathways.ts`), and recent commits publish pathways one by one (e.g. `naya-sathi`, `healthbot`, `doora-1`, `a4kiosk`). The live pathway *count* against the ≥20 target sits in the Supabase project, not in this repository, so it cannot be verified from code |
| EkStep Contribution via Claude | ≥2 EkStep teams (Voice/Language AI, Blue Dots) actively using the Cube via web app and/or **Claude Chat**, updating know-how and drawing on others' work on an ongoing basis | 15-Dec-26 | The "Claude Chat" channel does not exist in this codebase today — see Non-Scope above |
| Incentivize Contributors | Users can give feedback / acknowledge reuse; contributors can see reuse of their own know-how and get insights from others' questions about their pathways | 15-Jan-27 | Not started — `adoption_queries` is the write-only data source this would read from |
| Visibility into Pathway Usage & Reuse | Explorer/Contributor counts, conversations per week, likes/dislikes, reuse acknowledgements | 15-Feb-27 | Partly in place for admins only — `/admin/usage` (`admin_usage_stats()`, migrations `0038`/`0041`) shows total/new/active users and conversations per area (analyse, contribute, explore) over 7 days, plus AI calls and errors per day (IST). Not built: likes/dislikes, reuse acknowledgements, any contributor-facing view; see [`../operations/monitoring.md`](../operations/monitoring.md) |
| Channel Expansion | Accessible through channels beyond the web app and Claude Chat | 15-Mar-27 | Not started; charter itself notes these channels are "not yet explored and defined" |

### Prioritized requirements backlog (from the charter's own tracking tabs)

| Requirement | Type | Status (per charter) | Code evidence (2026-11-06) |
|---|---|---|---|
| Sign-up notification (to admin for approval, and to user once approved) | Functional | In Progress | **Superseded for signup** — there is no signup approval any more (migration `0039`); `sendAdminApprovalEmail` in `lib/email.ts` has no caller. A contributor *is* emailed when an admin publishes their pathway (`sendContributionEmail` in `app/api/admin/pathways/publish/route.ts`) |
| Reset password | Functional | **Complete** | Matches the live OTP-based reset flow (`specs/SIGNUP_OTP_SPEC.md`, `app/login/page.tsx`) |
| Terms & Conditions / Disclaimers (pending legal guidance) | Functional | In Progress | Terms of Use and Privacy Notice pages are live (`app/terms/`, `app/privacy/`, `content/legal/terms.md`, `privacy.md`); whether legal sign-off is final is outside the code |
| User-initiated account deletion | Functional | Not started | **Built** — `app/api/account/delete/route.ts`, migration `0033`, `specs/ACCOUNT_DELETION_SPEC.md` |
| Store toolkit-asset files, surface them in conversation | Functional | In Progress | **Built** — migration `0034`, `app/api/toolkit-assets/*`, asset cards under Analyse/Explore answers; see [W5](workflows.md#w5--toolkit-asset-sharing-and-reuse) and `docs/features/toolkit-asset-files/` |
| Enhance the Framework and Pathway schema | Functional | Not started | **Partly built** by the pathway-storage feature — each pathway's micro-innovations are now stored as labelled, searchable `pathway_units` rows, and pathways are versioned (`pathway_versions`) with a status lifecycle (migration `0042`, `docs/features/pathway-storage/`). The framework itself (`content/framework.md`) is unchanged |
| Enhance pathway-creation extraction/generation logic | Functional | Not started | No change found — contributor drafts still use `pathwayDraftSystemPrompt` + `content/pathway-generation-prompt.md` (the seed script reuses the same prompt) |
| Improve Analyze-Own-Adoption flow + Analysis Document | Functional | Not started | **Partly addressed** — retrieval-based grounding (`lib/retrieval.ts`) and the answer-shape rules from adopter feedback (single best match, describe pathways on first mention, short answers, neutral and plain words — see [`business-rules.md#answer-shape-rules`](business-rules.md#answer-shape-rules)) |
| Corpus synthesis process ("LLM Wiki approach" — synthesized cross-pathway learnings) | Functional | Not started | **Partly addressed** — the `patterns` query kind groups lessons across pathways and states exact "shown by N pathways" counts (`groupPatterns` in `lib/retrieval.ts`). There is still no stored, synthesized cross-pathway write-up. Note: this is a *product* concept, distinct from this repository's `llm-wiki` documentation skill |
| Fine-tune Contribution/Curation UI per user feedback | Functional | Not started | Admin pathways panel gained a status filter and draft badges (`components/AdminPathwaysPanel.tsx`); contributor resource-review and asset cards added |
| Test cases across all flows, and testing | Non-functional | Not started | **Built** — Vitest suite, 105 test files under `tests/` (`npm test`, `test:coverage`; `vitest.config.mts`). Not yet run in CI: `.github/workflows/deploy.yml` only deploys. See [`../architecture/testing.md`](../architecture/testing.md) |
| Deployment in AWS environment | Non-functional | Not started | Not started — the Dockerfile targeting AWS (see [`../operations/infrastructure.md`](../operations/infrastructure.md)) is prepared groundwork, not a completed deployment |
| Error handling and graceful degradation (failed AI calls, malformed uploads) | Non-functional | Not started | **Partly built** — every route uses `withErrorHandling` and records to `sys_errors`; search degrades to full text when embedding fails; the embed call retries on 503/504/546 (`lib/embeddings.ts`). Anthropic calls themselves still have no retry — see [`../knowledge/technical-debt.md#td-05`](../knowledge/technical-debt.md#td-05) |
| Security & privacy (encryption at rest/in transit, token-based auth + session timeout, rate limiting, PII screening on ingest) | Non-functional | Not started | **Partly built** — per-user/per-IP rate limits and request caps on chat (`lib/rate-limit.ts`, migration `0037`), pathway visibility limited by RLS (migration `0040`), audit Highs H1–H4 closed (`docs/audits/2026-10-22/`). No PII screening or session timeout |
| Reliability & serving architecture (concurrency limits with graceful overflow, defined timeout/retry policy) | Non-functional | Not started | Not started beyond the rate limits above |
| Structured logging (latency, errors, per-user/per-pathway usage) | Non-functional | Not started | **Partly built** — `sys_errors` (migration `0035`), `ai_usage` per Claude call (`0036`), admin usage stats with IST day grouping (`0038`, `0041`); see [`../operations/monitoring.md`](../operations/monitoring.md). No external monitoring service |

### Execution model (from the charter)

- **Solution Team** (Kamesh + Tekdi Team) — owns solution functionality, UI/UX, data/technical architecture; builds and maintains the web app and the planned Claude Skill integration; handles product/technical user issues.
- **Program Team** (David, Anupama + Team) — owns stakeholder communication and the pathway content lifecycle (reviewing/publishing contributor submissions), onboards new adopters, relays user feedback to the Solution team.
- **Cadence**: weekly cross-team review against the current milestone; a formal milestone review (with senior management) at each milestone boundary.
- **Tracking**: a Requirements tab (the backlog above) and a Feedback tab (issues/feature requests, triaged in the weekly review) live inside the charter document itself, not in an external ticket tracker — see the note in [`../knowledge/references.md`](../knowledge/references.md).

## Reconciliation with Raw Business Documents

See the raw-document inventory in [`../wiki-index.md#source--raw-documents`](../wiki-index.md#source--raw-documents).

| Raw-doc claim | Source | Code-verified behavior |
|---|---|---|
| Explorer flow is intent-driven: a four-card menu (Browse / Validate / Troubleshoot / Guidance), each with its own numbered step flow | `CLAUDE.md` | `lib/explorer-intents.ts` defines exactly one flow (`ANALYSE_FLOW`, 5 steps); `getExplorerIntent()` ignores its input entirely. The four-intent menu has been collapsed into a single flow |
| Signup requires admin approval before any access | `SIGNUP_APPROVAL_OPTIONS.md` | Every account gets the `adopter` role from a database trigger in the same transaction that creates it (migration `0039_default_adopter_role.sql`; the old `grant-default-role` route is gone) — `/analyse` works right after signup with no admin step. Only `pathway_contributor` and `admin` require an admin grant |
| The companion's reasoning posture is built around a single "Explorer mode" persona description | `conversation_design.md` | Still broadly reflected in `lib/system-prompts.ts`'s tone/posture rules, but this document predates the intent-menu removal and the entire `pathways`/`organisations`/contributor-registration schema — not reliable for anything structural |
| The 4-dimension/4-stage framework, unit types, and pathway document structure | `docs/raw_documents/Pathway Framework.pdf` | **Confirmed, no gap.** `content/framework.md` and `content/pathway-generation-prompt.md` are a current, accurate, near-verbatim transcription of this document, including details not previously cross-checked in this wiki (Section 0 "Reading guide," "Downstream Adoptions" pathway metadata, "Also relevant at" cross-stage tagging, the Source Trace appendix spec, and the "synthesis test") |
| Contributor publish is self-serve, and pathways are committed to GitHub | `CLAUDE.md` (earlier branch), the pre-2026-11 wiki | Publishing is two-step and entirely inside Supabase: "Send for review" saves a `pathway_versions` row; an admin publishes it (`lib/pathway-store.ts`). `lib/github.ts` and every `GITHUB_*` setting were removed by the pathway-storage feature |
| Product roadmap, scope, and requirements backlog | `docs/raw_documents/AI DIffusion Cube - Product Charter.docx` | See the Roadmap section above — the charter's own statuses are kept, with a code-evidence column showing where the code has moved past them |
| Pathway storage in the app database, hybrid search, seeding | `docs/features/pathway-storage/` (requirement, plan, task list, test set — 2026-11-03/04) | Implemented as specified: migration `0042`, `lib/pathway-store.ts`, `lib/retrieval.ts`, `scripts/seed-pathways.ts` |

## Source files

`content/framework.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `SIGNUP_APPROVAL_OPTIONS.md`, `conversation_design.md`, `lib/contributor-registration.ts`, `lib/system-prompts.ts`, `lib/retrieval.ts`, `lib/pathway-store.ts`, `lib/rate-limit.ts`, `lib/toolkit-assets.ts`, `scripts/seed-pathways.ts`, `supabase/migrations/0033`–`0042`, `docs/features/pathway-storage/`, `docs/features/toolkit-asset-files/`, `docs/audits/2026-10-22/`, `docs/raw_documents/Pathway Framework.pdf`, `docs/raw_documents/AI DIffusion Cube - Product Charter.docx`.
