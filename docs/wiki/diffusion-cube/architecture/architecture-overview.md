# Architecture Overview

*Re-verified 2026-11-06 against HEAD `0a1ca00` plus uncommitted prompt-rule changes. Major changes since the 2026-10-20 refresh: pathway storage moved into Supabase (migration `0042`), retrieval-based grounding replaced whole-corpus prompts, contributor publishing no longer touches GitHub, every account gets `adopter` at signup (migration `0039`), and a Vitest suite now exists.*

## Summary

Diffusion Cube is a Next.js App Router monolith: one Node process serves pages, API routes, and (via `output: "standalone"`) its own production server. There is no separate backend service, no message queue, and no dedicated cache layer. Supabase is the only stateful dependency — Postgres (with `pgvector`) + Auth + Storage + one Edge Function (`embed`, gte-small embeddings) — alongside the Anthropic API. Three user-facing surfaces (`/explore`, `/analyse`, `/contribute`) share one chat route and one theme; all three now ground their answers in the same database-backed pathway store, retrieved per message. See [`component-diagram.md`](component-diagram.md).

### Architecture Style

| Aspect | Current choice |
|---|---|
| Application shape | Monolithic Next.js App Router app (pages + API routes in one deployable) |
| Rendering | Mixed server components (data-loading pages) + client components (`'use client'` chat/admin UI) |
| State/persistence | Supabase Postgres, accessed directly via `@supabase/supabase-js` — no ORM, no repository layer except `lib/pathway-store.ts` for pathways |
| Pathway corpus | **Database only.** `pathways` + `pathway_versions` (every reviewed or seeded document) + `pathway_units` (searchable micro-innovation rows, full-text + 384-dim vector) + `pathway_sources`/`pathway_source_chunks` (seeded originals). `published_pathways` is a view. Nothing pathway-related is committed to the repo |
| Grounding | Per-message retrieval: Haiku classifier → `embed` Edge Function → `match_pathway_units` hybrid search (vector + full text + label filters, reciprocal-rank fusion) → shaped grounding text (`lib/retrieval.ts`) |
| AI integration | Direct `@anthropic-ai/sdk` calls: `claude-sonnet-4-6` for every answer/document (streamed), `check-similar` and seeding; `claude-haiku-5-5` for the query classifier. Prompt caching on multi-turn modes |
| Embeddings | Self-hosted gte-small inside Supabase's edge runtime — no embedding vendor or extra API key |
| Auth | Supabase Auth (OTP) + Next.js middleware (`proxy.ts`) + per-route role checks (`requiredRole` in the chat route) + Postgres RLS; `adopter` granted by a DB trigger at signup |
| Abuse controls | Per-account (`chat-user`) and per-IP (`explore`) rate limits in Postgres; request-size, message-count and text-length caps (413) on `/api/chat` |
| Testing | Vitest 3 suite (105 files, all external clients mocked); not run in CI — see [`testing.md`](testing.md) |
| Deployment | Vercel (live, via GitHub Actions) **and** a separate Docker/AWS image (built, not CI-wired) — see [`operations/deployment.md`](../operations/deployment.md). The `embed` function and migrations are deployed to Supabase separately |

## Key decisions

1. **One chat route, many modes.** `app/api/chat/route.ts` dispatches on a `mode` string — 7 values: `companion`, `analysis-doc`, `executive-summary`, `extract-insights`, `pathway-draft`, `library`, `asset-reuse` — rather than one route per mode. Auth, validation, streaming and logging live in one place at the cost of a long route file (~440 lines).
2. **The model never writes to the database directly.** Every mode returns streamed text plus (mostly) a trailing `<grid_update>` JSON block; the *client* (`lib/adoption-conversation.ts`) parses it and performs all conversation writes. Pathway-store writes happen only on explicit human actions (Send for Review, admin Publish, the seed script). This keeps the model stateless per call and every persisted write auditable.
3. **Pathways live only in the app's database** (`docs/features/pathway-storage/`, migration `0042`). The previous split — static markdown in `content/wiki/pathways/` merged with a `published_pathways` table, plus GitHub commits from contributor publish — is gone. One store, versioned, with the live document chosen by `pathways.published_version_id`. `published_pathways` was kept as a **view** with the same columns so existing readers kept working; it runs with owner rights so anonymous `/explore` can read it (intentional, flagged in the migration header).
4. **Retrieve per message instead of injecting the corpus.** The corpus's own tagging (dimension, sub-category, stage, unit type, applies/fails-when) is indexed per unit; a cheap Haiku call classifies each question (`specific | situation | broad | patterns`), and only the matching documents or units are sent. Counts for "common pattern" claims are computed in code. Failures degrade (default kind; text-only search) rather than erroring.
5. **Publishing is two independently-gated steps.** Contributor **Send for Review** (`/api/pathways/assemble`) appends a `pathway_versions` row; only an admin **Publish** (`publishVersion`) points the pathway at that version and indexes its units. Seeded pathways skip review by business decision. Delete removes the pathway row and cascades everything, so delete = unpublish.
6. **Middleware gates sessions, not roles; the API is the real boundary; RLS is the floor.** `proxy.ts` checks only "is there a signed-in user" (with a public-path list); pages check roles for UX; API routes re-check against the session (`requiredRole(mode, flow)` in the chat route); RLS (e.g. `0040` — pathways visible only to their contributors and admins) backs it up. Every account holds `adopter` from creation via a trigger, so there is no pending-approval state; `pathway_contributor` and `admin` are still admin-granted.
7. **No caching layer for LLM output beyond content-hash dedup and prompt caching.** `design_documents.content_hash` makes an unchanged-conversation document regeneration a DB read; `lib/prompt-cache.ts` uses Anthropic ephemeral cache breakpoints for `companion` and `library`. See [`integrations/caching.md`](../integrations/caching.md).

