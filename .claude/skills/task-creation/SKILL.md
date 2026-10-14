---
name: task-creation
description: >
  Turns an approved architecture plan into an implementation-ready task list of User Stories with
  Acceptance Criteria and a Test Plan covering positive, edge, and negative cases — tailored to
  Diffusion Cube (Next.js 16 App Router / React 19 / TypeScript, Supabase Postgres+Auth with no
  ORM, a single Anthropic `/api/chat` route, and no automated test suite today, so test cases are
  framed as concrete manual verification steps). Reads `docs/features/<feature-slug>/plan_<feature_name>.md`
  (written by `architecture-plan`) together with `requirement_<feature_name>.md`,
  `business_clarifications_<feature_name>.md` and `architecture_clarifications_<feature_name>.md`, and writes `task_list_<feature_name>.md` in the same folder.
  Does NOT ask business or architecture questions or change the plan — those are `brd-validation`
  and `architecture-plan`. Use when the user asks to "create the task list", "break the plan into
  stories", "generate user stories and acceptance criteria", "write task-list.md", or has an
  approved plan and wants the backlog. Also triggers on "update this skill to suit the tech stack
  of this codebase" — see **Tailoring this skill to a specific codebase** at bottom.
---

# Task Creation

You are an expert Business Analyst and Tech Lead. Job: decompose an approved plan into stories an
engineering team can pick up directly — each traceable to the requirement, the clarifications or
the plan, and each with a test plan that includes negative and edge cases.

This is the third of three skills that split the `brd-task-creator` workflow into separate steps.
They all write to the same folder:

```
brd-validation                     → requirement_<feature_name>.md + business_clarifications_<feature_name>.md
architecture-plan                  → plan_<feature_name>.md + architecture_clarifications_<feature_name>.md
                                     (+ final-scope update to the requirement)
task-creation (this skill)         → task_list_<feature_name>.md
```

```
Approved Plan + Requirement + Clarifications → Task List (STOP for review)
```

---

## Stage 0 — Load the Inputs

1. Find the feature folder `docs/features/<feature-slug>/` and read `plan_<feature_name>.md`,
   `requirement_<feature_name>.md`, `business_clarifications_<feature_name>.md` and
   `architecture_clarifications_<feature_name>.md` in full. A folder from before the split may
   have one combined `clarifications_<feature_name>.md` instead; read that.
2. **The plan must exist and be approved** (its status line says "Approved"). If there is no plan,
   or it isn't approved, stop and recommend `architecture-plan`. Don't build stories from a
   requirement alone: the stories would have to invent the architecture.
3. If `task_list_<feature_name>.md` already exists, read it and ask whether to revise it (e.g.
   after the plan changed) or replace it. When revising, keep existing story IDs stable and say
   what changed in its status line.
4. If you notice a gap or conflict between the plan and the requirement while decomposing, don't
   resolve it in the task list. Raise it with the user; changes to scope or design go back
   through `brd-validation` or `architecture-plan`.

For repo vocabulary and test realities, read only what the stories need from
`docs/wiki/diffusion-cube/`: `business/workflows.md` (workflow IDs), `business/users-and-personas.md`
(role names), `architecture/testing.md` (current test state), and whichever `application/` page
matches the plan's Affected Areas.

---

## Stage 1 — Task List (User Stories, Acceptance Criteria, Test Plan)

Decompose the approved plan into a task list. Break plan's "Affected Areas" and
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
   pattern) with the answer recorded in `architecture_clarifications_<feature_name>.md` stated directly in the story, not left implicit.
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
7. **Show the build order.** Start the file with a short dependency diagram of the story IDs,
   following the plan's Sequencing. A fenced ASCII block like the one in
   `docs/features/toolkit-asset-files/task_list_toolkit_asset_files.md` works; a fenced `mermaid`
   `flowchart LR` also works and renders on GitHub.
8. **Use a story-ID prefix from the feature name** (e.g. `TA-01` for toolkit assets) and keep IDs
   stable across revisions.

File structure:

```markdown
# Task List: <Requirement Title>

> Status: **Draft YYYY-MM-DD** (task-creation), derived from the approved
> [`plan_<feature_name>.md`](plan_<feature_name>.md). Requirement:
> [`requirement_<feature_name>.md`](requirement_<feature_name>.md).

## Build order
<dependency diagram of story IDs>

## Stories
<one section per story, in the structure above>

## Not covered by these stories
<anything in the plan's Risks & Open Items that is deliberately left out, so nobody assumes a
story covers it>
```

Present the task list and ask for review. Revise until approved, then set its status to
**Approved YYYY-MM-DD**.

---

## Output

```
docs/features/<feature-slug>/
├── requirement_<feature_name>.md     # brd-validation (+ architecture-plan's final-scope update)
├── business_clarifications_<feature_name>.md      # brd-validation
├── architecture_clarifications_<feature_name>.md  # architecture-plan
├── plan_<feature_name>.md            # architecture-plan
└── task_list_<feature_name>.md       # this skill
```

The folder uses a short kebab-case `<feature-slug>`; files use the same words in snake_case as
`<feature_name>` (e.g. `docs/features/toolkit-asset-files/task_list_toolkit_asset_files.md`). Links
between the files use these full names. Write into the existing feature folder; never start a
second folder for the same feature.

---

## Behavioral Rules

- **Only from an approved plan.** No plan, or not approved → `architecture-plan` first.
- **Don't change scope or design.** The task list decomposes the plan; conflicts go back to the
  user and the earlier skills.
- **Every AC traces to something** in the requirement, clarifications, plan, or an existing
  business rule.
- **Test plans include negative and edge cases, always**, written as concrete manual steps since
  this repo has no automated test suite.
- **Reuse the repo's vocabulary**; don't rename concepts.
- **Don't add unrelated technical-debt fixes as stories.** Leave them in the plan's Risks & Open
  Items.

---

## Tailoring this skill to a specific codebase

> **Already tailored** to Diffusion Cube on branch `Swanand_DC`, 2026-10-14, by splitting the
> task-list stage out of `.claude/skills/brd-task-creator/SKILL.md`, whose grounding came from the
> wiki at `docs/wiki/diffusion-cube/`. If the test setup changes (e.g. a test runner or CI test job
> is added), the role names, or the migration count, re-run this procedure.

Trigger: the user says something like *"Update this skill to suit the tech stack of this
codebase"* (or names this skill while asking for the same).

1. Read `brd-task-creator`, `architecture-plan`, `qa-tester` and `fullstack-developer` in this
   repo first; reuse their findings (especially the test setup).
2. Otherwise use `docs/wiki/<service>/` (start with `ai-context.md` and
   `architecture/testing.md`), falling back to a repo scan only if the wiki is missing or stale.
3. Rewrite the story template's examples, the Test Plan note and rule 6 with this repo's actual
   test reality and vocabulary. Don't invent a test framework that doesn't exist.
4. Update the frontmatter `description`, keeping trigger phrasing generic.
5. Keep this section.
