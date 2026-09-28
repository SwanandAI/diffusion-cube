---
name: fullstack-developer
description: >
  End-to-end feature development skill, tailored to Diffusion Cube (Next.js 16 / React 19 /
  TypeScript, Supabase Postgres+Auth+RLS with no ORM, a single Anthropic-backed `/api/chat` route
  dispatching on `mode`, no automated test harness). Trigger this skill whenever the user asks to
  "add a feature", "add a route/endpoint/API", "add a column/table", "wire this into the UI", "add
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
(Postgres + Auth + RLS) accessed with raw `.from('table')` calls and no ORM, one `route.ts` per API
endpoint except the single mode-dispatching `app/api/chat/route.ts`, an Anthropic-backed
model-never-writes-DB convention for every AI-generated artifact, a flat `components/` directory
with server/client page pairs, and **zero automated tests** anywhere in the repo. Every phase below
names this repo's real files and conventions instead of generic placeholders — if a future change to
the stack makes any of this stale, re-run the Tailoring procedure at the bottom rather than trusting
this file blindly.

**Golden rule: ground every phase in what this repo actually does before writing code.** The
primary source of truth is the LLM-native wiki at `docs/wiki/diffusion-cube/` (start with
`ai-context.md` and `repository-map.md`) — it was generated and verified against this branch's code.
Root-level docs (`CLAUDE.md`, `README.md`, `AGENTS.md`, `conversation_design.md`,
`SIGNUP_APPROVAL_OPTIONS.md`) are known to be **stale** relative to current code (see
`docs/wiki/diffusion-cube/knowledge/technical-debt.md#td-08`) — `ARCHITECTURE.md` and the wiki are
current; don't take a root doc's claim about routes, tables, or the Contributor publish flow at face
value without cross-checking the wiki or the code itself.

---

## Phase 0 — This repo's actual stack (already discovered — re-verify only if something looks stale)

- **Language/runtime + package manager**: TypeScript 5, npm (`package.json` + `package-lock.json`).
- **Web/service framework**: Next.js 16 App Router. Pages and API route handlers both live under
  `app/`; middleware is `proxy.ts` at the repo root (despite the filename, a standard Next.js
  middleware file) — it gates every route except a public allow-list, calls
  `supabase.auth.getUser()`, and forwards an `x-user-email` header so server components can skip a
  second lookup.
- **Data layer**: **no ORM.** Raw Supabase client calls (`.from('table')...`) directly inside
  `app/api/**/route.ts` handlers and `lib/` modules. Canonical schema lives in
  `supabase/migrations/` (32 sequential numbered files as of this writing) — that directory *is* the
  source of truth; there is no separate schema-definition file to keep in sync with it.
- **Auth pattern**: Supabase session cookies, re-validated per-request. `proxy.ts` is UX-only
  gating; the real enforcement is each `route.ts` handler independently calling
  `lib/roles.ts`'s `hasRole`/`hasAnyRole`/`isAdmin` against the caller's actual session — see
  `docs/wiki/diffusion-cube/architecture/coding-patterns.md`'s "Role checks: UX at the page,
  enforcement at the API." Some tables also enforce role at the DB layer via RLS (e.g. `pathways`
  insert requires `pathway_contributor`, enforced by a Postgres `exists` policy, not just app code)
  — see Phase 2.
- **External integrations**: `@anthropic-ai/sdk` (`^0.106.0`), one model ID everywhere —
  `claude-sonnet-4-6` — called from `app/api/chat/route.ts` (8 modes, all streamed) and
  `app/api/pathways/check-similar/route.ts` (one non-streaming, forced-tool-use call). No retry/
  backoff logic exists anywhere on any Anthropic call (tracked as
  `docs/wiki/diffusion-cube/knowledge/technical-debt.md#td-05`). Also: `lib/github.ts` (real GitHub
  Contents API commits for the Contributor "assemble" publish step), `lib/email.ts` (nodemailer/SMTP
  for all auth email), `lib/logger.ts` (fire-and-forget Google Sheets logging).
