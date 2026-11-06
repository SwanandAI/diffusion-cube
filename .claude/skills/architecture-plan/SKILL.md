---
name: architecture-plan
description: >
  Turns a validated business requirement into a human-reviewed architecture / implementation plan
  — tailored to Diffusion Cube, the Next.js 16 App Router / React 19 / TypeScript / Tailwind v4
  monolith at 100pathways.com's Adoption Companion, backed by Supabase (Postgres + pgvector, Auth,
  RLS, Storage, the `embed` Edge Function; no ORM, 42 sequential migrations under
  `supabase/migrations/`; pathways stored only in the database via `lib/pathway-store.ts`) and one
  Anthropic chat route (`app/api/chat/route.ts`, 7 modes on `claude-sonnet-4-6`, grounded per
  message by `lib/retrieval.ts` hybrid search with a `claude-haiku-5-5` classifier), with a mocked
  Vitest suite under `tests/` (not run in CI). Reads `docs/features/<feature-slug>/requirement_<feature_name>.md`
  and `business_clarifications_<feature_name>.md` (written by `brd-validation`), grounds itself in this
  repo's LLM-native wiki (`docs/wiki/diffusion-cube/`) or a direct repo scan, asks technical
  clarification questions and records them in `architecture_clarifications_<feature_name>.md`,
  stops for answers, reasons through architectural impact —
  boundaries crossed, alternatives, tradeoffs, non-functional consequences — and writes
  `plan_<feature_name>.md` only after the user approves it, then updates the requirement to the
  final scope. Does NOT write the task list — that is the `task-creation` skill. Use when the user
  asks to "create the architecture plan", "plan the implementation", "design how to build this
  requirement", "write plan.md", or has an approved requirement and wants the engineering plan.
  Also triggers on "update this skill to suit the tech stack of this codebase" — see **Tailoring
  this skill to a specific codebase** at bottom.
---

# Architecture Plan

You are an expert Software Architect. Job: take a requirement whose business scope is settled
and decide **how** to build it in this codebase — where it lives, what it changes, what the
alternatives were, and what it costs — as a plan a human reviews before any task list exists.

This is the second of three skills that split the `brd-task-creator` workflow into separate
steps. They all write to the same folder:

```
brd-validation                     → requirement_<feature_name>.md + business_clarifications_<feature_name>.md
architecture-plan (this skill)     → plan_<feature_name>.md + architecture_clarifications_<feature_name>.md
                                     (+ final-scope update to the requirement)
task-creation                      → task_list_<feature_name>.md
```

**Never write `task_list_<feature_name>.md` here.** When the plan is approved, point the user to
`task-creation`.

```
Requirement + Business Clarifications → Repo Context → Technical Clarifying Questions (STOP) → Plan (STOP) → Requirement final-scope update
```

---

## Stage 0 — Load the Inputs

1. Find the feature folder `docs/features/<feature-slug>/` and read `requirement_<feature_name>.md`
   and `business_clarifications_<feature_name>.md` in full, including the "Technical questions
   for architecture-plan" list that `brd-validation` parked. If
   `architecture_clarifications_<feature_name>.md` already exists (an earlier planning round),
   read it too and continue it rather than starting over. A folder from before the split may
   have one combined `clarifications_<feature_name>.md` instead: read it as the record so far,
   leave it unchanged, and write new technical questions into
   `architecture_clarifications_<feature_name>.md`.
2. **If there is no requirement file**, say so and recommend running `brd-validation` first. If
   the user wants to go ahead anyway, restate the requirement in 2-4 plain-language sentences,
   confirm it with them, and write a minimal `requirement_<feature_name>.md` before planning, so
   the plan has a business reference. Don't invent business decisions to fill the gap; ask them
   in Stage 2 and mark them as such.
3. If the requirement's status isn't "Validated" (or approved), mention it and ask whether to
   proceed.
4. Treat the requirement's scope, rules, flow charts and "Deliberately not included" list as the
   business contract. Don't re-ask business questions it already answers. If something in it is
   technically infeasible or very costly, raise it as a question rather than quietly narrowing it.

---

## Stage 1 — Ground in Repo Context

Before reasoning about impact or asking questions, find out what the system actually looks like
today.

