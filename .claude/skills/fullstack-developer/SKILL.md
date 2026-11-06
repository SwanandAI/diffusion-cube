---
name: fullstack-developer
description: >
  End-to-end feature development skill, tailored to Diffusion Cube (Next.js 16 / React 19 /
  TypeScript, Supabase Postgres+Auth+RLS+Storage+pgvector with no ORM, pathway content stored in
  Supabase via `lib/pathway-store.ts`, retrieval-based grounding with hybrid search, a single
  Anthropic-backed `/api/chat` route dispatching on `mode`, every route wrapped by
  `withErrorHandling`, Vitest 3 test suite under `tests/`). Trigger this skill whenever the user asks
  to "add a feature", "add a route/endpoint/API", "add a column/table", "wire this into the UI", "add
  a config option", "change the generation/processing pipeline", "add a page", or describes work
  that touches both a data/service layer and a UI layer in the current repo. Takes the request from
  data model through service/route logic through external-integration/business logic through UI,
  following *this specific codebase's* actual conventions rather than generic framework advice —
  this skill's job is to discover those conventions (or use ones already recorded) before writing a
  single line of code. Does not apply to single-layer bug fixes with no schema/route/UI surface —
  use targeted investigation for those instead. Also triggers on "update this skill to suit the
  tech stack of this codebase" — see **Tailoring this skill to a specific codebase** at the bottom.
---

# Full-Stack Development

A guided workflow for building a feature in **Diffusion Cube** — the Next.js 16 (App Router) /
React 19 / TypeScript 5 companion app to 100pathways.com. This skill has been tailored to this
repo's actual, verified stack (see "Tailoring" at the bottom for when/against what): Supabase
(Postgres + Auth + RLS + Storage + `pgvector` + one Edge Function) accessed with raw
`.from('table')`/`.rpc()` calls and no ORM; **all pathway content lives in Supabase** (no pathway
files in the repo) behind `lib/pathway-store.ts`; grounding is retrieved per message by
`lib/retrieval.ts`; one `route.ts` per API endpoint except the single mode-dispatching
`app/api/chat/route.ts`; every route wrapped by `withErrorHandling` (`lib/errors.ts`); an
Anthropic-backed model-never-writes-DB convention for every AI-generated artifact; a flat
`components/` directory with server/client page pairs; and a **Vitest 3 suite under `tests/`**
(105 files, every external client mocked) that CI does not run. Every phase below names this repo's
real files and conventions instead of generic placeholders — if a future change to the stack makes
any of this stale, re-run the Tailoring procedure at the bottom rather than trusting this file
blindly.

**Golden rule: ground every phase in what this repo actually does before writing code.** The
primary source of truth is the LLM-native wiki at `docs/wiki/diffusion-cube/` (start with
`ai-context.md` and `repository-map.md`) — refreshed and verified against this branch's code on
2026-11-06. `CLAUDE.md` is now a short pointer into that wiki (its "no tests" table cell and its
GitHub/Sheets services mention are stale). `ARCHITECTURE.md`, `README.md`, `AGENTS.md` and
`conversation_design.md` are **stale** (`docs/wiki/diffusion-cube/knowledge/technical-debt.md#td-08`)
— `ARCHITECTURE.md` in particular still describes a committed `content/wiki/` corpus and a
`published_pathways` table, neither of which exists any more. Don't take a root doc's claim about
routes, tables, the corpus or the publish flow at face value without cross-checking the wiki or the
code itself.

---

## Phase 0 — This repo's actual stack (already discovered — re-verify only if something looks stale)

- **Language/runtime + package manager**: TypeScript 5, npm (`package.json` + `package-lock.json`),
  Next.js `16.2.9`.
- **Web/service framework**: Next.js 16 App Router. Pages and API route handlers both live under
  `app/`; middleware is `proxy.ts` at the repo root (a standard Next.js middleware file despite the
  name) — it gates every route except a public allow-list, calls `supabase.auth.getUser()`, and
  forwards an `x-user-email` header so server components can skip a second lookup.
- **Data layer**: **no ORM.** Raw Supabase client calls (`.from('table')...`, `.rpc(...)`) inside
  `app/api/**/route.ts` handlers and `lib/` modules. Canonical schema is `supabase/migrations/`
  (**42** sequential files, `0001`–`0042`) — that directory *is* the source of truth. `pgvector` is
  enabled (`0042`), with HNSW indexes on `pathway_units.embedding` and
  `pathway_source_chunks.embedding` (`vector(384)`). Two private Storage buckets: `toolkit-assets`
  (`0034`) and `pathway-sources` (`0042`), both service-role only.
- **Pathway storage (`0042`)**: `pathway_versions` (every reviewed document), `pathway_units`
  (published micro-innovations, `fts` + embedding), `pathway_sources`/`pathway_source_chunks`
  (seeded originals); `pathways.status` (`draft`/`in_review`/`published`/`retired`) +
  `published_version_id`. **`published_pathways` is now a view**, not a table. All reads/writes go
  through `lib/pathway-store.ts` (`saveVersion`, `publishVersion`, `latestVersion`, `listPublished`,
  `getPublishedDocument(s)`, `buildOverview`, `adopterDocument`, `removeSourceObjects`).
