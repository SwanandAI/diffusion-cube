---
name: architecture-plan
description: >
  Turns a validated business requirement into a human-reviewed architecture / implementation plan
  — tailored to Diffusion Cube, the Next.js 16 App Router / React 19 / TypeScript / Tailwind v4
  monolith at 100pathways.com's Adoption Companion, backed by Supabase Postgres+Auth (no ORM,
  sequential migrations under `supabase/migrations/`) and a single Anthropic (`claude-sonnet-4-6`)
  chat route (`app/api/chat/route.ts`, 8 modes). Reads `docs/features/<feature-slug>/requirement_<feature_name>.md`
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
     code-verified as of branch `Swanand_DC`) — **the primary source of truth**, more current
     than the root-level `CLAUDE.md`/`ARCHITECTURE.md`/`conversation_design.md`, which the wiki's
     own reconciliation tables document as substantially stale (e.g. `CLAUDE.md` still describes
     a four-intent Explorer menu and a `/explore` entry point that no longer exist; both docs
     describe the Contributor's publish button as single-step self-serve when it is actually a
     two-step contributor-assemble + admin-publish gate). Always start with
     `docs/wiki/diffusion-cube/ai-context.md`, then pull only the pages matching the
     requirement's affected areas:
     - Routes/API → `application/api-specification.md`, `architecture/sequence-diagrams.md`
     - Data/schema → `application/database.md` (32 sequential Supabase migrations, ERD, RLS notes)
     - Auth/roles → `business/users-and-personas.md`, `business/business-rules.md`
     - AI/LLM chat surface → `integrations/ai-llm.md`
     - Frontend → `application/frontend.md`
     - Known limitations for the affected area → `knowledge/technical-debt.md`
     - Whether this is already-roadmapped, not a fresh ask → `business/business-overview.md`'s
       "Roadmap (Planned, Not Yet Implemented)" section (milestones through 15-Mar-27, the
       prioritized requirements backlog with per-item status, the execution model) and
       `business/workflows.md`'s "Planned Workflows" section (W5 contributor reuse/incentive loop,
       W6 pathway curation lifecycle, W7 guided Adopter-to-Contributor transition)
   - `CLAUDE.md`/`AGENTS.md`/`ARCHITECTURE.md`, only as secondary corroboration, and only where
     the wiki doesn't cover something — never let a raw doc override a wiki claim it explicitly
     reconciles against.
   - If the wiki itself looks stale relative to what you can see in code (a route/table it
     doesn't mention, or a migration number higher than what it lists): tell the user and ask
     whether to regenerate it (`llm-wiki` skill) or proceed on a direct repo scan (grep/glob over
     `app/api/**/route.ts`, `supabase/migrations/*.sql`, `lib/`, `components/`) as a cross-check.
     Don't silently skip this choice.
2. Cross-reference requirement against what you found. Note explicitly (for your own working
   notes, and later for plan):
   - **Check whether this requirement is already scoped by the product roadmap before designing
     anything.** Before reasoning about *how* to build what's been asked, check
     `business/business-overview.md`'s "Roadmap (Planned, Not Yet Implemented)" section and
     `business/workflows.md`'s "Planned Workflows" (W5–W7) for whether this requirement — or
     something adjacent to it — is already named there (e.g. a requirement touching
     contributor-reuse visibility maps to W5 and the "Incentivize Contributors"/"Visibility into
     Pathway Usage & Reuse" milestones, both currently "Not started" and reading from the
     write-only `adoption_queries` table; a requirement touching pathway removal/curation maps to
     W6; a requirement touching the Explorer/Contributor relationship maps to W7 and the
     `users-and-personas.md#planned-vs-current-adopter-contributor-relationship` gap — e.g. the
     charter's stated intent that an existing `pathway_contributor` should be able to analyze their
     own adoption too, which current code does not allow since `/analyse` requires the `adopter`
     role specifically). If the requirement is already scoped there: **build the plan on top of
     that stated intent** (named scope, target milestone, charter status) rather than re-deriving
     goals from scratch — and treat any place where the requester's actual ask diverges from the
     roadmap's stated scope as an **explicit decision point for Stage 2's clarifying questions**,
     never something this skill silently resolves either way (neither silently narrowing to what
     the roadmap says nor silently expanding to match it without asking).
   - Which existing routes/handlers (`app/api/**/route.ts`), `lib/` modules, Supabase tables, or
     `components/`/page files this touches
   - Which documented business rule this extends, changes, or contradicts — **never silently
     violate**, in particular:
     - The model never writes to Supabase directly — every `/api/chat` mode returns a trailing
       `<grid_update>` JSON block; the *client* (`lib/adoption-conversation.ts`) parses it and
       performs the actual write. A requirement that implies "the model saves X" needs to be
       reframed as "the model signals X, the client persists it."
     - The Provenance/Source Trace appendix on a pathway document is contributor-only — never
       adopter-facing, never surfaced on `/wiki` or in `/analyse` chat.
     - Publishing a pathway is two independently-gated steps: contributor "assemble"
       (`POST /api/pathways/assemble`, commits to GitHub, sets `pathways.content_cache`/
       `review_requested`) does **not** make it live; only admin "publish"
       (`POST /api/admin/pathways/publish`, copies into `published_pathways`) does. A requirement
       that assumes one-step self-serve publish (the description in `CLAUDE.md`) is working
       against a stale model — flag this explicitly rather than building toward it.
   - Any tracked technical debt from `knowledge/technical-debt.md` worth flagging for the
     affected area — e.g. a requirement touching the Contributor publish path inherits TD-01
     (three route files/one lib module still reference the dropped `pathway_submissions` table —
     don't extend or resurrect that pattern); a requirement adding a new Anthropic call site
     inherits TD-05 (no retry/backoff exists anywhere on any Anthropic call today — match that
     absence rather than quietly adding a one-off retry wrapper, and flag the gap in Risks &
     Open Items instead); a requirement touching pathway content should ask which of the two
     independently-maintained corpora (`content/wiki/pathways/` grounding corpus vs.
     `content/library-wiki/pathways/` Library corpus, TD-02) it's meant to affect, since they can
     drift apart silently.

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

- **Actors & permissions** — which of `general_user`/`adopter`/`pathway_contributor`/`admin` are
  affected. This repo enforces access **three layers deep, and only the last is the real gate**:
  `proxy.ts` middleware only checks for a signed-in session (treats `/analyse` and `/contribute`
  as publicly reachable at that layer, deliberately); page-level checks (e.g.
  `StrengthenWorkspace.tsx`, `ContributeGrid.tsx`) are UX only; the actual enforcement is
  `hasRole`/`hasAnyRole` (`lib/roles.ts`) re-checked inside the API route handler, and in a couple
  of places (e.g. `pathways` insert) an `exists (select ... from user_roles)` RLS policy at the
  database layer too. Ask explicitly which of these layers the new requirement needs to add or
  change — don't assume a page-level check alone is sufficient.
- **Data contract** — new columns/tables need a new file under `supabase/migrations/`, numbered
  one higher than the current max, with a leading SQL comment stating its purpose (matching every
  existing migration's style) — there is no ORM, so there's no separate schema-definition file to
  keep in sync, but there's also no compile-time contract catching a call site that still reads an
  old column/table shape (this is exactly how TD-01's dead code and migration `0027`'s
  silently-failing constraint happened) — call out anywhere a rename/removal could break a sibling
  `.from('table')` call site that isn't obviously nearby.
- **Route/API contract** — new endpoints go under `app/api/**/route.ts`, one file per endpoint,
  named by resource/action folder path (e.g. `app/api/pathways/[id]/join/route.ts`), **not** by
  HTTP verb; state the request/response shape; state whether it needs `hasAnyRole`/`hasRole` from
  `lib/roles.ts`, and if it's a `companion`-mode-adjacent call, whether `flow`/role also needs
  server-side re-validation the way `app/api/chat/route.ts` already does.
- **AI/LLM impact** — if this touches the chat surface: does it need a **new mode** on the single
  `app/api/chat/route.ts` dispatcher (which already carries 8: `companion`, `library`,
  `extract-insights`, `analysis-doc`, `executive-summary`, `plan-document`, `pathway-draft`,
  `pathway-exec-summary`), or does it extend an existing mode's prompt in `lib/system-prompts.ts`?
  Does it need to read/write the `<grid_update>` contract (`lib/grid-update.ts`)? Which pathway
  corpus does it touch — the grounding corpus (`content/wiki/pathways/`, `lib/wiki-loader.ts`) or
  the Library corpus (`content/library-wiki/pathways/`, `lib/library-wiki-loader.ts`) — these are
  two independently-maintained corpora (TD-02), not one, and confusing them silently is a real
  drift risk. Note there is no retry/backoff on any Anthropic call anywhere in this app (TD-05) —
  a new call site should match that absence rather than quietly introducing its own one-off retry
  wrapper, unless the user explicitly wants that gap closed as part of this requirement.
- **Invariant-critical impact** — does this change anything the model currently must never write
  directly (all persistence for companion-mode conversations goes through the client parsing
  `<grid_update>`, never a server-side DB write from the model's own response), or the two-step
  pathway-publish gate (contributor "assemble" vs. admin "publish")? Any such write must go
  through the existing mechanism, never a new direct write that bypasses it.
- **Frontend decisions this repo requires explicit answer on before design** (always ask, never
  assume):
  - Does the new page/view get its own `AppShell` + `Sidebar` instantiation (the pattern each of
    `/explore`, `/analyse`, `/contribute`, and the `(app)` route group currently follows
    independently — there is no single central authenticated layout), or does it belong inside an
    existing surface's workspace (e.g. `AdoptionWorkspace.tsx`)?
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
- **Edge cases requirement is silent on** — empty states, concurrent double-submit of request
  (this app has no job queue or background worker anywhere — everything runs inline in the
  request/response cycle of a Next.js route handler), large input (document uploads go through
  client-side extraction — `pdfjs-dist`/`mammoth`/`xlsx`/`jszip` — before ever reaching an API
  route), external-call failures mid-pipeline (no retry exists on any Anthropic call today, see
  TD-05 above), permission-denied paths (which of the three enforcement layers should surface the
  denial, and how).
- **Integration impact** — the only external providers this app actually integrates with are the
  Anthropic API (`app/api/chat/route.ts`, `app/api/pathways/check-similar/route.ts`), Supabase
  Auth (session, OTP, the Send Email Auth Hook at `app/api/auth/send-email/route.ts`), SMTP via
  `nodemailer` (`lib/email.ts`), the GitHub Contents API (`lib/github.ts`, used only by contributor
  "assemble"), and Google Sheets logging (`lib/logger.ts`, fire-and-forget, optional). There is no
  payment provider, no messaging/webhook integration beyond Supabase's own Auth hook, and no
  OAuth/SSO beyond Supabase's own email+password/OTP flow. If the requirement implies any of
  these, name which one and confirm it's genuinely new rather than an extension of one already
  listed.
- **Architectural impact** — think like architect, not just feature-writer, and ask rather than
  assume:
  - Does this cross an existing boundary — e.g. adding a ninth mode to the single
    `app/api/chat/route.ts` dispatcher, or a new call site into a table another surface already
    owns (`designs` for Explorer, `pathways`/`design_documents` for Contributor)?
  - Does an equivalent problem already have a solution elsewhere in this codebase that should be
    reused rather than duplicated — e.g. the forced-tool-use pattern in
    `app/api/pathways/check-similar/route.ts` (the one non-streaming Anthropic call in the app),
    the `hasRole`/`hasAnyRole` permission-check pattern (`lib/roles.ts`), or the
    content-hash-cache pattern in `design_documents` (regeneration served from DB when the
    underlying conversation hasn't changed) — rather than inventing a new caching or
    permission-check mechanism from scratch?
  - Does this introduce a new failure mode — new external call, new async step — that needs
    explicit handling, given that this repo has zero retry/backoff anywhere today and an
    unhandled Anthropic SDK error currently surfaces as a raw Next.js 500?
  - Does this put meaningful new pressure on the one thing this repo already tracks as a scaling
    concern — whole-corpus prompt injection (~22K tokens of framework + all pathway docs, per
    companion turn, with no retrieval layer) — or is the pressure genuinely negligible and worth
    saying so explicitly?
  - Is there a real architectural alternative here — e.g. extend an existing `/api/chat` mode vs.
    add a new one, reuse the existing corpus-loader pattern vs. add a third loader, synchronous
    inline handling vs. some new async mechanism this repo doesn't currently have — even if the
    answer turns out to be "no, the obvious approach is also the only reasonable one"?

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
| Routes/API | `app/api/<resource>/[...]/route.ts` (new file) or an existing handler, e.g. `app/api/chat/route.ts`'s mode dispatch | new route / modified handler / new mode |
| Data | `supabase/migrations/00NN_<description>.sql` (next sequential number, leading comment stating purpose) | new migration — no ORM, so also note every `.from('table')` call site elsewhere that needs updating |
| Domain logic | `lib/<concern>.ts` (flat, one file per concern — e.g. `lib/system-prompts.ts` for prompt changes, `lib/roles.ts` for access logic, `lib/grid-update.ts` for the `<grid_update>` contract) | new/modified module |
| External integration/config | Anthropic (`app/api/chat/route.ts` mode + `lib/system-prompts.ts`), Supabase Auth/email (`lib/email.ts`, `app/api/auth/*`), GitHub (`lib/github.ts`), or Sheets logging (`lib/logger.ts`) — name which | new call site / config change |
| Frontend | `app/<surface>/page.tsx` (server) + its client counterpart (e.g. `StrengthenWorkspace.tsx`, `ContributeGrid.tsx`), or a new/modified file under `components/` | new/modified page or component |

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
  `.from('table')` call, so N+1 risk is on the caller to notice), payload size (relevant if this
  adds to the ~22K-token whole-corpus prompt injection every companion turn already carries),
  expected request volume relative to what this single-Node-process monolith already handles
- **Availability/failure modes**: what happens if a new external call, new async step, or new
  dependency this feature introduces fails or times out — remember this repo has **zero
  retry/backoff on any Anthropic call today**, so an unhandled failure here surfaces as a raw
  Next.js 500 unless this plan explicitly adds handling; does the feature degrade gracefully, or
  does it risk taking something else down with it?
- **Security**: new attack surface — a new input, a new permission boundary (and which of the
  three enforcement layers — middleware session gate, page-level UX check, API-level `hasRole`/
  RLS — actually owns it), a new external call, a new place user-controlled data flows into
- **Consistency/coupling**: does this introduce a new dependency between previously-independent
  parts of the system (e.g. a new cross-reference between the grounding corpus and the Library
  corpus, or between `designs` and `pathways`), or duplicate logic that already exists elsewhere
  in the codebase (check `knowledge/technical-debt.md`'s "deliberate vs. debt" duplication notes
  before adding a fourth parser/loader/renderer where a third already exists)?

## Data Model / API Changes
<New/changed tables, fields, endpoints, request/response shapes — only if applicable>

## Risks & Open Items
<Anything uncertain, any known technical debt this touches, any performance-sensitive logic that
will need a comment flagging it per this repo's conventions, and any accepted Key Tradeoff whose
cost the team should consciously sign off on rather than discover later. If this requirement's
rollout/delivery timeline would land near or after **28-Oct-2026**, flag TD-16 explicitly here: the
Anthropic API account backing every AI-mode call in this app (`app/api/chat/route.ts`,
`app/api/pathways/check-similar/route.ts`) is a free grant that expires that date per the Product
Charter, with no fallback model/provider configured anywhere in code — if it lapses unrenewed,
every AI-backed feature stops working outright. This is a real external constraint to surface for
the team's awareness when timing is relevant, not something this plan is expected to solve>

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
