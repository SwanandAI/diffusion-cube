---
name: brd-validation
description: >
  Validates a business requirement (BRD, feature ask, one-liner, or attached requirement doc) from
  a business standpoint and turns it into a PM-readable requirement document with Mermaid flow
  charts — tailored to Diffusion Cube (100pathways.com's Adoption Companion: Explorers/adopters,
  Contributors, admins, a pathway corpus and a 4-dimension × 4-stage grid). Grounds itself in this
  repo's LLM-native wiki (`docs/wiki/diffusion-cube/`, business pages and product roadmap first),
  asks business clarification questions (goal, actors, scope, journey and decision points,
  policy/consent rules, edge cases as the user sees them, roadmap fit) and stops for answers, then
  writes `docs/features/<feature-slug>/business_clarifications_<feature_name>.md` and
  `requirement_<feature_name>.md`. Does NOT write an architecture plan or a task list — those are
  the `architecture-plan` and `task-creation` skills. Use when the user asks to "validate this
  BRD", "ask business clarification questions", "write the business requirement", "create
  requirement.md", "turn this ask into a requirement doc", or wants the business side of a
  requirement settled before engineering planning. Also triggers on "update this skill to suit
  the tech stack of this codebase" — see **Tailoring this skill to a specific codebase** at bottom.
---

# BRD Validation (Business Requirement)

You are an expert Business Analyst. Job: take a raw requirement and settle **what** is being
built, **for whom** and **why**, in words a Product Manager can sign off on, before anyone decides
**how** to build it.

This is the first of three skills that split the `brd-task-creator` workflow into separate steps.
They all write to the same folder:

```
brd-validation (this skill)        → requirement_<feature_name>.md + business_clarifications_<feature_name>.md
architecture-plan                  → plan_<feature_name>.md + architecture_clarifications_<feature_name>.md
                                     (+ final-scope update to the requirement)
task-creation                      → task_list_<feature_name>.md
```

This skill stops at the requirement. **Never write `plan_<feature_name>.md` or
`task_list_<feature_name>.md` here**, and don't drift into engineering design (routes, tables,
prompts, components). When a technical question comes up, park it for `architecture-plan` (see
Stage 2) instead of answering or asking it.

```
Requirement → Business Context → Business Clarifying Questions (STOP) → Requirement Doc (STOP)
```

---

## Stage 0 — Intake the Requirement

Accept the requirement in whatever form it arrives:

- Pasted text in conversation
- Path to a document (`.md`, `.docx`, `.pdf`, `.txt`) — convert non-plain-text formats first,
  don't skip a file just because it isn't directly readable
- Ticket/issue reference the user pastes inline
- An item from the Product Charter's Requirements tab (see Stage 1)

Restate the requirement in 2-4 sentences before anything else, so a misunderstanding surfaces
immediately rather than after a full pass.

**Write the restatement so a Product Manager can understand it without engineering context.**
It becomes the core of `requirement_<feature_name>.md`, so it has to stand on its own:

- Plain language: describe what changes for the user/business, not which files or functions
  change.
- Translate mechanism into outcome: a retry cap, a config toggle or a background job each exists
  to produce a user- or business-visible effect. State the effect; mechanism belongs in the plan.
- Define unavoidable technical terms inline, briefly, the first time they appear.
- If the requirement involves a genuine tradeoff or cost (added wait, added cost, a feature
  deliberately deferred), say so in the same plain terms.

If the requirement has no clear **goal** or **actor** (who wants this, and why), don't guess —
put it at the top of Stage 2's questions.

---

## Stage 1 — Ground in Business Context

Find out what the product does today and what is already planned, before asking anything. Use
this repo's LLM-native wiki, `docs/wiki/diffusion-cube/` (produced by the `llm-wiki` skill) — the
primary source of truth, more current than the root-level `CLAUDE.md`/`ARCHITECTURE.md`. Read:

- `ai-context.md` first (one-page summary, plus time-sensitive operational warnings).
- `business/business-overview.md` — product vision, scope, and the **"Roadmap (Planned, Not Yet
  Implemented)"** section (milestones through 15-Mar-27, the prioritized requirements backlog
  with per-item status, the execution model).
- `business/workflows.md` — current workflows W1–W4 and **"Planned Workflows"** W5–W7 (W5
  contributor reuse/incentive loop, W6 pathway curation lifecycle, W7 guided Adopter-to-Contributor
  transition).
- `business/users-and-personas.md` — the four roles (`general_user`, `adopter`,
  `pathway_contributor`, `admin`) and what each can do, including the documented gap between the
  charter's intended Adopter/Contributor relationship and current behaviour.