- **Frontend approach**: React 19 SPA-style client components inside the Next.js App Router, no
  client-state library (no Redux/Zustand) — local `useState` plus one substantial shared hook,
  `lib/adoption-conversation.ts`'s `useAdoptionConversation`. Tailwind CSS v4, brand tokens in
  `app/globals.css`'s `@theme inline` block.
- **Test setup**: **none.** No `*.test.*`/`*.spec.*`/`__tests__` files, no Jest/Vitest/Playwright/
  Cypress config, no `test` script in `package.json`, no CI test job (`.github/workflows/deploy.yml`
  only builds and deploys). See Phase 6 and
  `docs/wiki/diffusion-cube/architecture/testing.md` — don't assume or invent a harness that isn't
  there.
- **Existing docs**: `docs/wiki/diffusion-cube/` (the LLM-native wiki — primary source of truth),
  `ARCHITECTURE.md` (current, one stale paragraph noted in the wiki), `CLAUDE.md`/`README.md`/
  `AGENTS.md` (stale, see above).

If anything above looks like it's drifted from the current code (a new framework, a new data layer,
a test harness that's since been added), say so explicitly and re-verify against the wiki or the
code directly before proceeding — don't silently trust this snapshot forever.

---

## Phase 1 — Scope the request

Before touching any file, pin down what layers this feature actually needs:

- **Data**: does this need a new field/table, or a new column on `designs`/`design_documents`/
  `pathways`/`published_pathways`/etc.? → `supabase/migrations/`, numbered one higher than the
  current max (see Phase 2).
- **Route/API**: a genuinely new endpoint → a new `route.ts` under `app/api/**/`. A new
  AI-conversation behavior (a new document type, a new step in an existing flow, a new signal the
  model can emit) is much more likely to be **a new `mode` inside the existing
  `app/api/chat/route.ts`** plus a new prompt-builder function in `lib/system-prompts.ts`, not a new
  route — check `docs/wiki/diffusion-cube/application/api-specification.md` and
  `docs/wiki/diffusion-cube/integrations/ai-llm.md` for the full mode list before assuming a new
  route is needed.
- **Integration/business logic**: does it touch the Anthropic SDK, GitHub Contents API
  (`lib/github.ts`), Supabase Auth/email, or Google Sheets logging — or does it add a new
  configurable dimension to the framework (`content/framework.md` + `lib/dimensions.ts`)?
- **UI**: new page/view under `app/`, a new field surfaced in `AdoptionWorkspace.tsx`/
  `ChatPanel.tsx`/`HeatmapGrid.tsx`, or wiring an existing endpoint into one of those?

Read only the wiki pages that match the layers above (`docs/wiki/diffusion-cube/application/
database.md`, `.../api-specification.md`, `.../backend.md`, `.../frontend.md`, `.../integrations/
ai-llm.md`) — don't load the whole doc set for a narrow change.

If the feature is ambiguous in scope (e.g. "add a new option" with no detail on shape/behavior),
ask one focused question before planning — don't guess at schema shape, request/response shape, or
UI copy. A wrong guess here costs a migration + route + UI rewrite, not just a line edit.

---

## Phase 2 — Data layer

1. **There is no ORM.** The schema source of truth is `supabase/migrations/` itself (32 sequential
   numbered files) — there is no separate schema-definition file to keep in sync, so a migration
   file *is* the whole change. See `docs/wiki/diffusion-cube/application/database.md` for the
   current post-migration schema synthesis and ERD before writing a new one.
2. **Match this repo's existing naming and typing conventions.** Check a couple of existing tables
   first (`designs`, `design_documents`, `pathways`) rather than assuming a textbook default — e.g.
   `designs` is the DB name for what the UI calls an "adoption," a legacy name kept because renaming
   a live table is higher risk than living with the mismatch
   (`docs/wiki/diffusion-cube/architecture/repository-conventions.md`). jsonb columns (`meta`,
   `grid_state`, `messages`) are used for flexible/evolving shape rather than normalized columns —
   match that where a new field is conceptually part of an existing jsonb blob (e.g. a new
   `designs.meta` key) rather than adding a new top-level column for something that's really part of
   conversation state.