- **Auth pattern**: Supabase session cookies, re-validated per request. `proxy.ts` is UX-only
  session gating; real enforcement is each `route.ts` independently calling `lib/roles.ts`
  (`hasRole`/`hasAnyRole`/`currentRoles`/`isAdmin`/`isAdminEmail`) against the caller's session; the
  chat route uses `requiredRole(mode, flow)` over `currentRoles()`. RLS is the last layer. Every
  account gets `adopter` at signup via a DB trigger (`0039`); roles are `adopter`,
  `pathway_contributor`, `admin` (plus `ADMIN_EMAILS`, which RLS cannot see).
- **External integrations**: `@anthropic-ai/sdk` `^0.106.0` with **two hardcoded model IDs**:
  `claude-sonnet-4-6` (all `/api/chat` modes — `app/api/chat/route.ts`; `app/api/pathways/check-
  similar/route.ts`; `GENERATION_MODEL` in `scripts/seed-pathways.ts:38`) and `claude-haiku-5-5`
  (`CLASSIFIER_MODEL`, `lib/retrieval.ts:28`, the per-message retrieval classifier). Embeddings come
  from the self-hosted **`embed` Supabase Edge Function** (`supabase/functions/embed/`, Deno,
  `gte-small`, 384 dims) via `lib/embeddings.ts` — no embedding vendor key. Also `lib/email.ts`
  (nodemailer/SMTP for auth email via the send-email hook), `lib/errors.ts` (`sys_errors`),
  `lib/ai-usage.ts` (`ai_usage`), `lib/rate-limit.ts` (`rate_limits`). **`lib/github.ts` and the
  GitHub Contents API publish step have been removed**, as has Google Sheets logging.
- **Frontend approach**: React 19 client components inside the App Router, no client-state library
  (no Redux/Zustand) — local `useState` plus one substantial shared hook,
  `lib/adoption-conversation.ts`'s `useAdoptionConversation`. Tailwind CSS v4, brand tokens in
  `app/globals.css`'s `@theme inline` block.
- **Test setup**: **Vitest 3** (`vitest.config.mts`), 105 `*.test.ts(x)` files under `tests/`
  (`unit/lib`, `unit/server`, `api`, `client`, `features`, `pages`, `proxy`, `db`, shared fakes in
  `helpers/`), Testing Library + jsdom for components. `npm test`, `npm run test:watch`,
  `npm run test:coverage`. Every external client is mocked (`tests/setup.ts`,
  `tests/helpers/supabase-mock.ts`, `tests/helpers/anthropic-mock.ts`); no test reaches real
  Supabase/Anthropic/Edge Function/SMTP. **CI (`.github/workflows/deploy.yml`) runs no tests, lint or
  typecheck** (TD-03). No Playwright/Cypress. See Phase 6 and
  `docs/wiki/diffusion-cube/architecture/testing.md`.
- **Scripts**: `scripts/seed-pathways.ts` (`npm run seed:pathways -- --manifest <file> [--dry-run]
  [--only a,b] [--regenerate]`, pure helpers in `lib/seed.ts`), `scripts/smtp-test.mjs` (manual SMTP
  diagnostic).
- **Existing docs**: `docs/wiki/diffusion-cube/` (primary), `docs/features/<feature-slug>/`
  (per-feature requirement/plan/task docs — `pathway-storage`, `toolkit-asset-files`,
  `monitoring-logging-cleanup`), `docs/audits/2026-10-22/`, `.env.example` (repo root).

If anything above looks like it's drifted from the current code, say so explicitly and re-verify
against the wiki or the code directly before proceeding — don't silently trust this snapshot.

---

## Phase 1 — Scope the request

Before touching any file, pin down what layers this feature actually needs:

- **Data**: a new field/table, or a new column on `designs`/`design_documents`/`pathways`/
  `pathway_versions`/`pathway_units`/`contribution_units`/etc.? → `supabase/migrations/`, numbered
  one higher than the current max (`0043` next, as of this writing — check first). If it changes
  what the public library shows, it may also touch the `published_pathways` **view** definition
  (see Phase 2.7).
- **Route/API**: a genuinely new endpoint → a new `route.ts` under `app/api/**/`, wrapped in
  `withErrorHandling`. A new AI-conversation behavior (a new document type, a new step in an
  existing flow, a new signal the model can emit) is much more likely to be **a new `mode` inside
  `app/api/chat/route.ts`** plus a new prompt builder in `lib/system-prompts.ts` — check
  `docs/wiki/diffusion-cube/application/api-specification.md` and
  `docs/wiki/diffusion-cube/integrations/ai-llm.md` for the current 7 modes first.
- **Retrieval/grounding**: does it change what pathway evidence a reply is grounded on? →
  `lib/retrieval.ts` (`buildGrounding`, `Surface`, `LIMITS`, classifier) and possibly
  `match_pathway_units` (SQL, a migration) — not a prompt string.
- **Integration/business logic**: Anthropic SDK, the `embed` Edge Function, the pathway store,
  Supabase Auth/email, toolkit-asset storage — or a new configurable dimension to the framework
  (`content/framework.md` + `lib/dimensions.ts`)? Answer-shape changes go through the shared rule
  constants in `lib/system-prompts.ts` (Phase 4.8).
- **UI**: new page/view under `app/`, a new field surfaced in `AdoptionWorkspace.tsx`/
  `ChatPanel.tsx`/`HeatmapGrid.tsx`/`AdminPathwaysPanel.tsx`, or wiring an existing endpoint in?
- **Tests**: which `tests/` folder(s) the change needs coverage in (Phase 6).