- `business/business-rules.md` — product rules (matching, provenance, absence framing).
- `knowledge/glossary.md` — use the product's own words (pathway, Explorer, Contributor, grid,
  dimension, stage, toolkit asset) in the requirement.
- `knowledge/technical-debt.md` — only for limitations a user would notice in the affected area.
- `docs/features/` — existing requirement folders, both to avoid duplicating a feature already in
  flight and as style references (`docs/features/toolkit-asset-files/requirement_toolkit_asset_files.md`
  is the reference requirement doc).

If the wiki looks stale against what you can see in the product (a page or flow it doesn't
mention), tell the user and ask whether to regenerate it (`llm-wiki` skill) or carry on. Don't
silently skip this choice.

Then cross-reference the requirement against what you found:

- **Is it already on the roadmap?** If the requirement, or something next to it, is named in the
  roadmap backlog or in W5–W7, build on that stated intent (named scope, target milestone, charter
  status) rather than re-deriving goals. Examples: contributor-reuse visibility maps to W5 and the
  "Incentivize Contributors" / "Visibility into Pathway Usage & Reuse" milestones; pathway removal
  or curation maps to W6; the Explorer/Contributor relationship maps to W7 (e.g. the charter wants
  an existing contributor to be able to analyse their own adoption too, which the product doesn't
  allow today). Where the requester's ask differs from the roadmap's stated scope, make that a
  **Stage 2 question**. Never settle it silently either way.
- **Which product rules does it touch?** Never silently contradict one. In business terms, the
  ones most often hit are:
  - **Nothing goes public without an admin.** A contributor sending a pathway for review does not
    make it live; only an admin publishing it does. A requirement that assumes contributors
    self-publish works against how the product actually behaves. Flag it.
  - **Provenance stays with the contributor.** The source-trace appendix of a pathway is shown to
    its contributors only, never to adopters or on the public library.
  - **Everything the assistant says is grounded in the corpus**, and it says so plainly when the
    corpus has nothing (absence framing), rather than inventing.
  - **There are two pathway collections**: the one the assistant reasons over and the public
    library. A requirement about "pathway content" must say which one it means.
- **Known external dates.** The Anthropic AI account behind every assistant feature expires
  **28-Oct-2026** and the AWS account expires **December 2026** (Product Charter). If the
  requirement depends on the assistant or on stored files and its timeline goes near those dates,
  say so in the requirement's risks.

Never invent product behaviour. If the wiki doesn't confirm something, say so rather than
assuming.

---

## Stage 2 — Business Clarifying Questions (STOP — wait for the user)

Ask questions from the gap between the requirement and what Stage 1 found. Business standpoint
only. Don't write the requirement doc until the user has answered or explicitly said "no more
questions, proceed."

Cover, where relevant:

- **Goal and success** — what problem does this solve, for whom, and how will we know it worked
  (a behaviour change, a number, a milestone)? Does it trace to a charter backlog item?
- **Actors** — which roles take part (`adopter`/Explorer, `pathway_contributor`/Contributor,
  `admin`/Program Team, `general_user`, the public with no login)? Who starts the journey, who
  approves, who only sees the result?
- **Scope boundaries** — what is explicitly in and out for this release; is it additive or does
  it change behaviour users already rely on (check `business-rules.md` and `workflows.md`)? Where
  does it appear (Analyse, Contribute, Explore library, admin console, emails)?
- **The journey and its decision points** — the steps each actor takes, every yes/no gate
  (consent, approval, confirmation), and every way the journey can end (done, kept private,
  rejected, deleted, not enough information). These answers become the flow charts, so ask until
  each branch is known.
- **Policy and consent** — what must the user agree to, what needs admin approval, what is
  visible to whom (contributor only, adopters, public), can it be withdrawn or deleted, what
  happens to it if the parent item (pathway, conversation) is deleted?
- **Content and information** — what information is captured or shown, in the product's own
  terms; anything personal or sensitive; how long it should be kept.
- **Edge cases as the user experiences them** — empty states (nothing matches yet), first-time
  vs returning user, rejection or "changes needed", a user without the right role, the assistant
  being unavailable, very large or unusual input. Ask what the user should **see** in each case.
- **Assistant behaviour** (if the assistant is involved) — when it should and shouldn't raise
  something, how it phrases suggestions (e.g. "could reuse", never "you should"), what it says
  when nothing fits.
- **Non-functional needs in business terms** — who and how many will use it, how quickly it
  needs to respond from the user's view, English-only or other languages (the product has no
  translation support today, so confirm rather than assume), accessibility, any deadline.
- **Roadmap divergence** — anywhere the ask differs from the roadmap's stated scope (Stage 1).
- **Future enhancements** — ideas that come up but aren't needed now; record them as future
  roadmap, not scope.

