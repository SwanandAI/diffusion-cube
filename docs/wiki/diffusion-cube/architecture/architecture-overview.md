# Architecture Overview

## Summary

Diffusion Cube is a Next.js App Router monolith: one Node process serves pages, API routes, and (via `output: "standalone"`) its own production server. There is no separate backend service, no message queue, and no dedicated cache layer — Supabase (Postgres + Auth) is the only stateful dependency besides the Anthropic API. Three user-facing surfaces (`/explore`, `/analyse`, `/contribute`) share one chat route and one theme, but otherwise share little code — see the three-surface diagram in [`component-diagram.md`](component-diagram.md).

### Architecture Style

| Aspect | Current choice |
|---|---|
| Application shape | Monolithic Next.js App Router app (pages + API routes in one deployable) |
| Rendering | Mixed server components (data-loading pages) + client components (`'use client'` chat/admin UI) |
| State/persistence | Supabase Postgres, accessed directly via `@supabase/supabase-js` — no ORM, no repository layer |
| AI integration | Direct `@anthropic-ai/sdk` calls from route handlers, streamed to the client |
| Auth | Supabase Auth + Next.js middleware (`proxy.ts`) + per-route role re-checks |
| Corpus storage | Hybrid: static markdown in-repo + Supabase tables merged at read time |
| Deployment | Vercel (live, via GitHub Actions) **and** a separate Docker/AWS image (built, not CI-wired) — see [`operations/deployment.md`](../operations/deployment.md) |

## Key decisions