Read only the wiki pages that match the layers above (`application/database.md`,
`application/api-specification.md`, `application/backend.md`, `application/frontend.md`,
`integrations/ai-llm.md`, `architecture/testing.md`) — don't load the whole doc set for a narrow
change. For a larger feature, the `brd-validation` → `architecture-plan` → `task-creation` skills
write into `docs/features/<feature-slug>/`, matching existing feature folders.

If the feature is ambiguous in scope, ask one focused question before planning — don't guess at
schema shape, request/response shape, or UI copy. A wrong guess here costs a migration + route + UI
+ tests rewrite, not just a line edit.

---

## Phase 2 — Data layer

1. **There is no ORM.** The schema source of truth is `supabase/migrations/` itself (42 files) — a
   migration file *is* the whole schema change. See
   `docs/wiki/diffusion-cube/application/database.md` for the post-migration schema synthesis, ERD,
   database functions and per-table RLS before writing a new one.
2. **Match existing naming and typing conventions.** Check a couple of existing tables first —
   e.g. `designs` is the DB name for what the UI calls an "adoption" (legacy name kept deliberately,
   `architecture/repository-conventions.md`). jsonb columns (`meta`, `grid_state`, `messages`) hold
   flexible conversation state — a new field that's conceptually part of conversation state belongs
   as a new `designs.meta` key, not a new top-level column.
3. **Connection pattern**: client factories in `lib/supabase/` — `client.ts` `createClient()`
   (browser), `server.ts` `createClient()`/`createStatelessClient()` (RLS-respecting, server), and
   `admin.ts` `createAdminClient()` (service role, bypasses RLS). Service-role modules
   (`lib/pathway-store.ts`, `lib/retrieval.ts`) state "callers check who may call" and take an
   optional `admin` client parameter so routes can pass theirs and tests can inject a mock — follow
   that shape for a new service-role module. Don't reach for the admin client to route around an
   inconvenient RLS policy — that's a security decision needing an explicit call-out.
4. **Grid/framework sibling structures**: `lib/dimensions.ts` holds the *structural* shape of the
   4×4 grid (dimension codes, sub-categories, per-stage weights); `content/framework.md` holds the
   *substantive* question bank the model is prompted with. A new dimension/sub-category needs both —
   a code-only change is a silent no-op for the model. Pathway units also carry `dimension`/
   `sub_category`/`stage`, parsed by `lib/pathway-units.ts` `parseUnits` and filtered by
   `match_pathway_units` — check those too.