3. **Connection pattern**: Supabase client factories in `lib/supabase/{client,server,admin}.ts` —
   `client`/`server` for normal RLS-respecting calls, `admin` (service-role) only where the route
   genuinely needs to bypass RLS (e.g. admin actions, or the public `/explore` page reading
   `published_pathways` without an auth context). Don't reach for the admin client to route around
   an RLS policy that's inconvenient for a new feature — that's a security decision, not a
   convenience, and needs an explicit call-out.
4. **Check for sibling structures carrying the same kind of column/field.** The clearest example
   here is the 4-dimension × 4-stage grid: `lib/dimensions.ts` holds the *structural* shape
   (dimension codes, sub-categories, per-stage weights), while `content/framework.md` holds the
   *substantive* question bank the model is prompted with. A new dimension or sub-category needs
   both — a code-only change updates the grid's shape but leaves the model with nothing to ask
   about it, which is a silent no-op, not an error.
5. **RLS is real enforcement here, not just app-level convenience** — confirm both sides for any
   new or touched table. Concrete example: `pathways` insert requires the `pathway_contributor`
   role, enforced by a DB-level `exists` policy against `user_roles`
   (`docs/wiki/diffusion-cube/application/database.md`), independent of whatever the route handler
   also checks via `lib/roles.ts`. A new feature that writes to a role-gated table needs a matching
   RLS policy in its migration, not just an app-layer `hasRole` check — one without the other is
   either an unenforced app check (bypassable via direct API access) or a DB policy silently
   rejecting writes the app thinks should succeed.
6. **Schema changes are always additive**, numbered one higher than the current max, with a leading
   SQL comment stating purpose (`docs/wiki/diffusion-cube/architecture/repository-conventions.md`).
   The two historical exceptions (`0008_grid_revamp.sql`, `0018_drop_retired_tables.sql`) are
   documented, deliberate deviations, not the pattern to imitate by default.
7. **Do not build on or extend tables flagged as dead/retired**: `pathway_submissions`,
   `pathway_submission_versions`, and `pathway_submission_exec_summaries` were dropped in migration
   `0018` but are still referenced by five dead-code files (`app/api/pathway-submissions/push/
   route.ts`, both `app/api/admin/pathway-submissions/*` routes, `lib/pathway-submission-
   versions.ts`, `components/PathwaySubmissionsPanel.tsx`) — these 500 if ever invoked; don't treat
   them as a working reference implementation. `contribution_units` (migrations `0022`/`0025`) is
   fully built with correct RLS but nothing writes to it — the actual contributor-draft mechanism
   that shipped is whole-document `design_documents` rows + a single GitHub commit via
   `lib/github.ts`, not per-unit rows in this table. See
   `docs/wiki/diffusion-cube/knowledge/technical-debt.md#td-01` and `#td-04`.