1. **One chat route, many modes.** `app/api/chat/route.ts` dispatches on a `mode` string (8 values) rather than one route per mode — keeps auth/streaming/logging boilerplate in one place at the cost of a long switch-like route file.
2. **The model never writes to the database directly.** Every mode returns streamed text plus a trailing `<grid_update>` JSON block; the *client* (`lib/adoption-conversation.ts`) parses it and performs all writes. This keeps the model stateless per call and makes every persisted write auditable in one hook.
3. **Two independent pathway corpora**, not one. `/explore` (public Library) and `/analyse`+`/contribute` (grounding corpus) read different directories (`content/library-wiki/pathways/` vs `content/wiki/pathways/`) via different loader modules, deliberately — the Library's conversational tone and single-document grounding are a different product decision from the grounding corpus's whole-corpus, framework-tagged retrieval. See [`integrations/ai-llm.md`](../integrations/ai-llm.md#two-corpora).
4. **Publishing is two independently-gated steps**, not one. Contributor "assemble" commits to GitHub; only a separate admin action copies content into the publicly-read `published_pathways` table. This lets a human review before anything is user-visible, at the cost of a two-step mental model contributors must learn.
5. **Middleware gates sessions, not roles.** `proxy.ts` only checks "is there a signed-in user"; role-specific gating is layered at the page level (UX) and re-enforced at the API level (real enforcement) — see the three-deep enforcement diagram in [`component-diagram.md`](component-diagram.md).
6. **No caching layer for LLM output beyond content-hash dedup.** `design_documents.content_hash` (a non-cryptographic djb2 hash of the conversation+grid) makes an unchanged-conversation regeneration a DB read instead of a model call — the only caching in the system. See [`integrations/caching.md`](../integrations/caching.md).

## Reconciliation with Raw Architecture Documents

`docs/raw_documents/Pathway Framework.pdf` is the original AI Diffusion Pathway Framework specification; `content/framework.md` and `content/pathway-generation-prompt.md` are a current, accurate, near-verbatim transcription of it (see row 7 below) — no gap found. This repository also keeps its own architecture narrative in root-level markdown files. `ARCHITECTURE.md` (repo root) explicitly positions itself as the corrective to `CLAUDE.md`'s earlier description, and is largely accurate — but was found to have one stale claim of its own during this wiki's code verification pass. Full raw-document inventory: [`wiki-index.md`](../wiki-index.md#source--raw-documents).

| # | Document | Claim | Code-verified behavior |
|---|---|---|---|
| 1 | `CLAUDE.md` | Explorer entry point is `/explore`, four-card intent menu (browse/validate/troubleshoot/guidance) | Explorer entry point is `/analyse`; `lib/explorer-intents.ts` defines exactly one flow, `ANALYSE_FLOW` (5 steps) — the four-intent menu is gone. `/explore` now means the unrelated public Library |
| 2 | `CLAUDE.md` | Grid is "surfaced as four colored status chips (not a table)"; `DimensionChips.tsx` exists | `DimensionChips.tsx` does not exist anywhere in the repo (zero grep matches). `components/HeatmapGrid.tsx` renders a literal `<table>` (confirmed: `HeatmapGrid.tsx:32`) |
| 3 | `ARCHITECTURE.md` §5 | "The grid is surfaced as four status chips and a Grid button, not a table. The 4×4 table UI was deliberately removed" | Same contradiction as #2 — `HeatmapGrid.tsx` is a real `<table>`, opened by a "▦ Grid" button in `AdoptionWorkspace.tsx`. Even the doc written to correct `CLAUDE.md` has this one stale paragraph |
| 4 | `CLAUDE.md` | Contributor drafts persist in `pathway_submissions`/`pathway_submission_versions` | Both tables were dropped in migration `0018`; contributor drafts now live in `design_documents` (`doc_type='draft'`), and publishing commits straight to GitHub via `lib/github.ts`. Three route files and one lib file still reference the dropped tables — dead/broken code, see [`knowledge/technical-debt.md#td-01`](../knowledge/technical-debt.md#td-01) |
| 5 | `SIGNUP_APPROVAL_OPTIONS.md` | Admin approves signups via an emailed review link; roles set by hand in the Supabase Table Editor | `/admin` is a full in-app dashboard (`AdminDashboard` + checkbox role grants via `POST /api/admin/roles`); signup is self-serve OTP (`SIGNUP_OTP_SPEC.md`, live and current) with no admin approval step for the base `adopter` role |
| 6 | `conversation_design.md` | Describes the companion's reasoning/tone philosophy in detail | Last touched ~126 commits before HEAD — predates the intent-menu removal, the `pathways`/`organisations` schema, and the `/analyse`/`/navigate` renames. Still credible for *tone/posture*, not for routing, roles, or schema |
| 7 | `docs/raw_documents/Pathway Framework.pdf` | The 4-dimension/4-stage framework, unit types, and Sections 0–6 + Source Trace pathway document structure | **Confirmed, no gap.** `content/framework.md`/`content/pathway-generation-prompt.md` match, including details this wiki hadn't previously cross-checked: Section 0 "Reading guide," "Downstream Adoptions" pathway metadata, "Also relevant at" cross-stage tagging (explicitly excluded from Section 2 density counts), and the Source Trace appendix's keyed-by-source-file spec |
| 8 | `docs/raw_documents/AI DIffusion Cube - Product Charter.docx` | Product roadmap and requirements backlog through 15-Mar-27 | This is forward-looking intent, not a claim about current implementation — see the full Roadmap section in [`../business/business-overview.md#roadmap-planned-not-yet-implemented`](../business/business-overview.md#roadmap-planned-not-yet-implemented) and its cross-references into this page's Alternative Architecture Approaches (rows J, N below) and [`knowledge/technical-debt.md`](../knowledge/technical-debt.md#roadmap-acknowledged-gaps) |

## Alternative Architecture Approaches

### Software engineering perspectives

| ID | Approach | Summary | Pain addressed | Trade-offs | Fit for this codebase |
|---|---|---|---|---|---|
| A | **Current: monolithic Next.js route handlers, direct Supabase client calls** | One deployable, no ORM/repository layer, prompt logic and data access both live in `lib/` | Simple mental model, fast to ship, matches a small team | No schema-level type safety beyond hand-written TS interfaces; duplicated logic like `parseFrontmatter` in two places (`lib/strip-frontmatter.ts` and `app/api/admin/pathways/publish/route.ts`) | **Implemented.** Reasonable for current scale (single team, ~90 source files) |
| B | Introduce a typed data-access layer (e.g. generated Supabase types + a thin repository module per table) | Centralizes query shape, catches drift when migrations change columns | The dead-table bugs in [`knowledge/technical-debt.md#td-01`](../knowledge/technical-debt.md#td-01) would have been caught at build time, not runtime | Refactor cost across ~20 call sites | **Not implemented.** Highest-leverage structural change given TD-01's history |
| C | Split `app/api/chat/route.ts`'s 8 modes into 8 route files sharing a common handler | Smaller diffs per mode, clearer ownership | Current 240-line single-dispatch file is still readable at present size | More route boilerplate, loses the one-place-for-auth/logging benefit | **Not implemented.** Revisit only if the mode count keeps growing |
| D | Add automated tests (unit for `lib/`, integration for `app/api/`) | Direct answer to [`architecture/testing.md`](testing.md)'s "zero tests" finding | Prevents regressions like the migration-0027 constraint bug, which shipped Contributor drafts broken for a real window before anyone noticed | Upfront authoring cost, no existing harness to build on | **Not implemented.** Highest-priority engineering gap per this wiki's own testing page |

### AI / ML engineering perspectives

| ID | Approach | Summary | Pain addressed | Trade-offs | Fit for this codebase |
|---|---|---|---|---|---|
| I | **Current: whole-corpus prompt injection** (~22K tokens: framework + all pathway docs) per companion turn | Simple, no retrieval infra, model sees everything | Full recall, no missed-chunk risk | Token cost scales linearly with corpus size; will not scale past a few dozen pathways | **Implemented.** Documented in `ARCHITECTURE.md` and confirmed still true at 12+8 files today |
| J | Retrieval-augmented grounding (embed pathway units, retrieve by grid cell / dimension / stage before each turn) | Directly addresses the "won't scale past current size" limit of I | The corpus's own tagging (dimension, sub-category, stage, condition tag per unit) is *already* retrieval-shaped — this is a natural next step, not a redesign | Requires an embeddings store and a retrieval step latency-budgeted inside the streaming response | **Not implemented.** `CLAUDE.md`'s own wiki-loading notes flag this as the planned evolution ("revisit with retrieval when it grows"). The Product Charter independently names two adjacent, roadmapped (status: Not started) requirements — "enhance pathway-creation extraction/generation logic" and a "corpus synthesis process (LLM Wiki approach)" for cross-pathway synthesized learnings — that would likely be designed together with this |
| K | Structured extraction via forced tool-use for `<grid_update>` (instead of trailing free-text JSON the client regex-parses) | Removes the fragile "parse JSON out of streamed prose" step that both `library`-mode's absence and every other mode's presence of the block depend on | `app/api/pathways/check-similar/route.ts` already demonstrates forced tool-use (`tool_choice: {type:'tool', name:'report_match'}`) elsewhere in this same codebase | Streaming + forced tool-use together is a bigger SDK-usage change than the current free-text-then-parse pattern | **Partially considered** — the pattern exists in the codebase for a different call, not yet applied to the main `<grid_update>` contract |
| N | Add retries/backoff around `anthropic.messages.stream` | Every Anthropic call in the app has zero retry logic; an SDK-level failure surfaces as an unhandled Next.js 500 | Direct reliability gap, especially for the un-cached, model-call-per-turn companion mode | Streaming responses complicate naive retry (partial output already sent) | **Not implemented**, but explicitly roadmapped — the Product Charter names both "error handling and graceful degradation" and a "defined timeout/retry policy" in its non-functional backlog (status: Not started). See [`knowledge/technical-debt.md#td-05`](../knowledge/technical-debt.md#td-05) |

## Decision guide

| Priority | Software engineering | AI/ML engineering |
|---|---|---|
| Ship the next feature fast | A (stay) | I (stay) |
| Reduce risk of silent breakage from schema drift | B | K |
| Corpus is starting to feel large / costly per turn | — | J |
| Improve reliability of a flaky/failed model call | — | N |
| Improve long-term test confidence | D | — |

## Diagram & reference index

- System context / components: [`component-diagram.md`](component-diagram.md)
- Sequence diagrams (chat turn, contributor publish, explorer document generation): [`sequence-diagrams.md`](sequence-diagrams.md)
- Deployment topology: [`../operations/deployment.md`](../operations/deployment.md)
- ERD: [`../application/database.md`](../application/database.md)

## Risks

- Three files/one lib module/one component reference a dropped table and would 500 if ever invoked (P1, [`TD-01`](../knowledge/technical-debt.md#td-01)).
- Two overlapping pathway corpora (`content/wiki/pathways/` and `content/library-wiki/pathways/`) share several pathway names but are maintained as independent copies — a real content-drift risk (P2, [`TD-02`](../knowledge/technical-debt.md#td-02)).
- No automated tests anywhere in the repository (P1, [`TD-03`](../knowledge/technical-debt.md#td-03)).
- No retry logic on any Anthropic API call (P2, [`TD-05`](../knowledge/technical-debt.md#td-05)).

## Source files

`app/api/chat/route.ts`, `proxy.ts`, `lib/system-prompts.ts`, `lib/adoption-conversation.ts`, `lib/wiki-loader.ts`, `lib/library-wiki-loader.ts`, `lib/github.ts`, `supabase/migrations/0018_drop_retired_tables.sql`, root `ARCHITECTURE.md`, `docs/raw_documents/Pathway Framework.pdf`, `docs/raw_documents/AI DIffusion Cube - Product Charter.docx`.