5. **RLS is real enforcement here, confirm both sides for any new or touched table.** Examples:
   `pathways` insert requires `pathway_contributor` (`0020` `exists` policy); `pathways`/
   `pathway_versions` reads are limited to that pathway's contributors and `admin` role rows
   (`0040`) — `ADMIN_EMAILS` admins are invisible to RLS, which is why admin reads go through
   service-role routes (`app/api/admin/pathways/document`). Server-only tables (`sys_errors`,
   `ai_usage`, `rate_limits`, `pathway_sources`, `pathway_source_chunks`) have RLS on with **no
   policies**. A new feature writing a role-gated table needs a matching RLS policy in its migration
   *and* an app-layer role check. Note the open debt TD-24 (insert policies on
   `pathway_contributors`/`contributor_registrations` don't restrict columns) — don't copy that
   pattern.
6. **Database functions**: Postgres functions are PUBLIC-executable by default, so every function in
   this repo explicitly `revoke`s execute from `public`/`anon`/`authenticated` and grants
   `service_role` only (`match_pathway_units`, `match_source_chunks`, `check_rate_limit`,
   `admin_usage_stats`, `purge_old_sys_errors`). Do the same for any new function.
7. **The `published_pathways` view runs with owner rights by design (TD-18)** so anonymous
   `/explore` can read it — do **not** "fix" it to `security_invoker`, and treat any column you add
   to its `select` list as publicly readable.
8. **Migrations**: numbered one higher than the current max, with a leading SQL purpose comment;
   any destructive step called out in capitals as `0042` does
   (`architecture/repository-conventions.md#migration-conventions`). Most migrations are additive;
   the documented destructive ones are `0008`, `0018`, `0039` and **`0042`** (drops the old
   `published_pathways` table and its rows, unpublishes every pathway — TD-17; there is no copy of
   pathway content outside Supabase). Don't imitate those by default. `tests/db/migrations.test.ts`
   checks migration text (sequential numbering, RLS on every table, server-only search functions,
   **`0042` being the latest migration** and flagged destructive) — a new migration will need that
   test updated, and may need new assertions for a new table/function.
9. **Do not build on dropped or inert tables**: `pathway_submissions*` (dropped `0018`; the dead code
   was deleted, TD-01), the old `published_pathways` table (dropped `0042`), and the inert
   `pathway_cache`, `wiki_cache`, `pending_signups` (no code references them). Dead columns:
   `designs.document_review_turns_left`/`typed_intro_turns_left`.
10. **`contribution_units` is live** (since `0034`) — it carries **toolkit assets**, written only
    through service-role routes (`app/api/toolkit-assets/*`, assemble, admin publish/delete,
    `app/api/contributions/[designId]`, `lib/account-deletion-server.ts`) via
    `lib/toolkit-assets.ts`/`lib/toolkit-assets-server.ts`, with a
    `contribution_units_toolkit_asset_shape` check constraint. Per-unit *search* rows for published
    pathways live in `pathway_units` instead. For a pathway/framework-schema enhancement, decide
    which of these two is the right home (or neither) with the user before designing a parallel
    structure.
11. **Pathway lifecycle lives on `pathways.status`**: `draft` → `in_review` (first `saveVersion`) →
    `published` (admin `publishVersion`). `retired` is allowed but nothing sets it (TD-22); delete is
    permanent and cascades. Card fields on `pathways` are overwritten from the version's frontmatter
    on publish. `pathways.content_cache`/`review_requested`/`assembled_design_doc_id` still exist and
    are still written by assemble — `pathway_versions` is the canonical history.

---

## Phase 3 — Route / API / service layer

1. **One `route.ts` per endpoint, named by resource/action path, not HTTP verb** — e.g.
   `app/api/pathways/[id]/join/route.ts`, `app/api/admin/pathways/publish/route.ts`. **The one
   exception is `app/api/chat/route.ts`**, dispatching on `mode` across **7 modes** (the `MODES`
   array): `companion`, `analysis-doc`, `executive-summary`, `extract-insights`, `pathway-draft`,
   `library`, `asset-reuse`. (`plan-document` and `pathway-exec-summary` were removed and now return
   400.) A new AI-backed feature is far more likely to be a new mode + a new builder in
   `lib/system-prompts.ts` than a new route.
2. **Every route goes through `withErrorHandling`**: define `async function handle<METHOD>(...)` and
   `export const <METHOD> = withErrorHandling('api/<path>', handle<METHOD>)` (e.g.
   `app/api/pathways/route.ts:138-139`). Return 4xx or throw `ValidationError`/`AuthError`/
   `NotFoundError` (`lib/errors.ts`) for expected failures; let anything else throw. The wrapper
   replaces every 5xx body with `GENERIC_ERROR_MESSAGE` (`lib/error-messages.ts`) and records the
   real text in `sys_errors` — never put raw error text in a browser-facing response.
3. **Auth**: "UX at the page, enforcement at the API, RLS underneath." Gated pages
   (`app/analyse/page.tsx`, `app/contribute/page.tsx`, `app/admin/page.tsx`) check role only for
   what to *render*; the API re-derives the caller's role from the real session via `lib/roles.ts`
   (chat: `requiredRole(mode, flow)` — `pathway-draft`, `asset-reuse`, and contributor-flow
   `companion`/`extract-insights` need `pathway_contributor`, everything else `adopter`). A new
   gated surface needs **both** checks. `proxy.ts` only gates session presence.
4. **Request validation order for model-calling routes** (`app/api/chat/route.ts`, cheapest first,
   so a refused request never costs a DB read or a Claude call): rate limit before parsing
   (`checkRateLimit` in `lib/rate-limit.ts` — `chat-user` per account 30/min, 300/day; `explore` per
   IP 20/200; env-tunable) → body size (`MAX_BODY_CHARS`, 413) → JSON/mode/library-input shape (400,
   `lib/explore-guard.ts`) → role (403) → message/object shape (`MAX_MESSAGES`, 400) → text size
   (`MAX_TEXT_CHARS`, 413). New model-calling routes should follow the same order, with named
   constants and a comment on where each cap comes from.
5. **No known unauthenticated debug/test-login backdoor exists.** If one turns up, flag it rather
   than extending or quietly fixing it. (There is a leftover "TEMPORARY dev-only diagnostic"
   `console.log` in `app/api/chat/route.ts`, TD-25 — not a backdoor; leave it unless the task is to
   remove it.)
6. **Streaming errors**: a failure before streaming starts is caught by `withErrorHandling`. Mid-
   stream failures must be caught inside the stream loop — follow `streamFailed()` in
   `app/api/chat/route.ts` (records `sys_errors` + `ai_usage ok:false`, errors the stream). Known
   gap: the `ReadableStream` has no `cancel` handler (TD-19) — don't fix it silently as a side effect.
7. **Pathway writes go through `lib/pathway-store.ts`** — `saveVersion` (contributor "Send for
   review", `app/api/pathways/assemble`) and `publishVersion` (admin publish, which parses units,
   embeds them, flips status). Never write `pathway_versions`/`pathway_units` from a route directly,
   and never add pathway markdown under `content/`; seed via `npm run seed:pathways` instead. Known
   gap TD-23: admin publish publishes the *latest* version at click time, not the one reviewed.
8. **Storage**: no generic storage abstraction. Toolkit assets use the `toolkit-assets` bucket via
   `lib/toolkit-assets-server.ts` (signed upload URLs, `app/api/toolkit-assets/upload-url`); seeded
   source documents use `pathway-sources` (`SOURCES_BUCKET`, `lib/pathway-store.ts`). Clean-up on
   delete (`removeSourceObjects`, `removeAssetObjects`) is best-effort.
9. **Invariant-critical writes**: the model-never-writes-DB pattern (Phase 4.1) governs anything a
   model turn triggers. Pathway-store writes are triggered only by explicit human actions. There is
   no ledger/audit-log module; flag it as new infrastructure if a feature needs one.
10. **New configurable option on the framework/grid**: `content/framework.md` (question bank,
    edited directly, no code change) + `lib/dimensions.ts` (structure) — not an inline literal in a
    route or prompt string. Retrieval tunables live in `LIMITS` (`lib/retrieval.ts`), tuned against
    `docs/features/pathway-storage/test_set_pathway_storage.md`.
11. **Rate limiting and request caps exist; PII screening does not.** Per-account/per-IP limits,
    size caps and `requiredRole` cover every `/api/chat` caller (TD-15 mostly resolved). Still open:
    **no PII screening** of uploaded documents before they reach prompts, drafts or seeded sources,
    and toolkit-asset uploads aren't content-screened — pre-existing, roadmapped debt (Product
    Charter backlog). Don't silently "fix" it as scope creep; only add it if the task asks. Per-IP
    limits trust the first `X-Forwarded-For` hop (TD-21).