8. **Before proposing a brand-new table/column for a pathway- or framework-schema enhancement,
   check `contribution_units` first.** The Product Charter's roadmap names "Enhance the Framework
   and Pathway schema to enrich the know-how" as a Not-started requirement, and this table
   (migrations `0022`/`0025`) is flagged in the wiki as *possibly* the early, abandoned groundwork
   toward exactly that requirement — fully built, correct RLS, never wired to app code (see item 7
   above and `docs/wiki/diffusion-cube/knowledge/technical-debt.md#td-04`,
   `docs/wiki/diffusion-cube/business/business-overview.md`'s Roadmap section). Don't assume it's
   irrelevant just because it's unused today — for this specific class of request, treat it as a
   candidate vehicle to confirm-or-rule-out with the user before designing a parallel structure from
   scratch.

---

## Phase 3 — Route / API / service layer

1. **One `route.ts` per endpoint, named by resource/action path, not HTTP verb** — e.g.
   `app/api/pathways/[id]/join/route.ts`, `app/api/admin/pathways/publish/route.ts`. **The one
   significant exception is `app/api/chat/route.ts`**, which dispatches internally on a `mode`
   string across 8 modes (`companion`, `library`, `extract-insights`, `analysis-doc`,
   `executive-summary`, `plan-document`, `pathway-draft`, `pathway-exec-summary`) rather than being
   split into 8 routes. A new AI-backed feature (a new document type, a new conversational step) is
   far more likely to be **a new mode + a new prompt-builder function in `lib/system-prompts.ts`**
   than a whole new route — don't default to a new route for this class of feature.
2. **Auth**: this repo's real enforcement pattern is "UX at the page, enforcement at the API" — every
   gated page (`app/analyse/page.tsx`, `app/contribute/page.tsx`, `app/admin/page.tsx`) does its own
   role check purely for what to *render*, but the corresponding API route independently re-derives
   the caller's role via `lib/roles.ts` (`hasRole`/`hasAnyRole`/`isAdmin`) against the real session —
   never trusting what the client sent (e.g. `app/api/chat/route.ts` re-validates `flow ===
   'contributor'` against `hasRole(..., 'pathway_contributor')` server-side regardless of what the
   UI already gated). A new gated surface needs **both** checks — the page-level one alone is not
   security. `proxy.ts` middleware only gates session presence, not role.
3. **No known unauthenticated debug/test-login backdoor has been found in this repo** — if one turns
   up while working on a feature, flag it rather than extending or quietly fixing it, unless the
   task is explicitly to remove/gate it.
4. **Errors**: there is no shared error-handler middleware. Streaming Anthropic calls in
   `app/api/chat/route.ts` have **no surrounding try/catch at all** — a failure surfaces as a raw,
   unhandled Next.js 500 (a known, tracked gap:
   `docs/wiki/diffusion-cube/knowledge/technical-debt.md#td-05`). The one non-streaming call
   (`app/api/pathways/check-similar/route.ts`) does wrap in try/catch and swallows failure to a
   default value. Match whichever pattern the call site you're extending already uses — don't
   silently add try/catch to "fix" the streaming gap as a side effect of an unrelated feature; if a
   feature genuinely needs it, call it out explicitly as its own change.
5. **Storage**: there is no generic file/object storage abstraction. The one real external-write
   integration of this shape is `lib/github.ts` (a real GitHub Contents API client for the
   Contributor "assemble" publish step) — use it for any change touching that flow rather than
   calling the GitHub API directly from a route.
6. **Invariant-critical writes**: the closest thing this repo has to a dedicated
   invariant-owning module is the **model-never-writes-DB pattern** (see Phase 4) — any new
   AI-generated-artifact feature must route its persistence through that shape, not write from the
   route handler directly. There is no ledger/audit-log module; if a feature genuinely needs one,
   that's new infrastructure, not a small addition — flag it.
7. **New configurable option on the framework/grid pipeline**: the resolution chain is
   `content/framework.md` (the substantive question bank, edited directly to change model behavior,
   no code change) + `lib/dimensions.ts` (the structural shape — dimension codes, sub-categories,
   per-stage weights) — add a new dimension/sub-category to both, not as an inline literal in a
   route or prompt string. See Phase 2.4.
8. **No rate limiting or PII screening exists anywhere in this repo — a known, roadmapped absence,
   not an unrelated surprise.** `/api/chat` has no per-user/per-session throttling on conversation
   turns or uploads, and no uploaded document is ever screened for PII before being folded into a
   corpus-grounding prompt or a contributor draft
   (`docs/wiki/diffusion-cube/knowledge/technical-debt.md#td-15`). The Product Charter's own
   non-functional backlog names both explicitly (status: Not started). If a task touches upload/
   ingestion or `/api/chat` request handling, don't treat this absence as scope creep to silently
   "fix" — and don't treat it as something newly discovered either; note it as pre-existing, tracked
   debt, and only add rate limiting/PII screening if the task explicitly asks for it.
9. **Trace a new field through every response path it appears in.** Concrete places this bites in
   this repo: `designs.meta` is re-injected every turn via `currentProgressBlock()` in
   `lib/system-prompts.ts` since the `<grid_update>` block is stripped before storage — a new `meta`
   key needs to flow through both the prompt-injection path and the client hook
   (`lib/adoption-conversation.ts`) that merges it back into state. Similarly, `design_documents` is
   append-only but only the *latest* row per `(design_id, doc_type)` is read back for `analysis`/
   `plan` docs — a new doc_type needs an explicit decision about whether it behaves like that
   (supersede) or like `draft` (every version stays browsable, backing `PathwayDocumentPane.tsx`'s
   version picker).

---

## Phase 4 — External integration / business-logic layer (only if this feature touches one)

1. **The model never writes to the database — this is architecturally load-bearing, not a style
   preference** (`docs/wiki/diffusion-cube/architecture/coding-patterns.md`). Every mode's output is
   streamed prose plus (for most modes) a trailing `<grid_update>` JSON block
   (`lib/grid-update.ts`'s `parseGridUpdate`/`stripGridUpdate`). Route handlers only *read* to
   ground a prompt; the actual persistence for anything the model triggers happens **client-side**,
   in `lib/adoption-conversation.ts`, after the stream completes. A new AI-generated-artifact
   feature must follow the same shape:
   - the model signals intent via a new field on the `<grid_update>` contract (following the
     existing pattern of `explorerAction`/`pathwayAction`);
   - `lib/adoption-conversation.ts` picks up that signal after the stream ends and makes the actual
     write (e.g. calling a new mode, then inserting into `design_documents` or wherever the artifact
     belongs);
   - the artifact is reopened via a **client-constructed** chat message — never model-authored —
     carrying a marker constant exported from `lib/grid-update.ts` (following
     `DELIVERABLE_START`/`DELIVERABLE_END`, `PATHWAY_DOC_MARKER`, `ANALYSIS_DOC_MARKER`,
     `EXEC_SUMMARY_MARKER`), parsed by both `components/ChatPanel.tsx` and
     `lib/adoption-conversation.ts`.
   Do not write a new artifact's row directly from `app/api/chat/route.ts` — that breaks this
   pattern and is the kind of change that needs an explicit call-out if genuinely warranted, not a
   quiet deviation.
2. **Client instantiation**: `@anthropic-ai/sdk`'s `Anthropic` client is constructed at module scope
   in `app/api/chat/route.ts` and `app/api/pathways/check-similar/route.ts`, reading
   `process.env.ANTHROPIC_API_KEY` once — no shared client factory module exists. Model ID is
   **always** `claude-sonnet-4-6`, hardcoded per call site, not a config value — match that rather
   than introducing a per-feature model-selection mechanism.
3. **There is no retry/backoff helper to reuse — none exists anywhere in this repo for any Anthropic
   call** (tracked as `docs/wiki/diffusion-cube/knowledge/technical-debt.md#td-05`). Don't invent one
   for a single new call site as if completing a pattern; if a feature genuinely needs retry
   behavior, say so explicitly as new infrastructure, not a small addition, since it would be the
   first of its kind in the repo.
4. **Awareness note, not an action item**: the app's whole Anthropic access is a single free-trial
   account expiring **28-Oct-2026** (`docs/wiki/diffusion-cube/knowledge/technical-debt.md#td-16`),
   with no fallback model/provider configured anywhere. This is only relevant if a task actually
   touches API-key handling, provider abstraction, or fallback/retry design — in that case, surface
   it explicitly rather than silently designing around it or ignoring it. Don't bring it up
   unprompted for unrelated features, and don't take any renewal/procurement action yourself — that's
   outside this skill's scope.
5. **Execution model**: there is no job queue or background worker anywhere. Every mode is a single
   synchronous call within the request/response cycle — either streamed (`messages.stream`, the
   common case) or a single non-streaming `messages.create` (`check-similar`, forced tool use). A
   new slow external call should follow this same shape (streamed if user-facing and slow, a plain
   blocking call otherwise) rather than introducing polling or a queue for one feature.
6. **Response parsing**: match the call site you're extending. `companion`/other `/api/chat` modes
   stream raw text with no schema validation — the client regex-parses the trailing `<grid_update>`
   block. `check-similar` uses the SDK's forced-tool-use (`tool_choice: {type:'tool', name:
   'report_match'}`) for a structured single-field result. Don't introduce a third
   parsing/validation style (e.g. a new JSON-schema library) for a new call site.
7. **Standalone scripts that aren't part of the deployed app**: `scripts/smtp-test.mjs` is a manual
   SMTP connectivity diagnostic, not wired into `package.json` scripts or CI — don't confuse it with
   "the pipeline." There is no other standalone script/CLI tool reusing core `lib/` modules outside
   the deployed Next.js app.

---

## Phase 5 — Frontend layer

1. **Component/page conventions**: `components/` is flat, one PascalCase file per component,
   matching the exported component name — no subfolder-per-component structure. Server components
   (data-loading pages) are paired with a same-folder client-side interactive counterpart, e.g.
   `app/analyse/page.tsx` (server) + `app/analyse/StrengthenWorkspace.tsx` (client), or
   `app/contribute/page.tsx` + `ContributeAccessGate.tsx` + `ContributeGrid.tsx`. Follow this split
   for any new gated page rather than putting all logic in one file or introducing a new
   client-state library (there is none — no Redux/Zustand; state is local `useState`/custom hooks,
   with `lib/adoption-conversation.ts`'s `useAdoptionConversation` as the one substantial shared
   hook).
2. **`AppShell.tsx` is the shared nav shell, instantiated per top-level route** (`/explore`,
   `/analyse`, `/contribute`, and the `(app)` layout each instantiate it separately) rather than one
   central authenticated layout wrapping everything — match this per-route instantiation pattern for
   a new top-level route rather than trying to hook into one shared root layout.
3. **Reuse existing design tokens.** Brand tokens are defined once in `app/globals.css`'s `@theme
   inline` block (`--color-navy #1b1b42`, `--color-coral #ff6543`, `--color-yellow #feda09`,
   `--color-blue #0099ff`, `--color-paper`/`--background`, `--color-ink`/`--foreground`) plus font
   tokens (Inter/DM Sans/PT Serif/Geist Mono). Reference these rather than hardcoding hex values —
   note that several existing files already hardcode the brand hexes literally instead of using the
   tokens (`lib/dimensions.ts`, `components/AdoptionPlanModal.tsx`, `app/explore/ExploreLibrary.tsx`
   — tracked as `docs/wiki/diffusion-cube/knowledge/technical-debt.md#td-11`); don't copy that
   pattern into new code even though it has precedent.
