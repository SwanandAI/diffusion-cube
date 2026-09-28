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
| Public browsing + single-document chat over a pathway library | `app/explore/`, `lib/library-wiki-loader.ts` |
| Signed-in analysis of a user's own AI adoption against the whole corpus, tracked on a 4×4 grid | `app/analyse/`, `lib/system-prompts.ts` (`explorerSystemPrompt`), `lib/dimensions.ts` |
| Generated Analysis Document + Executive Summary, versioned and reopenable | `lib/design-documents.ts`, `app/api/chat/route.ts` (`analysis-doc`/`executive-summary` modes) |
| Contributor pipeline: document intake → stage confirmation → auto-drafted pathway document → conversational revision | `lib/system-prompts.ts` (`contributorSystemPrompt`, `pathwayDraftSystemPrompt`) |
| Two-step publish (contributor commits to GitHub, admin copies to the public table) | `app/api/pathways/assemble/route.ts`, `app/api/admin/pathways/publish/route.ts` |
| Contributor onboarding gate (organisation, point of contact, consents, MoU) before `/contribute` unlocks | `lib/contributor-registration.ts`, `components/ContributorRegistrationGate.tsx` |
| Role-based admin console (roles, registrations, pathway publish/delete) | `app/admin/page.tsx` and its three panels |
| Email-based signup/reset via 6-digit OTP over a self-hosted SMTP relay | `app/login/page.tsx`, `app/api/auth/send-email/route.ts`, `lib/email.ts` |

## Non-Scope

- **Cross-user insight surfacing.** `adoption_queries` records every companion user message tagged with which pathways it drew on, but nothing in the app currently reads or displays this data back to anyone — it is write-only today. The Product Charter's "Incentivize Contributors" and "Visibility into Pathway Usage & Reuse" scope items (see Roadmap below) are the planned consumers of exactly this data.
- **Undo/moderation on a contributor's self-serve steps.** Contributor "assemble" (commit to GitHub) has no unpublish; only an admin can subsequently overwrite via the admin publish route. The charter's scope explicitly calls out "removing a published pathway when needed" as part of ongoing curation — not yet built.
- **A read-only/general-access experience.** A signed-in user with none of `adopter`/`pathway_contributor`/`admin` sees only an "ask an admin" message and has no workspace beyond `/wiki` (unlinked from navigation) and `/adoptions`.
- **Legacy binary Office formats** (`.doc`, `.ppt`) for document upload/extraction (`lib/extract-text.ts`).
- **The multi-contributor "contribution unit" model** (`contribution_units` table, migrations `0022`/`0025`) — fully built with correct RLS, but no code path writes to it; the actual contributor-publish mechanism ended up being a whole-document GitHub commit instead. Possibly early groundwork for the charter's "Enhance the Framework and Pathway schema" requirement (status: Not started) — see [`knowledge/technical-debt.md#td-04`](../knowledge/technical-debt.md#td-04).
- **A Claude-native chat channel.** The charter names "Claude Chat" (a Claude Skill integration) as a second first-class channel alongside the web app, letting a user Explore/Analyze/Contribute "without visiting the web app." No such integration (MCP server, Claude Skill export, or equivalent) exists in this repository today — the entire product currently has exactly one channel, the Next.js web app.
- **Adopter-to-Contributor transition as a guided in-product path.** The charter envisions surfacing "the option to contribute at the right moment" as a user's own adoption experience matures, without a hard switch between modes. Today the choice between Explorer and Contributor is a hard, one-time fork made by which entry point (`/analyse` vs `/contribute`) the user started from, stored permanently as `designs.meta.flow` — see [`users-and-personas.md`](users-and-personas.md#planned-vs-current-adopter-contributor-relationship).
- **Security/privacy hardening, rate limiting, and PII screening on ingest** — named explicitly in the charter's non-functional requirements (status: Not started). See [`knowledge/technical-debt.md`](../knowledge/technical-debt.md#td-15) for the current-state gap this leaves.

## Roadmap (Planned, Not Yet Implemented)

Source: `docs/raw_documents/AI DIffusion Cube - Product Charter.docx`, dated with milestones running through 15-Mar-27. This is forward-looking product intent, not current behavior — every row below is unimplemented unless a "Current status" note says otherwise.

### Milestones