12. **Trace a new field through every response path it appears in.** `designs.meta` is re-injected
    every turn via `currentProgressBlock()` in `lib/system-prompts.ts` because `<grid_update>` is
    stripped before storage — a new `meta` key must flow through both that and the client merge in
    `lib/adoption-conversation.ts`. `design_documents` is append-only but only the *latest* row per
    `(design_id, doc_type)` is read back for `analysis`/`plan` — a new doc_type needs an explicit
    decision: supersede, or behave like `draft` (every version browsable in
    `PathwayDocumentPane.tsx`). Analysis Document / Executive Summary regeneration is deduplicated by
    `hashConversationState` (`lib/design-documents.ts`).
13. **Side effects**: non-critical writes (telemetry, notification email, storage clean-up) are
    fire-and-forget (`after()` or their own try/catch) and never fail the main action; call
    `logError()` if a failure matters.

---

## Phase 4 — External integration / business-logic layer (only if this feature touches one)

1. **The model never writes to the database — architecturally load-bearing**
   (`architecture/coding-patterns.md`). Every mode's output is streamed prose plus (for most modes)
   a trailing `<grid_update>` JSON block (`lib/grid-update.ts` `parseGridUpdate`/`stripGridUpdate`).
   The chat route's only writes are telemetry (`adoption_queries`, `ai_usage`, `sys_errors`).
   Persistence of anything a model turn triggers happens **client-side** in
   `lib/adoption-conversation.ts` after the stream completes. A new AI-generated-artifact feature
   follows the same shape:
   - the model signals intent via a new `<grid_update>` field (like `explorerAction`/
     `pathwayAction`, or the toolkit-asset fields);
   - `lib/adoption-conversation.ts` picks it up after the stream ends and makes the write;
   - the artifact is reopened via a **client-constructed** chat message carrying a marker constant
     exported from `lib/grid-update.ts` (`PATHWAY_DOC_MARKER`, `ANALYSIS_DOC_MARKER`,
     `EXEC_SUMMARY_MARKER`, `TOOLKIT_ASSET_CONSENT_MARKER`, `RESOURCE_REVIEW_MARKER`,
     `ASSET_SHARE_MARKER`, `PUBLISH_CONSENT_MARKER`), parsed by `components/ChatPanel.tsx` and
     `lib/adoption-conversation.ts`. (`DELIVERABLE_START`/`DELIVERABLE_END` were removed.)
   Don't write a new artifact's row from `app/api/chat/route.ts` — that needs an explicit call-out.
2. **Client instantiation**: `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })` at module
   scope in `app/api/chat/route.ts`, `app/api/pathways/check-similar/route.ts` and
   `lib/retrieval.ts` (the seed script builds its own per run) — no shared client factory. Model IDs
   are hardcoded per call site (`claude-sonnet-4-6` for generation, `CLASSIFIER_MODEL =
   'claude-haiku-5-5'` for classification) — TD-20 tracks centralising them. Match the existing
   choice for the kind of call (Sonnet for user-facing generation, Haiku only for cheap routing)
   rather than introducing a per-feature model-selection mechanism; if a feature genuinely needs
   one, propose centralisation (TD-20) as its own change.
3. **Retry/backoff**: in-app Anthropic calls have **no explicit retry/timeout policy** — no client
   sets `maxRetries`/`timeout`, so only the SDK default applies (2 retries before a response starts,
   10-min timeout; nothing mid-stream) (TD-05). The **only explicit retry logic** is in
   `lib/embeddings.ts` (`embedTexts`: batches of 4, 20 s timeout, 2 retries with 1 s/2 s backoff on
   503/504/546 or dropped connection; throws so callers choose their degradation) and the offline
   seed script (retries dropped connections). Don't add a one-off retry helper to a single Anthropic
   call site as if completing a pattern; an explicit Anthropic policy is TD-05's remediation and
   should be proposed as its own change.
