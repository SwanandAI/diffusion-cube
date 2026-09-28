---
name: brd-task-creator
description: >
  Turns business requirement (BRD, feature ask, one-liner, or attached requirement doc) into
  implementation-ready task list — tailored to Diffusion Cube, the Next.js 16 App Router /
  React 19 / TypeScript / Tailwind v4 monolith at 100pathways.com's Adoption Companion, backed by
  Supabase Postgres+Auth (no ORM, sequential migrations under `supabase/migrations/`) and a
  single Anthropic (`claude-sonnet-4-6`) chat route (`app/api/chat/route.ts`, 8 modes). Grounds
  itself in this repo's LLM-native wiki (`docs/wiki/diffusion-cube/`, primary source of truth —
  more current than `CLAUDE.md`/`ARCHITECTURE.md`) or a direct repo scan if the wiki is stale,
  asks clarification questions before planning, reasons through requirement's architectural
  impact — boundaries crossed, alternatives, tradeoffs, and non-functional consequences — before
  drafting human-reviewed implementation plan, and — only after plan is approved — converts it
  into task list of User Stories with Acceptance Criteria and a Test Plan covering positive,
  edge, and negative cases (with realistic manual-verification framing, since this repo has no
  automated test suite today). Use when user asks to "turn this requirement into
  tasks", "create user stories from this BRD", "break this feature down into a task list",
  "generate acceptance criteria", or pastes/attaches requirement and asks for plan or backlog.
  Also triggers on "update this skill to suit the tech stack of this codebase" — see **Tailoring
  this skill to a specific codebase** at bottom.
---

# BRD → Task List Creator

You are expert Software Architect and Business Analyst. Job: take raw requirement and turn it
into task list an engineering team can pick up directly — without inventing scope, skipping
ambiguity, or asking user to review something no one asked for.

This is **staged, human-in-the-loop workflow**. Each stage has explicit stop point. Do not
collapse stages or skip ahead — value of this skill is in never presenting user with task list
they haven't had chance to correct upstream.

This copy of the skill has been tailored to **Diffusion Cube** (this repo, branch `Swanand_DC` at
tailoring time): a Next.js 16 App Router monolith, Supabase Postgres/Auth as the only stateful
backend (no ORM), and a single Anthropic chat route serving 8 modes. Every stage below names this
repo's actual conventions rather than a generic placeholder — if the stack changes materially,
re-run the tailoring procedure at the bottom rather than trusting these specifics blindly.

```
Requirement → Repo Context → Clarifying Questions (STOP) → Plan (STOP) → Task List
```

---

## Stage 0 — Intake the Requirement

Accept requirement in whatever form it arrives:

- Pasted text in conversation
- Path to document (`.md`, `.docx`, `.pdf`, `.txt`) — convert non-plain-text formats first, don't
  skip file just because it isn't directly readable
- Ticket/issue reference user pastes inline

Restate requirement in 2-4 sentences before anything else, so misunderstanding surfaces
immediately rather than after full planning pass.

**Write restated requirement so Product Manager can understand it without engineering
context.** This is summary that ends up in `requirement.md` — it has to stand on its own for
someone who wasn't in technical conversation. That means:
- Plain language: describe what changes for user/business, not which files or functions
  change.
- Translate mechanism into outcome: retry cap, config toggle, new background job — each of
  these exists to produce user- or business-visible effect. State effect; mechanism belongs
  in `plan.md`, not here.
- Define unavoidable technical terms inline, briefly, first time they appear.
- If requirement involves genuine tradeoff or cost (added latency, added cost, feature
  intentionally deferred), say so in same plain terms.

If requirement is missing clear **goal** or **actor** (who wants this, and why), don't guess —
fold that into Stage 2's clarification list rather than blocking here.

---

## Stage 1 — Ground in Repo Context

Before reasoning about impact or asking questions, find out what system actually looks like
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

## Stage 2 — Clarifying Questions (STOP — wait for the user)

Generate clarifying questions from gap between requirement and what Stage 1 found. Don't
proceed to Stage 3 until user has answered or explicitly said "no more questions, proceed."

Cover, where relevant to requirement:

- **Scope boundaries** — what's explicitly out of scope; is this additive or does it change
  existing documented behavior (check against `docs/wiki/diffusion-cube/business/business-rules.md`
  and `business/workflows.md` first)?
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

Present questions as numbered list, grouped by theme if more than ~6. End with explicit prompt:
*"Answer these, or tell me to proceed with reasonable assumptions — I'll mark any assumed items
as assumptions in the plan."* If user chooses to let some go unanswered, carry them into plan as
labeled **Assumptions** section rather than silently deciding.

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
Don't proceed to Stage 4 on implicit approval (e.g. user just saying "ok" to something else) —
get clear go-ahead on plan specifically. Revise and re-present if changes are requested.

**Once plan is approved, revisit `requirement.md` before moving to Stage 4.** Scope decisions
made during Stage 2/3 routinely change shape of what's actually being built relative to how it
was first framed in Stage 0. Update `requirement.md`'s plain-language summary (same PM-readable
bar as Stage 0) to reflect *final* scope: fold in plan's `Summary` and `Scope` sections,
translated out of engineering terms, so PM reading `requirement.md` alone gets real, final
picture.

---

## Stage 4 — Task List (User Stories, Acceptance Criteria, Test Plan)

Only after plan is approved, decompose it into task list. Break plan's "Affected Areas" and
"Sequencing" into independently deliverable stories — small enough to review and test
individually, but not so granular they lose "why."

For each story, use this structure:

```markdown
### <STORY-ID>: <Short title>

**As a** <role/actor>
**I want** <capability>
**So that** <benefit / business reason>

**Priority:** P0/P1/P2
**Depends on:** <other story IDs, or "None">

**Acceptance Criteria:**
- Given <context>, when <action>, then <expected outcome>
- Given ..., when ..., then ...
  <cover every clarified behavior and every business rule this touches from repo context — e.g.
  "Given the model's response includes `pathwayAction: 'publish'`, when the client processes it,
  then it calls `/api/pathways/assemble`, not `published_pathways` directly" or "Given a caller
  without the `pathway_contributor` role, when they POST to the new endpoint, then the API route
  itself returns 403 regardless of what any page-level check already did">

**Test Plan:**
> This repo has **no automated test suite today** (no `*.test.*`/`*.spec.*` files, no Jest/Vitest
> config, no CI test job — `.github/workflows/deploy.yml` only builds and deploys). Every case
> below is a **manual verification step** — a concrete action plus an expected observable result
> in the running app or in Supabase — unless the plan explicitly calls for standing up a test
> framework as part of this requirement. Don't phrase a case as if a CI gate already exists to
> catch it.
- *Positive:*
  - ... (state the concrete manual action — e.g. "sign in as an `adopter`, submit X, confirm Y
    appears in `designs.grid_state`" — not just "happy path works")
- *Edge cases:*
  - ... (empty input; large document upload through the client-side extraction pipeline
    (`pdfjs-dist`/`mammoth`/`xlsx`/`jszip`); double-submit of a companion chat message during the
    lazy `designs` row creation, which `lib/adoption-conversation.ts` already dedups via
    `creatingRef` — confirm this new behavior doesn't bypass that)
- *Negative cases:*
  - ... (invalid input; unauthenticated access — confirm the **API route** itself rejects it, not
    just the page; wrong-role access, e.g. an `adopter` hitting a `pathway_contributor`-gated
    route; an Anthropic call failure — confirm it surfaces as something better than an unhandled
    500, if this plan added that handling; a Supabase write failure)
- *Non-functional (if applicable):*
  - Responsive layout check against the Tailwind v4 / `app/globals.css` brand tokens this repo
    actually uses
  - Migration correctness: does `supabase/migrations/00NN_<description>.sql` apply cleanly on top
    of the current 32, and does it stay additive per this repo's convention (only two prior
    migrations were destructive, and each says so in its filename/comment)?
  - Invariant correctness: any grid-state/document write happens through the client parsing
    `<grid_update>`, never a direct model-to-DB write; a pathway-publish story confirms "assemble"
    alone does **not** make content visible at `/wiki` or `/explore` until the separate admin
    publish step runs
  - Note explicitly whether this story would benefit from becoming this repo's *first* automated
    test (per `architecture/testing.md`'s recommendation: pure `lib/` string/JSON transforms are
    the cheapest starting point) — flag it as a suggestion, don't assume it will happen as part of
    this requirement unless the user said so
```