4. **Reuse one of the three deliberate markdown renderers rather than adding a fourth.** Three
   independent hand-rolled markdown-subset parsers exist by design, for genuinely different
   constraints: `components/ChatPanel.tsx` (chat bubbles), `components/WikiMarkdown.tsx` (adds
   pipe-table support, for pathway documents that lean on tables), and
   `lib/adoption-plan-markdown.ts` (shared between the on-screen document modal and the jsPDF
   exporter, deliberately *without* table support, since jsPDF can't mix bold runs in one `text()`
   call). A new rendering need should default to reusing whichever of these three fits, not writing
   a new one — `app/explore/ExploreLibrary.tsx`'s own fourth renderer is flagged as real duplication
   debt precisely because it was ported verbatim from a separate app without a new constraint
   (`docs/wiki/diffusion-cube/knowledge/technical-debt.md#td-14`); don't repeat that.
5. **Known dead frontend component — don't extend it**: `components/PathwaySubmissionsPanel.tsx` is
   unused (not rendered anywhere in `app/admin/page.tsx`), built against the dropped
   `pathway_submissions` table. If a feature seems to want "the submissions panel," confirm with the
   user whether they mean the live `AdminPathwaysPanel.tsx` instead, rather than reviving dead code.
6. **Close the loop from backend to UI**: when a feature adds a field to `designs.meta` or a new
   `<grid_update>` field, trace it through `lib/system-prompts.ts`'s `currentProgressBlock()` (which
   re-injects state every turn since the block is stripped before storage), the client merge in
   `lib/adoption-conversation.ts`, and every component that renders grid/meta state
   (`HeatmapGrid.tsx`, `AdoptionWorkspace.tsx`) — a field that's stored and merged but never rendered
   anywhere is a silent gap in this repo specifically because of how much state round-trips through
   the prompt/`<grid_update>` cycle rather than a normal request/response shape.

