---
name: task-creation
description: >
  Turns an approved architecture plan into an implementation-ready task list of User Stories with
  Acceptance Criteria and a Test Plan covering positive, edge, and negative cases — tailored to
  Diffusion Cube (Next.js 16 App Router / React 19 / TypeScript, Supabase Postgres + pgvector,
  Auth, RLS, Storage and the `embed` Edge Function with no ORM, a single 7-mode Anthropic
  `/api/chat` route with retrieval grounding, and a Vitest suite under `tests/` with every external
  client mocked and no CI gate — so test cases name concrete Vitest tests in the existing layout,
  plus labelled manual checks for real Supabase/RLS, model behaviour and the `embed` function).
  Reads `docs/features/<feature-slug>/plan_<feature_name>.md`
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
`docs/wiki/diffusion-cube/`: `business/workflows.md` (workflow IDs — W1–W7 implemented, W8–W10
planned), `business/users-and-personas.md` (role names — `adopter`, `pathway_contributor`,
`admin`, plus the anonymous visitor; `general_user` no longer exists), `knowledge/glossary.md`,
`architecture/testing.md` (Vitest layout, what's mocked, what the suite doesn't cover, the latest
run), `architecture/coding-patterns.md#tests-mock-every-external-client` (the `tests/helpers/`
mocking style to follow), and whichever `application/` page matches the plan's Affected Areas.
Before naming a test file in a story, check whether it already exists under `tests/` — extend it
rather than adding a parallel one.

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
  "Given the model's `<grid_update>` includes `pathwayAction`, when the client processes it,
  then the client — not the model — triggers the follow-up call, and nothing reaches
  `pathway_versions` until the contributor clicks Send for Review" or "Given a caller without the
  `pathway_contributor` role, when they POST to the new endpoint, then the API route itself
  returns 403 regardless of what any page-level check already did">