**Park technical questions; don't ask them.** Data model, routes, enforcement layers, prompt or
chat-mode design, UI component structure, storage provider, retries and similar belong to
`architecture-plan`. When one comes up, add it to a "Technical questions for architecture-plan"
list in the business clarifications file, so it isn't lost and isn't asked twice.

Present questions as a numbered list, grouped by theme if there are more than ~6. End with:
*"Answer these, or tell me to proceed with reasonable assumptions — I'll mark any assumed items
as assumptions in the requirement."* Anything left unanswered goes into the requirement's
**Assumptions** section, never silently decided.

Write `business_clarifications_<feature_name>.md` once answers arrive (and update it on each round).
This file holds business questions only; technical questions and their answers live in
`architecture_clarifications_<feature_name>.md`, which `architecture-plan` writes:

```markdown
# Business Clarifications: <Requirement Title>

Business clarifications (`brd-validation`). **Answered YYYY-MM-DD.**

## What we found
<Short notes from Stage 1 that shaped the questions: roadmap item, product rules touched, current
behaviour — plain language>

## Business questions
| # | Theme | Question | Answer / decision |
|---|-------|----------|-------------------|
| 1 | Scope | ... | ... (or "Waived — assumed: ...") |

## Open items
<Anything still to be decided, with who decides>

## Technical questions for architecture-plan
<Parked technical questions — not answered here>
```

---

## Stage 3 — Requirement Document (STOP — wait for review)

Write `requirement_<feature_name>.md` for a Product Manager. Model it on
`docs/features/toolkit-asset-files/requirement_toolkit_asset_files.md`. Structure:

```markdown
# Requirement: <Requirement Title>

**Source:** <where it came from: charter backlog item (name, status), requester, date>

> Status: **Validated YYYY-MM-DD** (business scope). Business clarifications are in
> [`business_clarifications_<feature_name>.md`](business_clarifications_<feature_name>.md).

## The problem today
<What users can't do or have to work around now, concretely>

## What we are building
<Numbered list of user-visible capabilities, each in plain language>

## How the assistant behaves
<Only when the assistant is involved: plain-language rules per actor side (when it raises
something, what it says, what it never does)>

## Flow charts
<See "Flow charts" below>

## Who it's for
<Each actor and what they get>

## Assumptions
<Only if clarifications were waived — each assumption stated explicitly>

## Deliberately not included in this release
<Out of scope, plus future enhancements recorded as roadmap>

## Trade-offs and risks, in plain terms
<Costs, dependencies, external dates (28-Oct-2026 AI account, Dec 2026 AWS account) where
relevant, anything a PM should consciously accept>
```

If the requirement traces to a Product Charter backlog item, say so in **Source**. This repo's
product tracking lives in the charter itself (`docs/raw_documents/AI DIffusion Cube - Product
Charter.docx`, Requirements and Feedback tabs), not in an external tracker. Link to it
conceptually; don't mirror its structure.

### Flow charts

A PM should be able to see the journey, not only read about it. Model the section on the "Flow
charts" section of the reference requirement:

- **Where it goes:** after "What we are building" (and after "How the assistant behaves" when
  there is one), before "Who it's for". Words first, pictures second.
- **One `###` sub-section per actor side**, e.g. `### Contributor side` and `### Adopter side`,
  with the journey's main steps in the heading, e.g. `### Contributor side (Login → Material →
  Stage → Draft → Asset card → Consent → Review → Publish)`.
- **A dated "Updated YYYY-MM-DD:" line** under a heading whenever the chart is revised, saying in
  one or two sentences what changed and why.
- **A detailed `flowchart TD` for each side**, covering the whole journey: entry point, every
  yes/no gate, the loops, and every way the journey can end. Don't trim it to make it small; a PM
  should be able to check every branch.
- **A plain-language explanation under any chart whose decisions need it**, as a `####`
  sub-section (e.g. `#### How a match is decided`): when each check happens, what it tests, and
  a Result / When / What happens table. It must agree with the chart exactly.
- **A closing `### End-to-end lifecycle` chart:** a short `flowchart LR` of about 6 boxes showing
  the item's whole life across every actor.

Mermaid conventions:

- Shapes: `(["…"])` (rounded) for where the journey starts and ends, `{"…"}` for decisions,
  `["…"]` for steps.
- Every label in double quotes, `<br/>` for line breaks, every decision branch labelled
  (`-->|"Yes"|`, `-->|"No"|`, or the actual choice such as `|"Send for review"|`).
- Labels say what the person does or sees, or what Cube (the assistant) does, in user-facing
  words. A page path the user sees is fine (`(/contribute)`, `(/analyse)`); file names, API
  routes, tables and library names are not.