---

## Phase 6 — Wire together and verify

**This repo has zero automated tests — never claim "tests pass."** No `*.test.*`/`*.spec.*`/
`__tests__` files, no Jest/Vitest/Playwright/Cypress config, no `test` script in `package.json`, no
CI test job exist anywhere (`docs/wiki/diffusion-cube/architecture/testing.md`). Verification for
every feature is manual:

- `npm run dev` to run the app locally; `npm run lint` (`eslint.config.mjs`,
  `eslint-config-next` core-web-vitals + typescript) is the one automated check that exists — run
  it, but don't call it "tests." `tsc` runs implicitly as part of `npm run build` (`strict: true`).
- Exercise new/changed routes directly through the actual UI with a real signed-in session and the
  actual role the feature requires (`adopter`/`pathway_contributor`/`admin`, granted via
  `user_roles` — see `/admin` or a direct Supabase update for test accounts). Don't invent a test
  harness the repo doesn't have, and don't fabricate curl-based route checks that skip the real
  Supabase session cookie the middleware and route handlers both depend on.
- If the feature touches an Anthropic call, **actually trigger it and watch server logs** — there is
  no surrounding try/catch on streaming calls, so a failure will surface as a raw 500 with a stack
  trace in the terminal running `npm run dev`, not a clean error response.