4. **Defined degradation, not failure, for retrieval**: classifier failure → the surface's default
   kind; embedding failure → full-text + label search only; a publish whose embedding fails still
   stores units without vectors (TD-26: they're only re-embedded on re-publish). Only a database
   error throws. A new retrieval-path call should follow this rule.
5. **Awareness note, not an action item**: the Anthropic account was recorded as a free grant
   expiring **28-Oct-2026 — that date has now passed**, and whether it was renewed can't be seen
   from code (TD-16, P1); there is no fallback provider. Only relevant if a task touches API-key
   handling, provider abstraction, or fallback/retry design — then surface it explicitly (and
   suggest confirming account status). Don't raise it for unrelated features, and don't take any
   renewal/procurement action.
6. **Execution model**: no job queue or background worker. Every mode is one synchronous call in
   the request cycle — streamed (`messages.stream`, most modes) or a single `messages.create`
   (`asset-reuse`, `check-similar`, the classifier) — preceded on Analyse companion and library-
   overview turns by one Haiku classifier call. Embedding is a synchronous Edge Function call.
   Telemetry uses Next's `after()`. A new slow call should follow this shape rather than introducing
   polling or a queue.
7. **Response parsing**: match the call site you're extending. Streamed modes return raw
   `text/plain`; the client regex-parses the trailing `<grid_update>`. Structured single results use
   SDK **forced tool use** (`check-similar`: `tool_choice: {type:'tool', name:'report_match'}`;
   classifier: `name:'route_question'`), with unknown values dropped server-side. Don't introduce a
   third parsing/validation style (e.g. a JSON-schema library).
8. **Prompts and grounding**: all builders are pure functions in `lib/system-prompts.ts`; grounding
   text comes from `buildGrounding()` in `lib/retrieval.ts` for a `Surface` (`analyse`, `contribute`,
   `document`, `explore-overview`, `explore-pathway`) — never paste whole pathway documents into a
   prompt. Cross-surface answer-shape rules live in shared constants (`BEST_MATCH_RULE`,
   `PATHWAY_CONTEXT_RULE`, `NEUTRAL_LANGUAGE_RULE`, `PLAIN_WORDS_RULE`) interpolated into every
   builder — change those, don't paste one-offs. Adopter-facing documents must go through
   `adopterDocument()` → `stripProvenanceAppendix()` (`lib/provenance.ts`); source passages are
   filtered to `is_public` in SQL *and* in code. Counts are computed in code, never by the model.
   Prompt caching (`lib/prompt-cache.ts`, split at `PROMPT_CACHE_BREAK`) applies to `companion` and
   `library` only. Every Claude call records token counts via `recordAiUsage` (`lib/ai-usage.ts`) —
   do the same for any new call.
9. **Standalone scripts**: `scripts/seed-pathways.ts` reuses `lib/` modules (via
   `scripts/vite-node.config.mts` for the `@/` alias) and calls Claude, Storage, the DB and the
   `embed` function for real — run with `--dry-run` first. Pure helpers belong in `lib/seed.ts`
   (tested), I/O in the script (untested). `scripts/smtp-test.mjs` is a manual SMTP diagnostic.
   `supabase/functions/embed/index.ts` is Deno, excluded from `tsconfig.json`/ESLint/Vitest, and
   deployed separately (`supabase functions deploy embed --project-ref <ref>`, never with
   `--no-verify-jwt`).

---

## Phase 5 — Frontend layer

1. **Component/page conventions**: `components/` is flat (37 files), one PascalCase file per
   component matching the export. Server pages are paired with a same-folder client counterpart,
   e.g. `app/analyse/page.tsx` + `app/analyse/StrengthenWorkspace.tsx`, or `app/contribute/page.tsx`
   + `ContributeAccessGate.tsx` + `ContributeGrid.tsx`. No client-state library; local `useState`/
   custom hooks, with `useAdoptionConversation` as the one substantial shared hook. Reuse existing
   shared UI (`Select.tsx`, `ConfirmDialog.tsx`, `Pagination.tsx`, `Toaster.tsx`/`lib/toast.ts`)
   before adding a new primitive.
2. **`AppShell.tsx` is instantiated per top-level route** (`app/(app)/layout.tsx`,
   `app/explore/page.tsx`, `app/analyse/page.tsx`, `app/contribute/page.tsx`,
   `app/account/page.tsx`) rather than one root authenticated layout — match that for a new
   top-level route.
3. **Reuse existing design tokens** from `app/globals.css`'s `@theme inline` block (`--color-navy
   #1b1b42`, `--color-coral #ff6543`, `--color-yellow #feda09`, `--color-blue #0099ff`,
   `--color-paper`/`--background`, `--color-ink`/`--foreground`, plus font tokens). Several files
   still hardcode brand hexes (`lib/dimensions.ts`, `app/explore/ExploreLibrary.tsx`,
   `app/contribute/ContributeGrid.tsx` — TD-11; `lib/email.ts`/`lib/adoption-plan-pdf.ts` copies are
   structurally necessary). Don't copy that pattern into new React code.
4. **Reuse one of the three deliberate markdown renderers**: `components/ChatPanel.tsx` (chat
   bubbles), `components/WikiMarkdown.tsx` (adds pipe tables, for pathway documents),
   `lib/adoption-plan-markdown.ts` (shared by the document modal and jsPDF exporter, deliberately
   without tables). `app/explore/ExploreLibrary.tsx`'s own renderer/textarea/send button is
   duplication debt (TD-14) — don't add another.
5. **Users only ever see the generic error message** (`GENERIC_ERROR_MESSAGE`,
   `lib/error-messages.ts` — the client-safe import). Browser errors are reported via
   `lib/client-error-report.ts` → `app/api/errors/client`. Don't surface raw server error text.
6. **Hidden built feature**: `SHOW_ORG_FILTER = false` in `app/contribute/ContributeGrid.tsx`
   (TD-13). The old `PathwaySubmissionsPanel.tsx` has been deleted — the live admin surface is
   `AdminPathwaysPanel.tsx`/`AdminPathwayRowCard.tsx`.
7. **Close the loop from backend to UI**: a new `designs.meta` key or `<grid_update>` field must be
   traced through `currentProgressBlock()` (`lib/system-prompts.ts`), the client merge in
   `lib/adoption-conversation.ts`, and every component that renders grid/meta state
   (`HeatmapGrid.tsx`, `AdoptionWorkspace.tsx`) — a stored-and-merged-but-never-rendered field is a
   silent gap here because so much state round-trips through the prompt/`<grid_update>` cycle.

---

## Phase 6 — Wire together and verify