| Milestone | Outcome | Target | Current status |
|---|---|---|---|
| Cube Web App fully functional with ≥20 pathways | Ready for scaled use inside EkStep and by other organizations; adopters/contributors self-serve without hand-holding | 15-Nov-26 | Partially in place — the app's core Explorer/Contributor/Library flows exist and are live (this wiki documents them in full); pathway *count* against the ≥20 target and "no hand-holding needed" are product/content judgments outside this codebase's scope to verify |
| EkStep Contribution via Claude | ≥2 EkStep teams (Voice/Language AI, Blue Dots) actively using the Cube via web app and/or **Claude Chat**, updating know-how and drawing on others' work on an ongoing basis | 15-Dec-26 | The "Claude Chat" channel does not exist in this codebase today — see Non-Scope above |
| Incentivize Contributors | Users can give feedback / acknowledge reuse; contributors can see reuse of their own know-how and get insights from others' questions about their pathways | 15-Jan-27 | Not started — `adoption_queries` is the write-only data source this would read from |
| Visibility into Pathway Usage & Reuse | Explorer/Contributor counts, conversations per week, likes/dislikes, reuse acknowledgements | 15-Feb-27 | Not started — no analytics surface exists; see [`../operations/monitoring.md`](../operations/monitoring.md) |
| Channel Expansion | Accessible through channels beyond the web app and Claude Chat | 15-Mar-27 | Not started; charter itself notes these channels are "not yet explored and defined" |

### Prioritized requirements backlog (from the charter's own tracking tabs)

| Requirement | Type | Status (per charter) |
|---|---|---|
| Sign-up notification (to admin for approval, and to user once approved) | Functional | In Progress |
| Reset password | Functional | **Complete** — matches this repo's live, code-verified OTP-based reset flow (`SIGNUP_OTP_SPEC.md`, `app/login/page.tsx`) |
| Terms & Conditions / Disclaimers (pending legal guidance) | Functional | In Progress |
| User-initiated account deletion | Functional | Not started |
| Store toolkit-asset files, surface them in conversation | Functional | In Progress |
| Enhance the Framework and Pathway schema | Functional | Not started — see `contribution_units` cross-reference in Non-Scope above |
| Enhance pathway-creation extraction/generation logic | Functional | Not started |
| Improve Analyze-Own-Adoption flow + Analysis Document | Functional | Not started |
| Corpus synthesis process ("LLM Wiki approach" — synthesized cross-pathway learnings) | Functional | Not started — note: this is a *product* corpus-synthesis concept, distinct from this repository's own `llm-wiki` documentation-generation skill; don't conflate the two despite the shared name |
| Fine-tune Contribution/Curation UI per user feedback | Functional | Not started |
| Test cases across all flows, and testing | Non-functional | Not started — matches [`../architecture/testing.md`](../architecture/testing.md)'s independently-verified finding of zero automated tests |
| Deployment in AWS environment | Non-functional | Not started — the Dockerfile targeting AWS (see [`../operations/infrastructure.md`](../operations/infrastructure.md)) is prepared groundwork, not a completed deployment |
| Error handling and graceful degradation (failed AI calls, malformed uploads) | Non-functional | Not started — matches [`../knowledge/technical-debt.md#td-05`](../knowledge/technical-debt.md#td-05)'s independently-verified finding of zero retry logic on any Anthropic call |
| Security & privacy (encryption at rest/in transit, token-based auth + session timeout, rate limiting, PII screening on ingest) | Non-functional | Not started |
| Reliability & serving architecture (concurrency limits with graceful overflow, defined timeout/retry policy) | Non-functional | Not started |
| Structured logging (latency, errors, per-user/per-pathway usage) | Non-functional | Not started — matches [`../operations/monitoring.md`](../operations/monitoring.md)'s independently-verified finding of no structured logging or external monitoring |

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
| Signup requires admin approval before any access | `SIGNUP_APPROVAL_OPTIONS.md` | Signup auto-grants the `adopter` role immediately (`app/api/auth/grant-default-role/route.ts`) — `/analyse` works right after signup with no admin step. Only `pathway_contributor` and `admin` require an admin grant |
| The companion's reasoning posture is built around a single "Explorer mode" persona description | `conversation_design.md` | Still broadly reflected in `lib/system-prompts.ts`'s tone/posture rules, but this document predates the intent-menu removal and the entire `pathways`/`organisations`/contributor-registration schema — not reliable for anything structural |
| The 4-dimension/4-stage framework, unit types, and pathway document structure | `docs/raw_documents/Pathway Framework.pdf` | **Confirmed, no gap.** `content/framework.md` and `content/pathway-generation-prompt.md` are a current, accurate, near-verbatim transcription of this document, including details not previously cross-checked in this wiki (Section 0 "Reading guide," "Downstream Adoptions" pathway metadata, "Also relevant at" cross-stage tagging, the Source Trace appendix spec, and the "synthesis test") |
| Product roadmap, scope, and requirements backlog | `docs/raw_documents/AI DIffusion Cube - Product Charter.docx` | See the Roadmap section above — this is forward-looking intent the current codebase has not yet built, not a reconciliation against implemented behavior |

## Source files

`content/framework.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `SIGNUP_APPROVAL_OPTIONS.md`, `conversation_design.md`, `lib/contributor-registration.ts`, `lib/system-prompts.ts`, `docs/raw_documents/Pathway Framework.pdf`, `docs/raw_documents/AI DIffusion Cube - Product Charter.docx`.