- **Verify persisted state directly against Supabase** (the Supabase dashboard's table editor, or a
  SQL query in the SQL editor) rather than trusting the UI alone — since there's no ORM, a typo in a
  raw `.from('table')` call or column name often fails loudly, but a field that's stored yet
  missing from a sibling read path (e.g. present in `analysis_doc` fetch but not `plan` fetch) fails
  silently. This matters especially for anything following the model-never-writes-DB pattern (Phase
  4.1) — the write happens client-side after the stream ends, so confirm the row actually landed,
  don't just trust that the chat UI showed the card.
- If the feature touches a role-gated table with an RLS policy (Phase 2.5), test as a user who
  should be **denied**, not just as one who should succeed — an RLS policy that's subtly wrong often
  still lets the intended user through while failing to block someone it should.

---

## Phase 7 — Documentation

The project wiki lives at `docs/wiki/diffusion-cube/` — if this feature changes behavior a page
there already describes (a new `/api/chat` mode, a new table, a new role gate, a new component),
update the corresponding page(s) in the same change, or regenerate via the `llm-wiki` skill for a
broad change, rather than letting the wiki drift the way the root-level docs (`CLAUDE.md`,
`README.md`, `AGENTS.md`) already have (`docs/wiki/diffusion-cube/knowledge/technical-debt.md#td-08`
— those are known-stale and not worth updating incrementally). Prefer updating the wiki over adding
a new standalone planning doc. There is no `.env.example` in this repo — a new environment variable
should be added to `docs/wiki/diffusion-cube/architecture/configuration.md` at the same time it's
introduced in code, since that's the only place env vars are currently documented at all.

---

## Behavioral Rules