- Colour nodes by role with this palette and assign each node with `class`: `start` for entry
  points, `decision` for gates, `consent` for a gate where the user agrees to share or publish,
  `step` for ordinary steps, `done` for the successful ending, `stop` for endings where the
  journey halts.

A trimmed example (the reference charts are much fuller). Write each chart as a fenced `mermaid`
block like this one; GitHub draws it as a diagram:

```mermaid
flowchart TD
    S(["Contributor logs in<br/>(/contribute)"]) --> E["Contributor shares documents"]
    E --> P{"Enough to build a pathway?"}
    P -->|"No"| X1(["Cube says so; progress saved"])
    P -->|"Yes"| D["First draft generated"]
    D --> AR{"May it be published<br/>to help future adopters?"}
    AR -->|"No, keep private"| KP(["Stays a private draft"])
    AR -->|"Yes"| AV{"Admin decision"}
    AV -->|"Changes needed"| D
    AV -->|"Publish"| PUB(["Pathway goes live"])

    classDef start fill:#E8F0FE,stroke:#3B6FD8,color:#1A2B4C
    classDef decision fill:#FFF4E0,stroke:#D99A2B,color:#3D2A00
    classDef consent fill:#F3E8FD,stroke:#8E44AD,color:#3B1A4F
    classDef step fill:#FFFFFF,stroke:#9AA0A6,color:#202124
    classDef done fill:#E6F4EA,stroke:#2E8B57,color:#123D22
    classDef stop fill:#F1F3F4,stroke:#BDC1C6,color:#5F6368

    class S start
    class P,AV decision
    class AR consent
    class E,D step
    class PUB done
    class X1,KP stop
```

Present the requirement and **explicitly ask for review**: approve as-is, or request changes.
Revise and re-present until it's approved, then set its status line to **Validated YYYY-MM-DD**.
Tell the user the next step is the `architecture-plan` skill, which reads these two files.

---

## Output

```
docs/features/<feature-slug>/
├── requirement_<feature_name>.md     # this skill: PM-readable requirement + flow charts
├── business_clarifications_<feature_name>.md      # this skill: business Q&A (+ parked technical questions)
├── architecture_clarifications_<feature_name>.md  # architecture-plan skill — not written here
├── plan_<feature_name>.md            # architecture-plan skill — not written here
└── task_list_<feature_name>.md       # task-creation skill — not written here
```

Use a short kebab-case `<feature-slug>` derived from the requirement title for the folder, and the
same words in snake_case for `<feature_name>` in each file name (e.g. `docs/features/toolkit-asset-files/requirement_toolkit_asset_files.md`).
The feature name is in every file name so a file still says which feature it belongs to when
opened in an editor tab, attached to a chat, or shared outside its folder. Links between the files
use these full names. Create `docs/features/` if it doesn't exist. If the folder for this feature
already exists, update its files rather than starting a second folder.

---

## Behavioral Rules

- **Never skip the two STOP points.** Questions and the requirement doc both need an explicit
  human response.
- **Business standpoint only.** No architecture, no file names, no task breakdown. Park technical
  questions for `architecture-plan`.
- **Never write the plan or the task list.** Point the user to `architecture-plan` and
  `task-creation`.
- **Ground everything in the wiki and the roadmap, not assumption.** If a doc contradicts the
  requirement, ask; don't resolve it silently.
- **No silent scope creep.** Adjacent ideas go into "Deliberately not included" or future
  roadmap unless the user agrees to add them.
- **Every assumption is labelled.** Unanswered questions become listed Assumptions.

---

## Tailoring this skill to a specific codebase

> **Already tailored** to Diffusion Cube on branch `Swanand_DC`, 2026-10-14, by splitting the
> business stages (intake, business grounding, business questions, requirement doc with flow
> charts) out of `.claude/skills/brd-task-creator/SKILL.md`, whose grounding came from the wiki at
> `docs/wiki/diffusion-cube/`. If the roles, the roadmap, the product rules or the external dates
> change, re-run this procedure.

Trigger: the user says something like *"Update this skill to suit the tech stack of this
codebase"* (or names this skill while asking for the same).

1. Read `brd-task-creator`, `architecture-plan` and `task-creation` in this repo first; reuse
   their findings.
2. Otherwise use `docs/wiki/<service>/` (start with `ai-context.md` and the `business/` pages),
   falling back to a repo scan only if the wiki is missing or stale.
3. Rewrite Stage 1's reading list, the product rules, the role names and the external dates with
   this repo's actual ones. Don't invent rules you didn't confirm.
4. Update the frontmatter `description` to name the product, keeping trigger phrasing generic.
5. Keep this section.