**This repo has a Vitest 3 suite — add tests for the change and run it, but a green run proves only
the app's own logic against mocks.** CI does not run tests, lint or typecheck (TD-03), so running
them locally is the only gate.

- **Add tests under `tests/`, mirroring the existing layout** (`architecture/repository-
  conventions.md#tests`): `tests/unit/lib/` (pure modules), `tests/unit/server/` (server modules
  with mocked I/O), `tests/api/<route path>/` (call the exported `GET`/`POST` directly with a built
  `Request`, helpers in `tests/helpers/request.ts`, `routes-auth.ts`, `chat-session.ts`),
  `tests/client/` (the conversation hook), `tests/features/<feature>/` (components; first line
  `// @vitest-environment jsdom`), `tests/pages/`, `tests/proxy/`, `tests/db/` (migration-text
  checks). Name files `<module-or-component>.test.ts(x)`. Use the shared fakes —
  `tests/helpers/supabase-mock.ts` (records each query chain as a `QueryOp` for assertions) and
  `tests/helpers/anthropic-mock.ts` (fake `messages.stream`/`messages.create`, incl. mid-stream
  failure) — rather than a new mocking style. Cover negative paths (403 wrong role, 400/413 caps,
  429, `ValidationError`/`AuthError`/`NotFoundError` responses) as existing route tests do. A new
  migration needs `tests/db/migrations.test.ts` updated (Phase 2.8).
- **Run them**: `npm install` first (dev dependencies must be present — the wiki's last run found
  the main checkout's `node_modules` lacked them), then `npm test`, `npm run lint`, and
  `npm run build` (runs `tsc`, `strict: true`). Report the actual result. As of 2026-11-06 one test
  was already failing for an unrelated reason — `tests/features/admin/AdminPathwaysPanel.test.tsx`
  expects the pre-`7d7eac6` delete-dialog wording; distinguish pre-existing failures from ones you
  caused, and don't claim "all tests pass" unless they did.
- **Still verify real behaviour manually** — the suite cannot prove it:
  - Exercise new/changed routes through the UI with `npm run dev`, a real signed-in session and the
    actual role required (`adopter`/`pathway_contributor`/`admin`, via `/admin` or `user_roles`).
    Don't fabricate curl checks that skip the Supabase session cookie.
  - **RLS, the `published_pathways` view, and `match_pathway_units`/`match_source_chunks` are never
    executed by tests** (`tests/db/` only reads migration text). Apply the migration to a dev/local
    Supabase and test as a user who should be **denied**, not just one who should succeed.
  - **Verify persisted state directly in Supabase** (table editor or SQL editor) — especially for
    anything following the model-never-writes-DB pattern, where the write happens client-side after
    the stream ends.
  - If the feature touches an Anthropic call, **actually trigger it** — tests assert prompt text
    shape, not model output. Failures show as the generic message in the UI; the real cause is in
    `sys_errors` (`/admin/errors`) and `ai_usage ok:false` rows.
  - If it touches retrieval or embeddings, confirm the `embed` function is deployed for that project
    (otherwise search silently falls back to full text), and spot-check against
    `docs/features/pathway-storage/test_set_pathway_storage.md`.
- State plainly which parts were covered by automated tests and which were verified manually (routes,
  roles, DB rows checked).

---

## Phase 7 — Documentation

The project wiki lives at `docs/wiki/diffusion-cube/` — if this feature changes behavior a page
describes (a new `/api/chat` mode, a new table/function, a new role gate, a new component, a new
test area), update the matching page(s) in the same change, or regenerate via the `llm-wiki` skill
for a broad change. Don't incrementally patch the stale root docs (`ARCHITECTURE.md`, `README.md`,
`AGENTS.md`, `conversation_design.md` — TD-08). Feature-level requirement/plan/task docs go in
`docs/features/<feature-slug>/`, matching existing folders; code comments may cite them by path and
task ID (e.g. "docs/features/pathway-storage/, PS-07"). A new environment variable goes into both
**`.env.example`** (repo root) and `docs/wiki/diffusion-cube/architecture/configuration.md` when it's
introduced. Comments follow the repo style: prose explaining *why* at the point of decision, no
`TODO`/`FIXME` markers.

---

## Behavioral Rules

- **Trust the code and the wiki over root docs.** `ARCHITECTURE.md`/`README.md`/`AGENTS.md`/
  `conversation_design.md` are stale (TD-08); `CLAUDE.md` is a pointer whose "no tests" and
  GitHub/Sheets entries are stale. The flow now called "Analyse" was previously "Explore" →
  "Strengthen" → "Navigate", which explains legacy file names like `StrengthenWorkspace.tsx`.
- **Pathways live only in Supabase** — there is a single corpus (published `pathway_versions` +
  `pathway_units`), read by Explore, `/wiki` and Analyse alike through `lib/pathway-store.ts`.
  `content/` holds only `framework.md`, `pathway-generation-prompt.md`, `resources.md` and `legal/`;
  never add pathway markdown there. Load pathways via `npm run seed:pathways` or the contributor →
  admin publish flow.
- **No unauthenticated debug/test-login backdoor is currently known** — if one is found, flag it.
- **Schema changes are migration files only**, numbered one higher than the current max with a
  leading purpose comment; destructive steps flagged in capitals; `tests/db/migrations.test.ts`
  updated.