**Test Plan:**
> This repo has a **Vitest 3 suite** (`npm test` = `vitest run`; `vitest.config.mts`; 105 test
> files under `tests/`; Testing Library + jsdom for components). Every external client is mocked
> (`tests/setup.ts` fake env vars, `tests/helpers/supabase-mock.ts`, `tests/helpers/anthropic-mock.ts`),
> so no test reaches the real Supabase project, Anthropic, the `embed` Edge Function or SMTP. It is
> **not run in CI** (`.github/workflows/deploy.yml` only deploys), so "Vitest" means a test added
> to `tests/` and run locally (`npm install` first, for dev dependencies) before the PR — don't
> phrase a case as if a CI gate will catch it. Label each case:
> - **Vitest:** name the file to add or extend in the existing layout — `tests/unit/lib/<module>.test.ts`
>   (pure modules), `tests/unit/server/<module>.test.ts` (server modules, mocked I/O),
>   `tests/api/<area>/<route>.test.ts`, e.g. `tests/api/admin/pathways-publish.test.ts` (call the
>   exported `POST`/`GET` with a built `Request`;
>   `tests/helpers/request.ts`, `routes-auth.ts`), `tests/client/` (the conversation hook),
>   `tests/features/<feature>/<Component>.test.tsx` (first line `// @vitest-environment jsdom`),
>   `tests/pages/`, `tests/proxy/proxy.test.ts`, `tests/db/migrations.test.ts` (migration *text*
>   only — no database runs).
> - **Manual:** what the mocked suite cannot prove — real Supabase behaviour (RLS policies, the
>   `published_pathways` view, `match_pathway_units`/`match_source_chunks` SQL, a migration applying
>   cleanly), real model output and prompt quality, the deployed `embed` function, browser-level
>   end-to-end flows (no Playwright/Cypress), real email. State the concrete action and observable
>   result against the dev app or dev Supabase project.
> - **Manual, paid:** a manual case that calls the real Anthropic API or the deployed `embed`
>   function (costs money / mutates real state) — run on dev only. (`docs/features/pathway-storage/task_list_pathway_storage.md`
>   is the reference for this labelling.)
- *Positive:*
  - ... (e.g. "**Vitest:** `tests/api/chat.test.ts` — a `companion` request with `flow:
    'contributor'` from a `pathway_contributor` streams and records `ai_usage`" or "**Manual:**
    sign in as an `adopter`, submit X, confirm Y appears in `designs.grid_state`" — not just "happy
    path works")
- *Edge cases:*
  - ... (empty input; no published pathways; large document upload through the client-side
    extraction pipeline (`pdfjs-dist`/`mammoth`/`xlsx`/`jszip`); double-submit of a companion chat
    message during the lazy `designs` row creation, which `lib/adoption-conversation.ts` already
    dedups via `creatingRef` — confirm this new behavior doesn't bypass that (`tests/client/`);
    classifier or embedding failure → the defined degradation (`tests/unit/server/retrieval.test.ts`,
    `embeddings.test.ts`))
- *Negative cases:*
  - ... (invalid input → 400; unauthenticated access — confirm the **API route** itself rejects it,
    not just the page; wrong-role access, e.g. an `adopter` hitting a `pathway_contributor`-gated
    route → 403; rate limit → 429; oversized body → 413; an Anthropic failure before the stream
    (500 with the generic message, recorded in `sys_errors`) and mid-stream (`streamFailed()`,
    `ai_usage ok:false`) — `tests/helpers/anthropic-mock.ts` has a mid-stream failure option; a
    Supabase write failure)
- *Non-functional (if applicable):*
  - Responsive layout check against the Tailwind v4 / `app/globals.css` brand tokens this repo
    actually uses (Manual)
  - Migration correctness: **Vitest** — extend `tests/db/migrations.test.ts` for the new
    migration (numbering, RLS on new tables, server-only functions); **Manual** — does
    `supabase/migrations/00NN_<description>.sql` apply cleanly on the dev project on top of the
    current 42, and is any destructive step called out in its header (only `0008`, `0018`,
    `0039`, `0042` are destructive so far)?
  - Invariant correctness: any grid-state/document write happens through the client parsing
    `<grid_update>`, never a direct model-to-DB write; a pathway-publish story confirms Send for
    Review alone does **not** make content visible at `/explore`, `/wiki` or in Analyse grounding
    until the separate admin publish step runs; adopter-facing output never contains the Source
    Trace appendix
  - Run `npm test` before and after the change and compare to the baseline — at the 2026-11-06
    wiki refresh one stale failure was known (`tests/features/admin/AdminPathwaysPanel.test.tsx`,
    old delete-dialog wording); don't count a pre-existing failure against this story
```

Rules for this stage:

1. **Trace every AC back to something** — original requirement, clarification answer, existing
   business rule from repo context, or decision recorded in plan's Architectural
   Approach/Key Tradeoffs (e.g. chosen failure-handling behavior becomes AC, not just prose in
   plan). Don't invent behavior not discussed.
2. **Every story needs at least one negative and one edge test case** — story with only
   happy-path tests isn't done.
3. **Reuse domain vocabulary from repo context** (entity names like `designs`/`pathways`/
   `pathway_versions`/`pathway_units`/`published_pathways`, role names like `adopter`/
   `pathway_contributor`/`admin`, workflow IDs W1–W7 (implemented) and W8–W10 (planned) from
   `business/workflows.md`, terms from `knowledge/glossary.md`) rather than renaming concepts.
4. **Flag UI-decision stories** (shared `AppShell` vs. standalone page, hook-based interaction
   pattern) with the answer recorded in `architecture_clarifications_<feature_name>.md` stated directly in the story, not left implicit.
5. **Keep stories vertically sliced** where possible (touches route + its UI for one
   user-visible behavior) rather than slicing by layer, unless plan's sequencing explicitly
   calls for layer-by-layer delivery (e.g. a migration must land before the route that reads it).
6. **State test executability concretely, not aspirationally** — label every case **Vitest**
   (with the concrete test file in the existing `tests/` layout, using the `tests/helpers/` mocks
   rather than a new mocking style) or **Manual** (concrete action + concrete expected
   observation). Prefer Vitest for anything the app's own logic decides (validation, role checks,
   prompt text shape, parsing, store calls); use Manual only for what mocks can't prove (real
   RLS/SQL/view behaviour, model output quality, the deployed `embed` function, end-to-end browser
   flows). The suite runs locally only — never describe a case as though CI will catch it (no CI
   test job exists, TD-03). Live checks that cost real money or mutate real state (an actual
   Anthropic call, the deployed `embed` function, an actual SMTP send via
   `scripts/smtp-test.mjs`, a real seed run — `npm run seed:pathways -- --dry-run` is the safe
   pre-check) must be labelled **Manual, paid** or called out as mutating, never silently assumed
   to run automatically.
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
- **Test plans include negative and edge cases, always**, each labelled **Vitest** (with a
  concrete file in the existing `tests/` layout) or **Manual** / **Manual, paid** for what the
  mocked suite can't prove. Never imply CI will run them — it doesn't (TD-03).
- **Reuse the repo's vocabulary**; don't rename concepts.
- **Don't add unrelated technical-debt fixes as stories.** Leave them in the plan's Risks & Open
  Items.

---

## Tailoring this skill to a specific codebase

> **Already tailored** to Diffusion Cube on branch `Swanand_DC`, 2026-10-14, by splitting the
> task-list stage out of `.claude/skills/brd-task-creator/SKILL.md`, whose grounding came from the
> wiki at `docs/wiki/diffusion-cube/`. If the test setup changes (e.g. a test runner or CI test job
> is added), the role names, or the migration count, re-run this procedure.
>
> **Stack refresh, 2026-11-06** (HEAD `0a1ca00`), against the wiki fully refreshed that day
> (`ai-context.md`, `architecture/testing.md`, `architecture/coding-patterns.md`,
> `architecture/repository-conventions.md`, `business/workflows.md`,
> `business/users-and-personas.md`, `knowledge/technical-debt.md`) and spot-checked in code
> (`package.json` scripts, `vitest.config.mts`, 105 files under `tests/`, `tests/helpers/`). The
> "no automated test suite / manual verification only" framing was replaced: test plans now name
> Vitest files in the existing layout (`unit/lib`, `unit/server`, `api`, `client`, `features`,
> `pages`, `proxy`, `db`) using the shared mocks, with **Manual** / **Manual, paid** labels for
> real Supabase/RLS/SQL, model output, the deployed `embed` function and end-to-end flows, and a
> note that CI doesn't run the suite. Also updated: 42 migrations, workflow IDs W1–W10, role
> names after `0039`, the two-step publish invariant (Send for Review → `pathway_versions`, admin
> Publish → live), and the story template's examples. Kept identical to `brd-task-creator`'s
> Stage 4.

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