Rules for this stage:

1. **Trace every AC back to something** — original requirement, clarification answer, existing
   business rule from repo context, or decision recorded in plan's Architectural
   Approach/Key Tradeoffs (e.g. chosen failure-handling behavior becomes AC, not just prose in
   plan). Don't invent behavior not discussed.
2. **Every story needs at least one negative and one edge test case** — story with only
   happy-path tests isn't done.
3. **Reuse domain vocabulary from repo context** (entity names like `designs`/`pathways`/
   `published_pathways`, role names like `adopter`/`pathway_contributor`, workflow IDs like
   W1–W4 from `business/workflows.md`) rather than renaming concepts.
4. **Flag UI-decision stories** (shared `AppShell` vs. standalone page, hook-based interaction
   pattern) with the answer captured in Stage 2 stated directly in the story, not left implicit.
5. **Keep stories vertically sliced** where possible (touches route + its UI for one
   user-visible behavior) rather than slicing by layer, unless plan's sequencing explicitly
   calls for layer-by-layer delivery (e.g. a migration must land before the route that reads it).
6. **State test executability concretely, not aspirationally** — since this repo has no automated
   test runner or CI test gate today, every test case defaults to a manual verification step
   (state the concrete action and the concrete expected observation) unless the plan itself
   introduces test tooling. Never describe a case as though a CI suite will catch it when none
   exists. Live/integration checks that cost real money (e.g. an actual Anthropic call, an actual
   SMTP send via `scripts/smtp-test.mjs`) or mutate real state must be called out as such, never
   silently assumed to run automatically.

---

## Output

Write the artifacts under:

```
docs/tasks/<feature-slug>/
├── requirement.md      # Stage 0: PM-readable restated requirement + source;
│                        #          revised after Stage 3 approval to fold in the plan's
│                        #          final scope, still in plain language
├── clarifications.md   # Stage 2: questions asked + answers/waivers
├── plan.md              # Stage 3: the reviewed/approved plan (engineering-facing detail)
└── task-list.md          # Stage 4: user stories, AC, test plans
```

Use short kebab-case `<feature-slug>` derived from requirement title. If `docs/tasks/` doesn't
exist yet, create it — this sits alongside `docs/wiki/diffusion-cube/` (the `llm-wiki` skill's
own output directory under `docs/`), so `docs/tasks/` is consistent with this repo's existing
`docs/`-rooted convention for generated artifacts.

Don't write `plan.md` or `task-list.md` until their respective stage has been approved.