- **Add and run tests, but never overclaim.** Report the actual `npm test` result (noting
  pre-existing failures), and state separately what was verified manually against real Supabase/
  RLS/model behaviour, since the suite mocks all of it and CI doesn't run it.
- **Don't introduce a second Anthropic client factory, a second markdown renderer, a second auth
  path, a new global state library, a new mocking style, or a one-off Anthropic retry helper** when
  an existing pattern covers the need (Phase 4.3). New routes always use `withErrorHandling`.
- **Never write a DB row directly from `app/api/chat/route.ts` (or any route) on behalf of a model
  turn** — persistence for anything the model triggers belongs in `lib/adoption-conversation.ts`,
  client-side, after the stream completes (Phase 4.1). This is the single most repo-specific rule in
  this file and the one most likely to be silently violated by a "just add a quick save here" change.
- **Never let the Source Trace appendix or non-public source passages reach an adopter surface** —
  route adopter-facing documents through `adopterDocument()`.
- **Ask before assuming schema/API/UI shape** when the request doesn't specify it.

---

## Tailoring this skill to a specific codebase

**Already run three times**, against this repo (Diffusion Cube) on branch `Swanand_DC`:

- **2026-09-28 (initial pass)**, grounded in the LLM-native wiki at `docs/wiki/diffusion-cube/`
  (`ai-context.md`, `repository-map.md`, `application/database.md`, `application/backend.md`,
  `application/frontend.md`, `application/api-specification.md`, `architecture/coding-patterns.md`,
  `architecture/repository-conventions.md`, `architecture/testing.md`, `integrations/ai-llm.md`,
  `knowledge/technical-debt.md`).
- **2026-09-28 (incremental refresh, same day)**, after the wiki absorbed the Pathway Framework spec
  and the Product Charter: added notes on `contribution_units`, TD-16 account expiry, and TD-15.
- **2026-11-06 (full re-tailor)**, after the wiki was fully refreshed against HEAD `0a1ca00` (plus
  uncommitted prompt-rule changes), re-reading `ai-context.md`, `architecture/coding-patterns.md`,
  `architecture/testing.md`, `architecture/repository-conventions.md`, `application/database.md`,
  `integrations/ai-llm.md`, `knowledge/technical-debt.md`, and spot-checking the code (migration
  count, `tests/` file count, `package.json` scripts, model IDs, `MODES`, `lib/grid-update.ts`
  markers, `lib/supabase/*` exports, `AppShell` call sites, absence of `lib/github.ts` and
  `content/wiki*`). Changes: Vitest suite replaces "zero tests" (Phase 6 now requires adding and
  running tests, plus manual verification of real Supabase/RLS/model behaviour; CI still runs none);
  7 modes instead of 8; Haiku classifier alongside Sonnet; GitHub publish replaced by
  `saveVersion`/`publishVersion` + `pathway_versions`/`pathway_units`, `published_pathways` as a
  view, pgvector hybrid search, `embed` Edge Function; two-corpora rule removed; 42 migrations with
  `0042` destructive; `contribution_units` now live for toolkit assets; `withErrorHandling` on every
  route; retry wording made precise (embeddings retry explicitly, Anthropic only SDK default); rate
  limits/caps/`requiredRole` exist, PII screening still absent; TD-16 date passed; `.env.example`
  exists; seed script documented.

If the stack changes materially (a new data layer, CI starts running tests, the
model-never-writes-DB pattern is deliberately abandoned, retrieval or pathway storage is replaced,
model IDs are centralised), re-run this procedure rather than trusting the phases above indefinitely.

Trigger: the user says something like *"Update this skill to suit the tech stack of this
codebase"* (or names this skill directly while asking for the same).

When this happens:

1. **Reuse discovery work already done.** If another skill/subagent in this repo's
   `.claude/skills/` or `.claude/agents/` (e.g. `brd-task-creator`, `code-reviewer`, `qa-tester`)
   has already been tailored to this codebase, read it first — its stack findings apply here too,
   and re-deriving them from scratch wastes effort and risks inconsistency between skills.
2. **Otherwise run Phase 0 above for real**: inspect manifests/lockfiles, the actual routing/entry
   structure, the actual data layer, the actual auth mechanism, the actual external integrations,
   the actual frontend approach, and the actual test setup (which files are mocked/CI-safe vs.
   live). Also check for a project wiki, `CLAUDE.md`/`AGENTS.md`, or README architecture notes and
   prefer those over re-deriving from raw code where they exist and look current.
3. **Rewrite Phases 1–7 above in place**, replacing each generic bullet with the concrete
   equivalent for this repo — name actual frameworks, actual file/module locations, actual
   decorator/middleware names, actual retry helpers, actual design-token names, actual test file
   names — with `file:line` citations where useful, mirroring the level of specificity a
   well-grounded, repo-specific version of this skill would have. Do not invent conventions you
   didn't actually confirm; where something is genuinely absent (no ORM, no CI test job, no job
   queue), say so explicitly rather than filling the gap with a generic default.
4. **Update the frontmatter `description`** to name the actual stack (so future trigger-matching is
   accurate), while keeping the trigger phrasing generic enough to still match "add a feature"
   style requests.
5. **Keep this "Tailoring" section itself** at the bottom, updated only to note it's already been
   run — so the skill can be re-tailored later if the stack changes (a framework migration, a new
   data layer) without losing this capability.
6. **Never fabricate specifics that don't survive inspection.** A tailored skill that confidently
   states a convention the repo doesn't actually follow is worse than a generic one that says
   "check this before assuming."