## Reconciliation with Raw Architecture Documents

`docs/raw_documents/Pathway Framework.pdf` is the original AI Diffusion Pathway Framework specification; `content/framework.md` and `content/pathway-generation-prompt.md` are a current, accurate, near-verbatim transcription of it (see row 7 below) — no gap found. This repository also keeps its own architecture narrative in root-level markdown files. `ARCHITECTURE.md` (repo root) positions itself as the corrective to `CLAUDE.md`'s earlier description, but predates the pathway-storage change and is now stale on storage and grounding (row 9). Full raw-document inventory: [`wiki-index.md`](../wiki-index.md#source--raw-documents).

| # | Document | Claim | Code-verified behavior |
|---|---|---|---|
| 1 | `CLAUDE.md` (earlier version) | Explorer entry point is `/explore`, four-card intent menu (browse/validate/troubleshoot/guidance) | Explorer entry point is `/analyse`; `lib/explorer-intents.ts` defines exactly one flow, `ANALYSE_FLOW` (5 steps; step 2 now picks the single best-matching pathway) — the four-intent menu is gone. `/explore` now means the public Library |
| 2 | `CLAUDE.md` (earlier version) | Grid is "surfaced as four colored status chips (not a table)"; `DimensionChips.tsx` exists | `DimensionChips.tsx` does not exist anywhere in the repo. `components/HeatmapGrid.tsx` renders a literal `<table>` |
| 3 | `ARCHITECTURE.md` §5 | "The grid is surfaced as four status chips and a Grid button, not a table. The 4×4 table UI was deliberately removed" | Same contradiction as #2 — `HeatmapGrid.tsx` is a real `<table>`, opened by a "▦ Grid" button in `AdoptionWorkspace.tsx` |
| 4 | `CLAUDE.md` (earlier version) | Contributor drafts persist in `pathway_submissions`/`pathway_submission_versions` | Both tables were dropped in migration `0018`; contributor drafts live in `design_documents` (`doc_type='draft'`), and Send for Review saves a `pathway_versions` row via `lib/pathway-store.ts` (no GitHub commit since `0042`). No code path queries the dropped tables any more — only a historical comment in `lib/adoption-conversation.ts` mentions them (see [`knowledge/technical-debt.md#td-01`](../knowledge/technical-debt.md#td-01)) |
| 5 | `SIGNUP_APPROVAL_OPTIONS.md` | Admin approves signups via an emailed review link; roles set by hand in the Supabase Table Editor | `/admin` is a full in-app dashboard (`AdminDashboard` + checkbox role grants via `POST /api/admin/roles`); signup is self-serve OTP (`SIGNUP_OTP_SPEC.md`) and the `adopter` role is granted by the `0039` trigger in the same transaction that creates the user — no approval step at all |
| 6 | `conversation_design.md` | Describes the companion's reasoning/tone philosophy in detail | Predates the intent-menu removal, the `pathways`/`organisations` schema, the `/analyse` rename and retrieval grounding. Still credible for *tone/posture*, not for routing, roles, schema or grounding |
| 7 | `docs/raw_documents/Pathway Framework.pdf` | The 4-dimension/4-stage framework, unit types, and Sections 0–6 + Source Trace pathway document structure | **Confirmed, no gap.** `content/framework.md`/`content/pathway-generation-prompt.md` match. The unit structure is now also machine-parsed: `lib/pathway-units.ts` turns each published document's micro-innovation units into `pathway_units` rows (units with invalid labels are skipped and reported to the admin) |
| 8 | `docs/raw_documents/AI DIffusion Cube - Product Charter.docx` | Product roadmap and requirements backlog through 15-Mar-27 | Forward-looking intent — see [`../business/business-overview.md#roadmap-planned-not-yet-implemented`](../business/business-overview.md#roadmap-planned-not-yet-implemented). Its "enhance pathway-creation extraction" and "corpus synthesis" items are adjacent to the now-implemented retrieval (row J below); its timeout/retry backlog item is still open (row N) |
| 9 | `ARCHITECTURE.md` / `CLAUDE.md` wiki-loading notes | Whole corpus (~22K tokens) injected per turn; "revisit with retrieval when it grows"; pathways committed to `content/wiki/pathways/` | **Superseded.** `content/wiki/` no longer exists; pathways are in Supabase and each message is grounded by `lib/retrieval.ts` (row J, Implemented) |

## Alternative Architecture Approaches

### Software engineering perspectives

| ID | Approach | Summary | Pain addressed | Trade-offs | Fit for this codebase |
|---|---|---|---|---|---|
| A | **Current: monolithic Next.js route handlers, direct Supabase client calls, one service-role store module for pathways** | One deployable; no ORM; prompt logic, retrieval and data access live in flat `lib/` modules; `lib/pathway-store.ts` is the only repository-style module | Simple mental model, fast to ship, matches a small team | No generated schema types — table/column names are strings checked only by mocked tests; the chat route keeps growing | **Implemented.** Reasonable at current scale (~41 lib files, 37 components) |
| B | Typed data-access layer (generated Supabase types + a thin module per table, extending the `pathway-store.ts` pattern) | Centralizes query shape, catches drift when migrations change columns | Mocked tests can't see a renamed column; `0042` renamed a table into a view and changed its readers' source | Refactor cost across many call sites | **Partially considered** — `pathway-store.ts` shows the pattern for one domain; the rest of the app still queries tables inline |
| C | Split `app/api/chat/route.ts`'s 7 modes into separate route files sharing a common validated handler | Smaller diffs per mode, clearer ownership | The route now carries rate limiting, six validation steps, retrieval wiring and two streaming loops | More boilerplate; loses the one-place-for-auth/validation benefit | **Not implemented.** Revisit if the mode count or per-mode logic keeps growing |
| D | Automated tests (unit for `lib/`, route-handler tests for `app/api/`, component tests) | Regression safety for the app's own logic | The migration-0027 class of silent breakage | Mocks can drift from real services; no CI gate yet | **Implemented** (Vitest 3, 105 files, 2,231 cases; 1 stale failure on the last run). Not wired into CI, no DB-level or E2E tests — see [`testing.md`](testing.md) |

### AI / ML engineering perspectives

| ID | Approach | Summary | Pain addressed | Trade-offs | Fit for this codebase |
|---|---|---|---|---|---|
| I | Whole-corpus prompt injection (framework + every pathway document per turn) | No retrieval infra; model sees everything | Full recall | Token cost grows linearly with the corpus; stops scaling past a few dozen pathways | **Superseded** — was the implementation until the pathway-storage feature; removed from the chat route |
| J | **Current: hybrid retrieval grounding** — Haiku classifier (forced tool use) → gte-small embedding via the `embed` Edge Function → `match_pathway_units` (vector + full text + label filters, RRF k=50) → per-kind shaping with `LIMITS`; public source passages as a fallback for seeded pathways | Sends only what a question needs; uses the corpus's own tags as filters; exact pattern counts computed in code | Scales past the I limit; cuts per-turn tokens; enables "common pattern" answers with real counts | Extra Haiku call + embedding round-trip per Analyse/Library question; recall depends on classification and `LIMITS`; quality checked only by a hand-run test set | **Implemented** (`lib/retrieval.ts`, `lib/embeddings.ts`, migration `0042`). The Charter's "corpus synthesis (LLM Wiki approach)" item would build on top of it |
| K | Structured extraction via forced tool-use for `<grid_update>` (instead of trailing free-text JSON the client regex-parses) | Removes the fragile "parse JSON out of streamed prose" step | `check-similar` and now the retrieval classifier both already use forced tool use (`tool_choice: {type:'tool', …}`) | Streaming + forced tool use together is a bigger SDK change than the current pattern | **Partially considered** — the pattern is used twice for non-streamed calls, not yet for the main `<grid_update>` contract |
| N | Retries/backoff around Anthropic calls | An SDK-level failure surfaces as a 500 (pre-stream) or a stream error | Direct reliability gap, now on two models per Analyse turn | Streaming complicates naive retry (partial output already sent) | **Not implemented** for Anthropic. The repo's first retry logic exists only in `lib/embeddings.ts` (2 retries on 503/504/546). Roadmapped in the Charter's non-functional backlog. See [`knowledge/technical-debt.md#td-05`](../knowledge/technical-debt.md#td-05) |

## Decision guide

| Priority | Software engineering | AI/ML engineering |
|---|---|---|
| Ship the next feature fast | A (stay) | J (stay) |
| Reduce risk of silent breakage from schema drift | B, D (add CI + DB tests) | K |
| Answers miss relevant pathways / cite the wrong one | — | J (tune `LIMITS`, classifier prompt, test set) |
| Improve reliability of a flaky/failed model call | — | N |
| Chat route becoming hard to change safely | C | — |

## Diagram & reference index

- System context / components: [`component-diagram.md`](component-diagram.md)
- Sequence diagrams — chat turn (W1), contributor Send for Review → admin Publish (W2), Analysis Document (W3), retrieval grounding (W4), Library chat (W5), seeding (W6), default adopter role (W7): [`sequence-diagrams.md`](sequence-diagrams.md)
- Coding patterns (validation order, retrieval conventions, prompt-rule constants): [`coding-patterns.md`](coding-patterns.md)
- Tests: [`testing.md`](testing.md)
- Deployment topology: [`../operations/deployment.md`](../operations/deployment.md)
- ERD: [`../application/database.md`](../application/database.md)
- LLM prompts and contract: [`../integrations/ai-llm.md`](../integrations/ai-llm.md)

## Risks

- **Destructive migration `0042`.** Applying it drops every row of the old `published_pathways` table and unpublishes every pathway; the library is empty until `npm run seed:pathways` runs and admins re-publish contributor pathways. Order per environment: migration → deploy `embed` → seed.
- **New runtime dependency on the `embed` Edge Function.** If it is missing or failing, search silently falls back to full text + labels and newly published units have no vectors (re-publish embeds them). Quality drops without an error page — watch `sys_errors` for `lib/embeddings`.
- **Two model calls per Analyse/Library question** (Haiku classifier + Sonnet answer), with no Anthropic retry on either (P2, [`TD-05`](../knowledge/technical-debt.md#td-05)). A classifier failure degrades to a default kind; a Sonnet failure is user-visible.
- **Owner-rights view.** `published_pathways` deliberately bypasses RLS so anonymous `/explore` can read it; it must keep filtering to `status = 'published'`. Supabase's linter will flag it.
- **Tests exist but don't gate anything.** No CI step runs `npm test`; the last run had one stale failure. DB behaviour (RLS, `match_pathway_units`) is untested ([`TD-03`](../knowledge/technical-debt.md#td-03)).
- ~~Dead code referencing dropped tables~~ — no live code path queries `pathway_submissions` any more ([`TD-01`](../knowledge/technical-debt.md#td-01)).
- ~~Two overlapping pathway corpora~~ — resolved 2026-10-20, and the static corpus itself removed by `0042` ([`TD-02`](../knowledge/technical-debt.md#td-02)).

## Source files

`app/api/chat/route.ts`, `proxy.ts`, `lib/system-prompts.ts`, `lib/retrieval.ts`, `lib/embeddings.ts`, `lib/pathway-store.ts`, `lib/pathway-units.ts`, `lib/provenance.ts`, `lib/prompt-cache.ts`, `lib/adoption-conversation.ts`, `lib/wiki-loader.ts`, `lib/roles.ts`, `lib/rate-limit.ts`, `app/api/pathways/assemble/route.ts`, `app/api/admin/pathways/{publish,delete,document}/route.ts`, `scripts/seed-pathways.ts`, `supabase/functions/embed/index.ts`, `supabase/migrations/{0018_drop_retired_tables,0039_default_adopter_role,0040_pathways_member_rls,0042_pathway_storage}.sql`, `vitest.config.mts`, root `ARCHITECTURE.md`, `docs/features/pathway-storage/`, `docs/raw_documents/Pathway Framework.pdf`, `docs/raw_documents/AI DIffusion Cube - Product Charter.docx`.