- **Confirm the actual entrypoint/structure before trusting `CLAUDE.md`/`README.md`/`AGENTS.md`.**
  These are known-stale relative to current code
  (`docs/wiki/diffusion-cube/knowledge/technical-debt.md#td-08`) — the flow now called "Analyse"
  was previously "Explore" then "Strengthen" then "Navigate," and the Contributor publish path
  `CLAUDE.md` describes (`pathway_submissions` self-serve push) is dead code, not the live
  two-step assemble/admin-publish flow. Trust `docs/wiki/diffusion-cube/` or the code itself.
- **Confirm which pipeline/module you're actually editing before touching a repo with more than one
  similar-looking one** — this repo genuinely has two separate, non-overlapping pathway corpora
  (`content/wiki/pathways/` for the grounding/Analyse corpus vs. `content/library-wiki/pathways/`
  for the public `/explore` Library, several pathways duplicated by name across both — see
  `docs/wiki/diffusion-cube/integrations/ai-llm.md#two-corpora`); confirm which one a request
  actually means before editing either.
- **No unauthenticated debug/test-login backdoor is currently known in this repo** — if one is
  found, flag it rather than touching it, unless the explicit task is to remove/gate it.
- **Schema changes are additive migration files only** — there is no separate canonical schema
  artifact to keep in sync (Phase 2.1); a new migration is numbered one higher than the current max
  with a leading purpose comment, matching every existing migration's style.
- **Never claim tests pass.** This repo has none — state plainly that verification was manual (which
  routes/roles/DB rows you checked), never imply an automated suite ran.
- **Don't introduce a second Anthropic client-factory, a second markdown renderer, a second auth
  path, or a new global state library** for one feature when an existing pattern already covers the
  need — and don't add a retry/backoff helper as if completing an existing pattern, since none
  exists yet (Phase 4.3).
- **Never write a DB row directly from `app/api/chat/route.ts` (or any route) on behalf of a model
  turn** — persistence for anything the model triggers belongs in `lib/adoption-conversation.ts`,
  client-side, after the stream completes (Phase 4.1). This is the single most repo-specific rule in
  this file and the one most likely to be silently violated by a "just add a quick save here" change.
- **Ask before assuming schema/API/UI shape** when the request doesn't specify it.

---

## Tailoring this skill to a specific codebase

**Already run twice**, against this repo (Diffusion Cube) on branch `Swanand_DC`:

- **2026-09-28 (initial pass)**, grounded in the LLM-native wiki at `docs/wiki/diffusion-cube/`
  (primary source: `ai-context.md`, `repository-map.md`, `application/database.md`,
  `application/backend.md`, `application/frontend.md`, `application/api-specification.md`,
  `architecture/coding-patterns.md`, `architecture/repository-conventions.md`,
  `architecture/testing.md`, `integrations/ai-llm.md`, `knowledge/technical-debt.md`).
- **2026-09-28 (incremental refresh, same day)**, after the wiki was regenerated to absorb two
  newly-added raw documents (`docs/raw_documents/Pathway Framework.pdf` and `docs/raw_documents/AI
  DIffusion Cube - Product Charter.docx`). Re-read `ai-context.md` (new "⚠ Time-sensitive
  operational dependency" and "Product Roadmap" sections), `knowledge/technical-debt.md` (new TD-04
  cross-reference, new TD-15, new TD-16), and `business/business-overview.md`'s new Roadmap section.
  Added: a data-layer note (Phase 2.8) to check `contribution_units` before proposing new pathway/
  framework schema; an awareness note (Phase 4.4) about TD-16's 28-Oct-2026 Anthropic account
  expiry, relevant only to API-key/provider/fallback-design work; a request-handling note (Phase
  3.8) naming TD-15 (no rate limiting, no PII screening) as pre-existing, roadmapped debt rather
  than new-feature scope creep. No other phase content changed in this pass.

If the stack changes materially (a new data layer, a test framework gets added, the
model-never-writes-DB pattern is deliberately abandoned, a new corpus/routing scheme replaces the
current one), re-run this procedure rather than trusting the phases above indefinitely.

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
   didn't actually confirm; where something is genuinely absent (no ORM, no test framework, no job
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