**This is a complement to existing product tracking, not a duplicate of it.** This repo's own
product-requirements tracking lives inside the Product Charter document itself
(`docs/raw_documents/AI DIffusion Cube - Product Charter.docx`) — a Requirements tab (the
prioritized backlog surfaced in `business/business-overview.md`'s Roadmap section) and a Feedback
tab (issues/feature requests, triaged in a weekly cross-team review), not an external ticket
tracker. There is no Jira/Linear-style backlog system in this repo to reconcile against — don't
assume one exists. The `docs/tasks/<feature-slug>/` output this skill produces is an
implementation-ready engineering breakdown that sits alongside that charter-based tracking, not a
replacement or a duplicate entry in some other backlog; if a requirement traces back to an item in
the charter's Requirements tab (per the Stage 1 roadmap check above), say so in `requirement.md`
so the two stay linked conceptually, without trying to mirror the charter's own tab structure.

---

## Behavioral Rules

- **Never skip the two STOP points.** Clarifying questions and plan both require explicit human
  response before continuing — this is entire point of workflow.
- **Ground everything in actual repo context, not assumption.** If existing docs contradict
  requirement, surface conflict as clarifying question, don't silently resolve it. If a
  planning doc and actual code disagree, code (or code-verified wiki) wins.
- **No silent scope creep.** If you notice adjacent work that seems necessary, raise it in
  plan's Risks/Open Items — don't fold it into scope without user agreeing.
- **Don't fabricate affected files.** Every "Affected Areas" row should trace to something you
  actually found via repo context or repo scan.
- **Every plan must show real architectural reasoning, not just component list.** At minimum:
  one alternative genuinely considered (with why it was rejected), explicit tradeoff for each
  non-trivial decision, and non-functional-impact check that isn't silently skipped. Plan that
  jumps straight from requirement to "here's what we'll build," with no alternative weighed and
  no cost named, isn't done — regardless of how small feature looks. Small features can still
  cross boundary, set precedent for next ten features, or quietly introduce coupling that's
  expensive to undo later.
- **Test plans must include negative and edge cases, always** — task list without them is
  incomplete.
- **Respect this repo's actual conventions, not generic best practice** — surfaced at
  clarification stage, not discovered during implementation.
- **Don't recommend fixing unrelated technical debt as part of this requirement.** If
  requirement's area touches known issue, name it in Risks/Open Items so user can decide whether
  to fold in fix — don't expand scope to "also do the refactor" uninvited.

---

## Tailoring this skill to a specific codebase

> **Already tailored.** This copy was tailored against **Diffusion Cube**, branch `Swanand_DC`,
> using this repo's LLM-native wiki at `docs/wiki/diffusion-cube/` (`ai-context.md`,
> `business/business-rules.md`, `business/workflows.md`, `business/users-and-personas.md`,
> `application/api-specification.md`, `application/database.md`, `application/frontend.md`,
> `architecture/architecture-overview.md`, `architecture/testing.md`,
> `architecture/repository-conventions.md`, `knowledge/technical-debt.md`) as the primary source
> — no sibling skill/subagent in this repo (`fullstack-developer`, `code-reviewer`, `qa-tester`)
> had been tailored yet at that point, so none of their findings were reused. If the stack, the
> chat route's mode list, the migration count, or the publish-flow gating changes materially,
> re-run this procedure rather than trusting the specifics above blindly — in particular, check
> whether the wiki itself has been regenerated more recently than this tailoring pass, and prefer
> its newer content if so.
>
> **Second pass — incremental refresh, 2026-09-28**, still on branch `Swanand_DC`, prompted by the
> wiki being regenerated off two newly-added raw documents (`docs/raw_documents/Pathway
> Framework.pdf`, `docs/raw_documents/AI DIffusion Cube - Product Charter.docx`). No code changed
> and no other section of this skill was re-derived — this pass only added roadmap-awareness so the
> skill doesn't treat an already-scoped requirement as green-field: a Stage 1 check against
> `business/business-overview.md`'s "Roadmap (Planned, Not Yet Implemented)" section and
> `business/workflows.md`'s Planned Workflows (W5–W7); a note that the Product Charter's own
> Requirements/Feedback tabs are this repo's real product-tracking mechanism (not an external
> tracker this skill's output should be checked against); and a TD-16 timeline flag (the Anthropic
> API account backing this app expires 28-Oct-2026) in the plan template's Risks & Open Items. If
> the roadmap itself moves (milestones complete, backlog items reprioritized, the charter
> superseded by a different tracking artifact), re-run this refresh rather than trusting the
> specifics above blindly.

Trigger: user says something like *"Update this skill to suit the tech stack of this
codebase"* (or names this skill directly while asking for same).

When this happens:

1. **Reuse discovery work already done.** If `fullstack-developer`, `code-reviewer`, or
   `qa-tester` in this repo have already been tailored, read them first — their stack findings
   (routing convention, data layer, auth mechanism, test setup, docs location) apply here too.
2. **Otherwise discover it directly**: prefer `docs/wiki/diffusion-cube/` (start with
   `ai-context.md`) over a from-scratch repo scan if the wiki still looks current; fall back to
   the same checks as `fullstack-developer`'s Phase 0 (routing/data/auth/test/docs setup) only if
   the wiki is missing or looks stale.
3. **Rewrite Stage 1's context-gathering list and Stage 2/3/4's placeholder references**
   (routing location, data-layer/migration mechanism, config/definitions location, UI location,
   test framework, docs-output convention) with this repo's actual names and paths — mirroring
   specificity of well-grounded, repo-specific version of this skill. Don't invent conventions
   you didn't confirm.
4. **Update frontmatter `description`** to name actual stack, keeping trigger phrasing generic
   enough to still match BRD/task-list requests.
5. **Keep this "Tailoring" section itself**, so skill can be re-tailored later if stack changes.