1. **Check for existing project context first**, in order of preference:
   - This repo's LLM-native wiki, `docs/wiki/diffusion-cube/` (produced by the `llm-wiki` skill,
     code-verified as of branch `Swanand_DC`, last full refresh 2026-11-06) — **the primary
     source of truth**. `CLAUDE.md` is now only a short pointer into this wiki (and its "no
     tests" table cell and GitHub/Sheets services entry are themselves stale); the root
     `ARCHITECTURE.md`, `README.md`, `AGENTS.md` and `conversation_design.md` are documented as
     stale (TD-08) — e.g. `ARCHITECTURE.md` still describes a committed `content/wiki/` corpus,
     whole-corpus prompt injection and `published_pathways` as a table admin publish writes to,
     none of which is true since migration `0042`. Always start with
     `docs/wiki/diffusion-cube/ai-context.md`, then pull only the pages matching the
     requirement's affected areas:
     - Routes/API → `application/api-specification.md`, `architecture/sequence-diagrams.md`
     - Data/schema → `application/database.md` (42 sequential Supabase migrations, ERD, RLS notes,
       the `0042` pathway-storage tables and `published_pathways` view)
     - Auth/roles → `business/users-and-personas.md`, `business/business-rules.md`
     - AI/LLM chat surface, retrieval and the `<grid_update>` contract → `integrations/ai-llm.md`
     - Conventions to follow in new code (validation order, `withErrorHandling`, retrieval
       conventions, prompt-rule constants, test mocking) → `architecture/coding-patterns.md`,
       `architecture/repository-conventions.md`
     - Tests (what the Vitest suite covers and what it can't) → `architecture/testing.md`
     - Frontend → `application/frontend.md`
     - Known limitations for the affected area → `knowledge/technical-debt.md`
     - Whether this is already-roadmapped, not a fresh ask → `business/business-overview.md`'s
       "Roadmap (Planned, Not Yet Implemented)" section (milestones through 15-Mar-27, the
       prioritized requirements backlog with the charter's own status **and** a "Code evidence
       (2026-11-06)" column showing where code has moved past the charter, the execution model)
       and `business/workflows.md`'s "Planned Workflows" section (W8 contributor reuse/incentive
       loop, W9 remaining pathway-curation lifecycle, W10 guided Adopter-to-Contributor
       transition — numbered W5–W7 before November 2026; W1–W7 are now the *implemented*
       workflows, including W5 toolkit-asset sharing, W6 seeding and W7 admin delete)
   - `CLAUDE.md`/`AGENTS.md`/`ARCHITECTURE.md`, only as secondary corroboration, and only where
     the wiki doesn't cover something — never let a raw doc override a wiki claim it explicitly
     reconciles against.
   - If the wiki itself looks stale relative to what you can see in code (a route/table it
     doesn't mention, or a migration number higher than `0042`): tell the user and ask
     whether to regenerate it (`llm-wiki` skill) or proceed on a direct repo scan (grep/glob over
     `app/api/**/route.ts`, `supabase/migrations/*.sql`, `lib/`, `components/`, `tests/`) as a
     cross-check. Don't silently skip this choice.
2. Cross-reference requirement against what you found. Note explicitly (for your own working
   notes, and later for plan):
   - **Check whether this requirement is already scoped by the product roadmap before designing
     anything.** Before reasoning about *how* to build what's been asked, check
     `business/business-overview.md`'s "Roadmap (Planned, Not Yet Implemented)" section and
     `business/workflows.md`'s "Planned Workflows" (W8–W10) for whether this requirement — or
     something adjacent to it — is already named there (e.g. a requirement touching
     contributor-reuse visibility maps to W8 and the "Incentivize Contributors" milestone (not
     started) and "Visibility into Pathway Usage & Reuse" (admin-only usage counts exist at
     `/admin/usage`; no likes/dislikes, reuse acknowledgements or contributor-facing view), reading
     from the still write-only `adoption_queries` table; a requirement touching unpublishing or
     curation maps to W9 — the `retired` status is reserved but unused, and delete is the only way
     to take a pathway down (TD-22); a requirement touching the Explorer/Contributor relationship
     maps to W10 and `users-and-personas.md#planned-vs-current-adoptercontributor-relationship` —
     note the charter's "a contributor can analyse their own adoption" intent is **now met**,
     because every account holds `adopter` from signup (migration `0039`), while the smooth
     in-conversation transition and "connect with the contributors behind a pathway" are still
     unbuilt). Also check the backlog's code-evidence column: several charter items marked "Not
     started" are already built or partly built (account deletion, toolkit assets, tests, rate
     limits, error logging) — don't plan to build them again. If the requirement is already scoped
     there: **build the plan on top of that stated intent** (named scope, target milestone,
     charter status) rather than re-deriving goals from scratch — and treat any place where the
     requester's actual ask diverges from the roadmap's stated scope as an **explicit decision
     point for Stage 2's clarifying questions**, never something this skill silently resolves
     either way (neither silently narrowing to what the roadmap says nor silently expanding to
     match it without asking).
   - Which existing routes/handlers (`app/api/**/route.ts`), `lib/` modules, Supabase tables, or
     `components/`/page files this touches — and which existing test files under `tests/` already
     cover them (e.g. `tests/api/chat.test.ts`, `tests/unit/server/retrieval.test.ts`,
     `tests/unit/server/pathway-store.test.ts`, `tests/db/migrations.test.ts`)
   - Which documented business rule this extends, changes, or contradicts — **never silently
     violate**, in particular:
     - The model never writes to Supabase directly — `/api/chat` modes stream prose plus (for
       most modes) a trailing `<grid_update>` JSON block; the *client*
       (`lib/adoption-conversation.ts`) parses it (`lib/grid-update.ts`) and performs every
       conversation write. Pathway-store writes (`saveVersion`, `publishVersion`, unit indexing)
       happen only on explicit human actions — contributor Send for Review, admin Publish, the
       operator's seed script — never from a model turn. A requirement that implies "the model
       saves X" needs to be reframed as "the model signals X, the client (or a human action)
       persists it."
     - The Provenance/Source Trace appendix on a pathway document is contributor-only — stripped
       by `adopterDocument()` → `stripProvenanceAppendix()` (`lib/provenance.ts`) from every
       adopter-facing surface (`/explore`, `/wiki`, `/analyse` grounding, documents). Seeded source
       passages reach adopters only when the seed manifest marked them public.
     - Publishing a pathway is two independently-gated steps, both inside Supabase: contributor
       "Send for review" (`POST /api/pathways/assemble` → `saveVersion` in `lib/pathway-store.ts`,
       a new `pathway_versions` row; a `draft` pathway moves to `in_review`, an already-`published`
       one stays live with `review_requested` set) does **not** make anything live; only admin
       "publish" (`POST /api/admin/pathways/publish` → `publishVersion`: sets
       `pathways.published_version_id`, parses units into `pathway_units` and embeds them) does.
       There is no GitHub commit and no redeploy any more (`lib/github.ts` was removed).
       `published_pathways` is now a **view** — never insert into it. Admin delete
       (`/api/admin/pathways/delete`) is permanent and also unpublishes. A requirement that
       assumes one-step self-serve publish, or a Git-committed pathway file, is working against a
       stale model — flag it explicitly rather than building toward it.
     - Pathways live **only** in Supabase — never add pathway markdown under `content/` (which now
       holds only `framework.md`, `pathway-generation-prompt.md`, `resources.md`, `legal/`); new
       pathways arrive via the contributor → admin publish flow or `npm run seed:pathways`.
     - Answer shape is governed by shared constants in `lib/system-prompts.ts` —
       `BEST_MATCH_RULE`, `PATHWAY_CONTEXT_RULE`, `NEUTRAL_LANGUAGE_RULE`, `PLAIN_WORDS_RULE`
       (single best-matching pathway by default, describe a pathway on first mention, short
       answer-first replies, neutral wording, no insider jargon). A requirement that changes how
       answers read should change those constants, not add a per-prompt one-off.
     - Every account is an `adopter` from signup (DB trigger, migration `0039`); there is no
       pending state and `general_user` no longer exists.
   - Any tracked technical debt from `knowledge/technical-debt.md` worth flagging for the
     affected area — e.g. a requirement adding a new Anthropic call site inherits TD-05 (no
     explicit retry/timeout policy on any Anthropic client — only the SDK's implicit 2 pre-response
     retries, nothing mid-stream; the only explicit retry is `lib/embeddings.ts`'s 503/504/546
     backoff) and TD-20 (model IDs are hardcoded per call site — `claude-sonnet-4-6` in the chat
     route, `check-similar` and the seed script, `CLASSIFIER_MODEL = 'claude-haiku-5-5'` in
     `lib/retrieval.ts`); a requirement touching pathway data inherits TD-17 (no copy of pathway
     content outside Supabase, no export tooling) and possibly TD-26 (units saved without vectors
     after an embed failure are only re-embedded on re-publish); a requirement touching the admin
     publish path inherits TD-23 (publish takes the *latest* version, not the reviewed one); one
     touching `published_pathways` inherits TD-18 (owner-rights view — intentional, any new column
     is publicly readable); one touching contributor membership/registration inherits TD-24 (RLS
     insert policies don't restrict columns). Match existing behaviour rather than quietly
     fixing these, and flag the gap in Risks & Open Items instead. TD-01 (dead
     `pathway_submissions` code) and TD-02 (two pathway corpora) are **resolved** — don't plan
     around them.

Never invent affected files or components — if existing context or repo scan doesn't confirm
something, say so rather than assuming.

---

## Stage 2 — Technical Clarifying Questions (STOP — wait for the user)

Ask the technical questions left between the requirement and what Stage 1 found. Start with the
parked "Technical questions for architecture-plan" from the business clarifications file. Business
questions belong to `brd-validation`; only re-open one if Stage 1 shows the requirement can't be
built as written, and say why. Don't proceed to Stage 3 until the user has answered or explicitly
said "no more questions, proceed."

Cover, where relevant to the requirement:

- **Actors & permissions** — which of `adopter` (every account, granted by the `0039` signup
  trigger; not grantable or removable in the admin console), `pathway_contributor` (admin-granted,
  plus an approved `contributor_registrations` row for `/contribute`), `admin` (role row or
  `ADMIN_EMAILS`) or the anonymous visitor (`/explore` and published toolkit-asset downloads) are
  affected. `general_user` was removed by migration `0039` — don't design for it. This repo
  enforces access in layers, and the page layer is never the real gate: `proxy.ts` middleware only
  checks for a signed-in session against a public-path list (`/analyse` and `/contribute` are
  deliberately reachable at that layer so each page renders its own tiered view); page-level checks
  (e.g. `app/analyse/page.tsx` + `StrengthenWorkspace.tsx`, `app/contribute/page.tsx` +
  `ContributeAccessGate.tsx`/`ContributeGrid.tsx`) are UX only; the actual enforcement is the API
  route re-checking the session — `requiredRole(mode, flow)` over `currentRoles()` in
  `app/api/chat/route.ts`, `hasRole`/`hasAnyRole`/`isAdmin` (`lib/roles.ts`) elsewhere; and Postgres
  RLS is the floor (e.g. `0040` limits `pathways` reads to their contributors and admins, the
  `pathways` insert policy requires `pathway_contributor`). Service-role modules
  (`lib/pathway-store.ts`, `lib/retrieval.ts`) bypass RLS and state "callers check who may call".
  Ask explicitly which of these layers the new requirement needs to add or change — don't assume a
  page-level check alone is sufficient.
- **Data contract** — new columns/tables need a new file under `supabase/migrations/`, numbered
  one higher than the current max (`0043` at the 2026-11-06 refresh — re-check), opening with a
  SQL comment stating its purpose and calling out any destructive step in capitals as `0042` does.
  There is no ORM and no generated schema types, so no compile-time contract catches a call site
  that still reads an old column/table shape (this is how migration `0027`'s silently-failing
  constraint happened) — call out anywhere a rename/removal could break a sibling `.from('table')`
  call site that isn't obviously nearby, and note that `tests/db/migrations.test.ts` asserts on
  migration text (sequential numbering, RLS on every table, `0042` as latest and flagged
  destructive), so a new migration will need a matching assertion there. Pathway data goes through
  `lib/pathway-store.ts` (the one repository-style module), not new inline queries; never insert
  into the `published_pathways` view; any column added to that view is publicly readable (TD-18).
- **Route/API contract** — new endpoints go under `app/api/**/route.ts`, one file per endpoint,
  named by resource/action folder path (e.g. `app/api/pathways/[id]/join/route.ts`), **not** by
  HTTP verb; each defines `handle<METHOD>` and exports
  `export const <METHOD> = withErrorHandling('api/<path>', handle<METHOD>)` (`lib/errors.ts`),
  throwing `ValidationError`/`AuthError`/`NotFoundError` for expected failures (5xx bodies are
  replaced with the generic message; the real error goes to `sys_errors`). State the
  request/response shape; state which role check it needs; and if it calls a model, whether it
  follows the chat route's validation order (rate limit → body size 413 → JSON shape 400 → role
  403 → message shape 400 → text size 413, named constants with a comment on each cap).
- **AI/LLM impact** — if this touches the chat surface: does it need a **new mode** on the single
  `app/api/chat/route.ts` dispatcher (which carries 7 in its `MODES` array: `companion`,
  `analysis-doc`, `executive-summary`, `extract-insights`, `pathway-draft`, `library`,
  `asset-reuse`), plus a `requiredRole` mapping for it, or does it extend an existing mode's prompt
  builder in `lib/system-prompts.ts`? Does it change the shared answer-shape constants
  (`BEST_MATCH_RULE` etc.) rather than one prompt? Does it need to read/write the `<grid_update>`
  contract (`lib/grid-update.ts`, marker constants)? How is it grounded — through
  `buildGrounding()` in `lib/retrieval.ts` with an existing `Surface` (`analyse`, `contribute`,
  `document`, `explore-overview`, `explore-pathway`) or a new one? Does it add a Haiku classifier
  call (only `analyse` and `explore-overview` run one today), extra embedding round-trips via the
  `embed` Edge Function (`lib/embeddings.ts`, batches of 4, 20 s timeout), or change `LIMITS`
  (tuned against `docs/features/pathway-storage/test_set_pathway_storage.md`)? Every retrieval
  failure has a defined degradation (classifier → default kind; embedding → full text + labels;
  only a DB error throws) — a new path should define its own. On retries: no Anthropic client sets
  `maxRetries`/`timeout` (TD-05) — a new call site should match that and flag the gap, unless the
  user explicitly wants the policy defined as part of this requirement; model IDs are hardcoded per
  call site (TD-20), so a new call site adds one more place to change.
- **Invariant-critical impact** — does this change anything the model currently must never write
  directly (all conversation persistence goes through the client parsing `<grid_update>`; the chat
  route's only writes are telemetry — `adoption_queries`, `ai_usage`, `sys_errors`), the two-step
  pathway-publish gate (Send for Review → `saveVersion` vs. admin Publish → `publishVersion`), or
  Source Trace stripping (`adopterDocument`)? Any such write must go through the existing
  mechanism, never a new direct write that bypasses it.
- **Frontend decisions this repo requires explicit answer on before design** (always ask, never
  assume):
  - Does the new page/view get its own `AppShell` + `Sidebar` instantiation (the pattern each of
    `/explore`, `/analyse`, `/contribute`, and the `(app)` route group currently follows
    independently — there is no single central authenticated layout; `/admin*` pages use a
    standalone layout with no `AppShell`), or does it belong inside an existing surface's
    workspace (e.g. `AdoptionWorkspace.tsx`)?
  - Any new async interaction — this repo has **no client-side state-management library**
    (no Redux/Zustand/etc.); state is local `useState`/custom hooks per page, with
    `lib/adoption-conversation.ts`'s `useAdoptionConversation` as the one substantial shared hook.
    Does the new interaction fit that hook, need its own small hook following the same pattern, or
    is a shared store genuinely warranted (a real architectural departure — ask before assuming)?
  - Does it need the server-component-page + client-component-counterpart split this repo uses
    everywhere (e.g. `app/analyse/page.tsx` server + `StrengthenWorkspace.tsx` client)?
- **Non-functional requirements** — performance/scale expectations, responsiveness. There is no
  i18n/localization framework anywhere in this repo (all copy is hardcoded English JSX) — confirm
  with the user whether new user-facing strings need to consider one, rather than assuming either
  that one exists or that English-only is fine by default.
- **Edge cases requirement is silent on** — empty states (including "no published pathways yet",
  which `buildGrounding` already answers with a single line), concurrent double-submit (this app
  has no job queue or background worker — everything runs inline in a Next.js route handler, with
  side effects deferred via `after()` at most; `saveVersion` relies on the
  `(pathway_id, version_number)` unique key for races), large input (document uploads go through
  client-side extraction — `pdfjs-dist`/`mammoth`/`xlsx`/`jszip` — before reaching an API route;
  chat caps bodies at 32 MB and ~800K chars), rate limiting (per account `chat-user` 30/min ·
  300/day, per IP `explore` 20/min · 200/day — does the new surface need one?), external-call
  failures mid-pipeline (Anthropic pre-stream failure → generic 500 via `withErrorHandling`;
  mid-stream → `streamFailed()`, partial reply + generic message, nothing saved; `embed` failure →
  degraded search or units stored without vectors), permission-denied paths (which layer should
  surface the denial, and how).
- **Integration impact** — the only external providers this app integrates with are the Anthropic
  API (Sonnet in `app/api/chat/route.ts`, `app/api/pathways/check-similar/route.ts` and
  `scripts/seed-pathways.ts`; Haiku in `lib/retrieval.ts`), Supabase (Postgres + pgvector, Auth
  with OTP and the Send Email Auth Hook at `app/api/auth/send-email/route.ts`, Storage buckets
  `toolkit-assets` and `pathway-sources`, the `check_rate_limit` and `match_pathway_units`/
  `match_source_chunks` RPCs), the self-hosted `embed` Edge Function
  (`supabase/functions/embed/`, `gte-small`, called by `lib/embeddings.ts` with the service-role
  key), and SMTP via `nodemailer` (`lib/email.ts`). Vercel is a CI deploy target only. The GitHub
  Contents API and Google Sheets logging were **removed** — don't plan against them. There is no
  payment provider, no messaging/webhook integration beyond Supabase's Auth hook, and no OAuth/SSO
  beyond Supabase email+password/OTP. If the requirement implies any new provider, name it and
  confirm it's genuinely new rather than an extension of one already listed.
- **Architectural impact** — think like architect, not just feature-writer, and ask rather than
  assume:
  - Does this cross an existing boundary — e.g. adding an eighth mode to the single
    `app/api/chat/route.ts` dispatcher (already ~440 lines; splitting modes into separate routes
    is a recorded-but-unimplemented alternative), a new call site into a table another surface
    already owns (`designs` for Explorer/Contributor workspaces, `design_documents` for generated
    documents and drafts, `pathways`/`pathway_versions`/`pathway_units` behind
    `lib/pathway-store.ts`), or a new `Surface` in `lib/retrieval.ts`?
  - Does an equivalent problem already have a solution elsewhere in this codebase that should be
    reused rather than duplicated — e.g. the forced-tool-use pattern (`check-similar`'s
    `report_match`, the classifier's `route_question`), the validation order and `requiredRole`
    in the chat route, `withErrorHandling` + `logError`, the fire-and-forget `after()` telemetry
    pattern, `lib/embeddings.ts`'s bounded retry, the content-hash cache in `design_documents`
    (`hashConversationState`), or Anthropic prompt caching at `PROMPT_CACHE_BREAK`
    (`lib/prompt-cache.ts`) — rather than inventing a new mechanism from scratch?
  - Does this introduce a new failure mode — new external call, new async step — that needs
    explicit handling and a defined degradation, given there is no explicit Anthropic retry
    policy (TD-05) and no circuit breaker or fallback provider?
  - Does this add per-message cost or latency — another Haiku classifier call, more embedding
    round-trips, larger `LIMITS` (more grounding tokens per Sonnet call) — on surfaces that already
    make two model calls per Analyse/Library question, or is the pressure genuinely negligible and
    worth saying so explicitly?
  - Is there a real architectural alternative here — e.g. extend an existing `/api/chat` mode vs.
    add a new one, reuse an existing retrieval `Surface`/kind vs. add a new one, extend
    `lib/pathway-store.ts` vs. query tables inline, synchronous inline handling vs. some new async
    mechanism this repo doesn't currently have — even if the answer turns out to be "no, the
    obvious approach is also the only reasonable one"?

Present questions as a numbered list, grouped by theme if there are more than ~6. End with:
*"Answer these, or tell me to proceed with reasonable assumptions — I'll mark any assumed items
as assumptions in the plan."* Anything left unanswered goes into the plan's **Assumptions**
section, never silently decided.

Record the questions and answers in `architecture_clarifications_<feature_name>.md` (update it on
each round). Don't add technical answers to the business clarifications file; that file belongs to
`brd-validation`. If a business answer has to change, say so and suggest re-running
`brd-validation` for that point.

```markdown
# Architecture Clarifications: <Requirement Title>

Technical clarifications (`architecture-plan`). **Answered YYYY-MM-DD.** Business decisions are
in [`business_clarifications_<feature_name>.md`](business_clarifications_<feature_name>.md).

## Repo findings these questions are based on
<Short notes from Stage 1: affected routes, tables, modules, technical debt, invariants — with
paths>

## Technical questions
| # | Theme | Question | Answer / decision |
|---|-------|----------|-------------------|
| 1 | Data contract | ... | ... (or "Waived — assumed: ...") |
<Include each parked question from brd-validation, marked with its origin>

## Plan-review decisions
<Decisions made while reviewing the plan in Stage 3, dated>

## Open items
<Anything still to be decided, with who decides>
```

---

## Stage 3 — Architectural Reasoning & Implementation Plan (STOP — wait for human review)

Once clarifications are resolved (answered or explicitly waived), **reason through design
before drafting anything** — don't jump straight from "here's what was asked for" to "here's how
to build it." Think like architect on this feature, not just its scribe:

1. **Locate this feature in actual system.** Which existing boundary (module, service, layer,
   bounded context) does it belong inside? Does it stay entirely within one boundary, or does it
   need to cross one — and if it crosses one, is that crossing consistent with how this repo
   already lets its boundaries talk to each other (defined interface/contract) or does it
   introduce new, ad hoc coupling?
2. **Generate at least one real alternative** before committing to approach — different place to
   put logic, sync vs. async choice, extending existing structure vs. adding new one, reusing
   existing pattern vs. introducing new one. For genuinely small, unambiguous change this can be
   quick, but do it explicitly rather than skipping straight to first idea that came to mind —
   alternative you reject and reason you rejected it is often more informative to reviewer than
   approach you kept.
3. **Name tradeoffs in approach you're leaning toward**, even ones requirement didn't ask about:
   what does this decision cost — future flexibility, new dependency, added latency, small
   amount of duplicated logic accepted deliberately to avoid worse coupling? Plan with no
   acknowledged tradeoffs either found rare free lunch or didn't look hard enough.
4. **Check consistency with this repo's existing architectural stance**, not just its file
   conventions — is this repo deliberately monolithic/modular, sync/async, tightly/loosely
   coupled by design? Does chosen approach reinforce that stance or quietly erode it? If it
   erodes it, that's not automatically wrong, but must be called out as deliberate exception,
   not slipped in as if it were obvious choice.
5. **Consider non-functional consequences even when requirement is purely functional** — most
   feature requests don't mention performance, availability, or security, but most features
   still have some effect on them. Where effect is genuinely negligible, say so explicitly in
   plan rather than omitting section; don't let silence stand in for "I checked and it's fine."

This is internal reasoning that then has to show up in plan below — a plan whose "Architectural
Approach" section reads like feature description with no alternative considered and no tradeoff
named has skipped this step, not completed it.

Plan itself is review artifact for human, not yet task list — keep it at level of "what are we
building, why this way, and what does it cost," not "here is every subtask."

Structure:

```markdown
# Plan: <Requirement Title>

## Summary
<2-4 sentences: what this delivers and why>

## Scope
**In scope:** ...
**Out of scope:** ...

## Assumptions
<Only present if clarifications were waived — list each assumption explicitly>

## Affected Areas
| Area | Component(s) | Nature of change |
|------|--------------|-------------------|
| Routes/API | `app/api/<resource>/[...]/route.ts` (new file, wrapped in `withErrorHandling('api/<path>', handle<METHOD>)`) or an existing handler, e.g. `app/api/chat/route.ts`'s mode dispatch + `requiredRole` | new route / modified handler / new mode |
| Data | `supabase/migrations/00NN_<description>.sql` (next sequential number after `0042`, leading purpose comment, destructive steps called out in capitals) | new migration — no ORM, so also note every `.from('table')` call site elsewhere that needs updating, and any `published_pathways` view change |
| Domain logic | `lib/<concern>.ts` (flat, one file per concern — e.g. `lib/system-prompts.ts` for prompt changes and the shared answer-shape constants, `lib/retrieval.ts` for grounding/`LIMITS`, `lib/pathway-store.ts` for pathway versions/publish, `lib/roles.ts` for access logic, `lib/grid-update.ts` for the `<grid_update>` contract, `lib/rate-limit.ts` for limits) | new/modified module |
| External integration/config | Anthropic (`app/api/chat/route.ts` mode + `lib/system-prompts.ts`; Haiku classifier in `lib/retrieval.ts`), `embed` Edge Function (`lib/embeddings.ts`, `supabase/functions/embed/`), Supabase Storage (`toolkit-assets`, `pathway-sources`), Supabase Auth/email (`lib/email.ts`, `app/api/auth/*`), env vars (`.env.example`, `architecture/configuration.md`) — name which | new call site / config change |
| Frontend | `app/<surface>/page.tsx` (server) + its client counterpart (e.g. `StrengthenWorkspace.tsx`, `ContributeGrid.tsx`, `ExploreLibrary.tsx`), or a new/modified file under `components/` | new/modified page or component |
| Tests | Vitest files in the existing `tests/` layout — `tests/unit/lib/`, `tests/unit/server/`, `tests/api/<area>/`, `tests/client/`, `tests/features/<feature>/`, `tests/pages/`, `tests/proxy/`, `tests/db/migrations.test.ts` — using `tests/helpers/` mocks | new/extended test files |

## Architectural Approach
<Which existing boundary/module/service/layer this lives inside, and whether it crosses one;
data flow through the system for this feature; the key design decisions and the rationale for
each — not just what was chosen but why it's consistent with (or a deliberately called-out
exception to) this repo's existing architectural stance>

## Alternatives Considered
<At least one real alternative — including "do nothing"/defer, or the most obvious naive
approach — with a concrete one-line reason it was rejected in favor of the chosen approach. If
genuinely only one approach was viable, say explicitly why no alternative was worth considering
rather than omitting this section>

## Key Tradeoffs
<For each non-trivial decision in Architectural Approach, name the tradeoff — omit only if the
decision truly has none, which should be rare:>
**Tradeoff: <short title>**
- Decision made: <what was chosen>
- What is gained: <benefit>
- What is given up / deferred: <cost, risk, or follow-on work this decision creates>

## Non-Functional Impact
<Only the dimensions genuinely relevant to this feature — but check all of them before omitting
any, and say "negligible" explicitly rather than leaving a dimension out silently:>
- **Performance/scale**: new query/processing patterns against Supabase (no ORM — a raw
  `.from('table')` call, so N+1 risk is on the caller to notice; several FK/RLS-filter columns
  already lack indexes, TD-25), grounding size and per-message cost (retrieval sends only what
  `LIMITS` allows — does this raise a limit, add a Haiku classifier call or extra `embed`
  round-trips?), expected request volume relative to what this single-Node-process monolith and
  the per-account/per-IP rate limits already allow
- **Availability/failure modes**: what happens if a new external call, new async step, or new
  dependency this feature introduces fails or times out — there is **no explicit retry/timeout
  policy on any Anthropic call** (only the SDK's implicit 2 pre-response retries, TD-05); a
  pre-stream failure becomes a 500 with the generic message via `withErrorHandling`, a mid-stream
  one a partial reply + generic message with nothing saved; the `embed` function retries twice and
  then callers degrade. Does the feature degrade gracefully (state the degradation), or does it
  risk taking something else down with it?
- **Security**: new attack surface — a new input, a new permission boundary (and which layer —
  `proxy.ts` session gate, page-level UX check, API-level `requiredRole`/`hasRole`/`isAdmin`, RLS —
  actually owns it), whether it needs a rate limit or size cap, a new service-role read that
  bypasses RLS (who checks the caller?), anything newly readable through the owner-rights
  `published_pathways` view (TD-18), a new place user-controlled data flows into prompts (no PII
  screening exists, TD-15)
- **Consistency/coupling**: does this introduce a new dependency between previously-independent
  parts of the system (e.g. between `designs` and `pathways`, or between a new surface and
  `lib/retrieval.ts`), or duplicate logic that already exists elsewhere in the codebase (check
  `architecture/coding-patterns.md`'s "deliberately independent markdown renderers" and
  `knowledge/technical-debt.md` TD-14 before adding another renderer or chat UI)?

## Data Model / API Changes
<New/changed tables, fields, endpoints, request/response shapes — only if applicable>

## Risks & Open Items
<Anything uncertain, any known technical debt this touches, any performance-sensitive logic that
will need a comment flagging it per this repo's conventions, and any accepted Key Tradeoff whose
cost the team should consciously sign off on rather than discover later. If this requirement
depends on any AI call, flag TD-16 here: the Product Charter recorded the Anthropic API account as
a free grant expiring **28-Oct-2026** — that date has passed and whether it was renewed cannot be
seen from code — with no fallback provider (the chat route, the Haiku classifier, `check-similar`
and the seed script all depend on it). If it depends on the Docker/AWS path, note the AWS account
expires December 2026. If it touches pathway data, note TD-17 (no copy outside Supabase, no export
tooling). These are external constraints to surface for the team's awareness, not something this
plan is expected to solve>

## Sequencing
<Suggested build order if there are dependencies between parts>
```

Present this plan to user and **explicitly ask for review**: approve as-is, or request changes.
Don't write `plan_<feature_name>.md` on implicit approval (e.g. user just saying "ok" to
something else) — get clear go-ahead on plan specifically. Revise and re-present if changes are
requested.

**Once plan is approved, write `plan_<feature_name>.md` and revisit
`requirement_<feature_name>.md`.** Scope decisions made during Stage 2/3 routinely change shape
of what's actually being built relative to how `brd-validation` first framed it. Update its plain-language summary (same
PM-readable bar `brd-validation` uses) to reflect *final* scope: fold in plan's `Summary` and `Scope`
sections, translated out of engineering terms, and redraw its flowcharts to match, so PM reading
`requirement_<feature_name>.md` alone gets real, final picture.

The flow charts live in the requirement. In the plan, point to them (e.g. "The flowcharts … are in
[`requirement_<feature_name>.md`](requirement_<feature_name>.md) → 'Flow charts'") rather than
copying them. An engineering diagram that the plan genuinely needs (a sequence or data-flow
diagram with routes and tables) is fine in the plan as a fenced `mermaid` block.

When the requirement is revised to the final scope, keep it PM-readable: update the flow charts
and their explanations, and add a dated "Updated YYYY-MM-DD:" line under each chart that changed,
so a gate dropped or added during planning shows in the picture as well as the prose. Use the
same Mermaid conventions the chart already follows (see `brd-validation`'s "Flow charts" section).
Update the requirement's status line to point to the plan.

Then tell the user the next step is the `task-creation` skill.

---

## Output

```
docs/features/<feature-slug>/
├── requirement_<feature_name>.md     # brd-validation; this skill updates it to the final scope
├── business_clarifications_<feature_name>.md      # brd-validation — read, not edited here
├── architecture_clarifications_<feature_name>.md  # this skill: technical Q&A and plan-review decisions
├── plan_<feature_name>.md            # this skill: the reviewed/approved plan
└── task_list_<feature_name>.md       # task-creation skill — not written here
```

The folder uses a short kebab-case `<feature-slug>`; files use the same words in snake_case as
`<feature_name>` (e.g. `docs/features/toolkit-asset-files/plan_toolkit_asset_files.md`). Links
between the files use these full names. Write into the existing feature folder; never start a
second folder for the same feature. Don't write `plan_<feature_name>.md` until the plan is
approved. Its status line records the approval date, e.g. `> Status: **Approved YYYY-MM-DD**
(architecture-plan). Inputs: [requirement](…), [business clarifications](…), [architecture
clarifications](…).`

---

## Behavioral Rules

- **Never skip the two STOP points.** Technical questions and the plan both need an explicit
  human response.
- **Never write the task list.** Point the user to `task-creation`.
- **The requirement is the business contract.** Don't re-ask what it answers; raise a conflict
  as a question rather than silently changing scope.
- **Ground everything in actual repo context, not assumption.** If a planning doc and actual code
  disagree, code (or code-verified wiki) wins.
- **No silent scope creep.** Adjacent work goes into Risks & Open Items unless the user agrees.
- **Don't fabricate affected files.** Every "Affected Areas" row traces to something you found.
- **Every plan shows real architectural reasoning:** at least one alternative genuinely
  considered (with why it was rejected), an explicit tradeoff for each non-trivial decision, and
  a non-functional-impact check that isn't silently skipped — however small the feature looks.
- **Respect this repo's actual conventions, not generic best practice.**
- **Don't recommend fixing unrelated technical debt.** Name it in Risks & Open Items so the user
  can decide.

---

## Tailoring this skill to a specific codebase

> **Already tailored** to Diffusion Cube on branch `Swanand_DC`, 2026-10-14, by splitting the
> technical stages (repo grounding, technical questions, architectural reasoning, plan) out of
> `.claude/skills/brd-task-creator/SKILL.md`. That skill's grounding came from the wiki at
> `docs/wiki/diffusion-cube/` (first pass) plus a 2026-09-28 roadmap refresh. If the stack, the
> chat route's mode list, the migration count or the publish-flow gating changes materially,
> re-run this procedure — and check whether the wiki has been regenerated since.
>
> **Stack refresh, 2026-11-06** (HEAD `0a1ca00`), against the wiki fully refreshed that day
> (`ai-context.md`, `architecture/architecture-overview.md`, `architecture/testing.md`,
> `architecture/coding-patterns.md`, `architecture/repository-conventions.md`,
> `business/business-overview.md`, `business/workflows.md`, `business/users-and-personas.md`,
> `integrations/ai-llm.md`, `integrations/third-party-integrations.md`,
> `knowledge/technical-debt.md`) and spot-checked in code, in step with the same pass on
> `brd-task-creator` (Stage 1, Stage 2 themes and the plan template are kept identical to it).
> Changed: 7 chat modes (not 8); Sonnet + Haiku classifier + `embed` Edge Function; retrieval
> grounding instead of whole-corpus injection; pathways only in Supabase (`0042`,
> `lib/pathway-store.ts`, `published_pathways` view), GitHub publish / Sheets logging / static
> corpus removed; every signup an `adopter` (`0039`); per-user chat rate limits; 42 migrations;
> W8–W10 as the planned workflows; current TD IDs (TD-01/02 resolved, TD-05 reworded,
> TD-16 date passed, TD-17/18/20/22/23/24/26 added); a Tests row in Affected Areas.

Trigger: the user says something like *"Update this skill to suit the tech stack of this
codebase"* (or names this skill while asking for the same).

1. Read `brd-task-creator`, `fullstack-developer`, `code-reviewer` and `qa-tester` in this repo
   first; reuse their stack findings (routing, data layer, auth, tests, docs location).
2. Otherwise use `docs/wiki/<service>/` (start with `ai-context.md`), falling back to a repo scan
   only if the wiki is missing or stale.
3. Rewrite Stage 1's context list, Stage 2's question themes and the plan template's Affected
   Areas / Non-Functional Impact with this repo's actual names and paths. Don't invent conventions
   you didn't confirm.
4. Update the frontmatter `description` to name the actual stack, keeping trigger phrasing
   generic.
5. Keep this section.
