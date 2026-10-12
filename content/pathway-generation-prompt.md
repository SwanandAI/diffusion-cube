# Prompt: Generate a Pathway Document from the Pathway Framework + Raw Pathway Material

> Contributor-side prompt — used (with `content/framework.md` attached) to turn raw
> pathway source material into a structured pathway document for the corpus. Not
> used by the app at runtime; kept here so pathway generation and the app's
> adopter-facing framework stay versioned together.

Inputs you will attach when using this prompt:

1. The Pathway Framework (defines the four dimensions, cross-cutting concerns, four stages, five unit types, the question bank's insight forms for each dimension×stage cell, and the pathway document's output structure — Sections 0–6 plus the unnumbered Source Trace appendix row).
2. One or more raw pathway source files — narrative writeups, interview transcripts, follow-up notes, or existing pathway pages — for the deployment(s) this pathway covers.

## Your task

Begin every pathway document with a YAML frontmatter block, before Section 0:

```
---
title: <pathway title — same as Section 0's pathway name>
description: <one sentence: what this pathway enabled and for whom>
stage: <Explore | Define | Pilot | Scale — the deployment's current stage>
sector: <primary sector (e.g. Health, Education, Agriculture)>
location: <city and country of the primary deployment>
tags: [Tag1, Tag2]
---
```

`tags` should be two to four short labels (e.g. [Community Health, Rural, Voice AI]) that describe the pathway's use-case focus — not the sector, which has its own field. Fill every field from the source material; write "Unknown" only where the source genuinely does not state it.

Read the Framework first to internalize its structure — dimensions, cross-cutting concerns, stages, unit types, insight forms, and the output structure. Use it as your classification standard and your section-by-section blueprint. Do not restate or re-derive that structure here — read it fresh from the attached Framework document every time you generate a pathway, so that any future update to the Framework is picked up automatically without this prompt needing to change.

Then read all raw pathway material closely. Produce a single clean pathway markdown document, following the Framework's structure exactly as its output table lays it out:

- Sections 0–6 — adopter-facing. This is what the AI layer reads and surfaces in any adopter-facing response.
- Source Trace appendix — the table's unnumbered final row, contributor-facing only, never surfaced in adopter-facing output. It is not "Section 7" and must not be numbered as a continuation of 0–6.

The word "Framework" (or any reference to it, or to this prompt, as a process) must never appear in Sections 0–6.

## Generation-specific rules

These rules govern how to write each section correctly. They assume you already have the Framework's Section 0–6 definitions and the Source Trace appendix row in front of you — they don't repeat what each section is for, only the execution details an LLM needs that aren't naturally expressed as a structural definition.

### Section 1 — Pathway identity

Populate every field the Framework's identity table defines, including the impact/cost/effort/reuse fields (scale achieved, cost anchor, build effort, known downstream adopters, scope/does-not-transfer-when). Tag each of these with an as-of date where the source material gives one. Where the source doesn't support a field, write "Not documented in the source" rather than leaving it blank or inventing a plausible number.

### Section 2 — Coverage grid and gaps

Density counts (●●● / ●● / ● / ○) are driven only by each unit's Stage (origin) — never by its "Also relevant at" tag (see below). This keeps gap-detection honest: a unit tagged useful at three stages still counts once, in the cell where its evidence actually originated.

Apply the four gap-survival tests before including any gap (concreteness, non-fabrication, boundary-restatement, existing-coverage), and default toward dropping over reframing. Ground every surviving gap in this pathway's own vocabulary and cite the specific unit number(s) it relates to. List at most 8 gaps; prioritise by importance at the deployment's current stage.

### Section 3 — Micro-innovations

Include at most 8 micro-innovations total across all unit types — choose those most transferable to other adoptions. Keep each main content field (Decision, Failure/Fix, Playbook steps, Asset description) to 3–4 sentences; keep Why and Condition to 2–3 sentences.

Organize by dimension (use the Framework's dimension names as subheadings), and within each dimension, order units by Stage (Explore → Define → Pilot → Scale).

Each unit:

- Plain sequential number across the whole document (1, 2, 3...) — never a composite ID code.
- Bold title line: `**N. Short decision-oriented title**`
- A bulleted tag block immediately below the title:
  - `Dimension: ...`
  - `Stage: ...` — where the evidence was discovered. This is what the Section 2 grid counts.
  - `Also relevant at: ...` — optional. Other stages where this unit is genuinely useful to a new adopter, even though the evidence originated elsewhere. Never counted in the Section 2 grid — it exists only to drive Section 6 retrieval and adopter-facing navigation. Omit entirely for genuinely single-stage units.
  - `Type: ...` (Strategic Decision / Tactical Decision / Failure and Fix / Playbook / Toolkit Asset)
- Then bulleted content fields, matched to the type:
  - Strategic/Tactical Decision: Decision, Alternative considered, Why — the reasoning connecting the alternative to the choice made. Without it, a Decision is just an assertion. What this looked like here (while Decision might be generic, this provides context on how it is implemented in this specific pathway). Condition — applies when (if stated), Before → After (if absent don't add this field).
  - Failure and Fix: Failure, Fix, Insight, Condition — applies when.
  - Playbook: Playbook (the actual sequence, stated as steps), Note (if there's a common failure mode of skipping steps), Condition — applies when, Before → After (if available).
  - Toolkit Asset: Toolkit asset (what it actually is), Purpose (what the asset is actually for), Reusable as-is (what makes it liftable), Condition — applies when.

### Section 4 — Toolkits and playbooks

Table (`| # | Title | Type | Reuse condition |`) listing only units whose Type is Toolkit Asset or Playbook, cross-referenced by unit number, with a one-line reuse condition each. Never list a Strategic Decision, Tactical Decision, or Failure and Fix unit here, even when it sounds reusable. If no unit qualifies, write "No reusable resources documented." instead of a table — never fill the table to reach a number. Section 4 is what the contributor is later asked to share files for, so list only genuine artifacts; write titles as plain text (no links).

### Section 5 — Problem→solution patterns

Omit this section. Failure-and-Fix units in Section 3 cover this material in full; do not generate a Section 5.

### Section 6 — Retrieval guide

Flat list of realistic questions a future adopter might type, each mapped to the relevant unit number(s): *"question in their words"* → Unit N, Unit M. Use both a unit's Stage and its "Also relevant at" tags when deciding which questions a unit should answer. Cover the range of dimensions, not just the most obvious ones.

### Source Trace appendix (the Framework table's unnumbered final row)

Place this after Section 6, visually and structurally separated from it (e.g. a clear divider and a heading that does not read as "Section 7"). The AI layer must never surface this appendix's content in an adopter-facing response, in any mode — the same constraint that already applies to Framework references.

A table keyed by source file, not by unit or field:

| Source file | Covers | Notes |
|---|---|---|
| [filename/doc title, as-of date] | [Section numbers, field names, and/or unit ranges populated from it] | [Primary source / confirms only, doesn't add / superseded, etc.] |

Rules:

- Key by raw source file — one row per file, not one row per content item. This must cover everything drawn from raw material: Pathway Identity fields, Section 3 units, the toolkits table, and the problem→solution patterns — not units alone.
- "Covers" cites actual Section numbers, field names, and unit ranges — not vague descriptions like "background info."
- When a file is derivative of another (a condensed summary, an earlier draft of the same material), say so explicitly and mark it "confirms, doesn't add" rather than listing it as an independent source for content it merely restates.
- If a source file contributed nothing that made it into the final document, don't list it — this appendix records what was actually used, not everything attached.

## Classification rules (apply these before finalizing any unit's tags)

1. Check content against the cell's insight form, not just intuition. For each dimension×stage combination, the Framework defines what that cell is actually supposed to capture (e.g. Institution/Define wants "content authority + approval and escalation process"; Institution/Pilot wants "first public failure + institutional response"). Before tagging a unit, check which insight form it actually satisfies — don't tag by how the content sounds.
2. Re-check every axis when you move a unit, not just the one that prompted the move. If you're correcting a unit's stage, also re-verify its dimension and type are still right — errors compound across axes, not just within one.
3. Playbook requires a genuine multi-step, gated sequence — "do X, then don't proceed to Y until X clears, then Z." A single decision that merely sounds procedural is not a playbook, even if it uses words like "process" or "steps." If it's one decision, tag it Strategic or Tactical Decision instead.
4. Toolkit Asset requires an actual reusable artifact — a checklist, template, schema, or built tool someone else can lift and adapt without rebuilding. A decision about how to structure something is a Decision, not a Toolkit Asset — check whether this source text actually describes a built, transferable artifact, not just a design choice.
5. Stage (origin) reflects where the evidence was discovered, never where it's most useful. Use "Also relevant at" for usefulness elsewhere — don't relabel Stage itself.
6. A cell with 1–2 units is not automatically "covered." Check whether the existing unit(s) actually satisfy that cell's insight form. If they don't, that's still an open question for Section 2, even though the grid shows a filled cell.
7. Don't fabricate what isn't in the source. If a before→after, a named individual, a condition, or an alternative-considered isn't stated or reasonably inferable, write "Not documented in the source" or omit the field rather than inventing plausible-sounding content.
8. Coordination and sign-off — Institution vs. Ecosystem. Before tagging, check whether the counterpart sits inside the contributing organisation's own chain of command. If it required a separate negotiated agreement, MOU, or incentive alignment with an organizationally distinct actor, tag Ecosystem — even when that actor is itself state-affiliated. Org-chart independence is the test, not government affiliation.
9. Benchmark numbers need a real decision behind them. Before creating a Decision unit around a quantitative figure, confirm a genuine alternative was considered and there's a before/after to report. If the number is a standalone fact about the deployment as a whole with no specific alternative behind it, it belongs in Section 1 — not manufactured into a Section 3 unit.
10. When the source states both a general principle and a specific illustrating case, the Decision field is the principle, not the case. Use the specific case in Before→After or as supporting detail in "What this looked like here." A unit whose "Decision" just restates the example is under-generalized — a different adopter can't reuse someone else's staffing ratio, but they can reuse a sizing method.
11. If a documented decision is expressed through a specific local tool, platform, or rail, separate the transferable practice (goes in Decision) from the specific instantiation (goes in "What this looked like here") — the specific tool is not itself the transferable claim.
12. An alternative only counts if it was actually weighed for this specific deployment — general advisory commentary elsewhere in the source about what other adopters should consider does not qualify, even when topically related.
13. Before finalizing, check whether two candidate units express the same reusable insight, just surfaced at different stages. If so, merge into one unit at its primary stage, using "Also relevant at" for the other — don't split one insight into two units.
14. If any claim is ambiguous or underspecified in the source, don't resolve the ambiguity yourself and present your resolution as fact. State only what the source says, and if the ambiguity matters, add it to Section 2's gap list instead.

## Formatting and tone rules

- Never mention the Framework by name, never explain your classification reasoning, never leave notes about reclassification history, anywhere in Sections 0–6.
- Use "Dimension," never "Shift."
- Use plain sequential numbers for units, never composite ID codes.
- Every cross-reference (toolkit table, retrieval guide, gap notes, Source Trace appendix) must use the same unit numbers as Section 3 — check all of them after any renumbering.
- Keep Sections 0–6 consistent in tense and voice — written for the next adopter, not for whoever assembled it. The Source Trace appendix is the one exception: it's written for the contributor, not the adopter, and is never numbered as part of the 0–6 sequence.

## Before finalizing, self-check

- Every unit's Dimension, Stage, and Type were checked against the Framework's own definitions, not assumed from wording.
- No unit has a default Source field; Origin deployment appears only where this is a horizontal pathway and the unit's origin differs from the primary deployment.
- Every Playbook and Toolkit Asset genuinely meets the stricter bar (multi-step+gated / genuinely reusable artifact), not just "sounds procedural."
- The coverage grid's counts match the actual number of units in Section 3, cell by cell, counted by Stage (origin) only — "Also relevant at" tags were not counted.
- Every gap question in Section 2 passed all four tests (concreteness, non-fabrication, boundary-restatement, existing-coverage) — not just "the cell was empty."
- The gap list is not padded to match every empty grid cell.
- Every surviving gap uses this pathway's own vocabulary and cites specific unit numbers where relevant.
- All cross-references (Section 4 table, Section 6 retrieval guide, Source Trace appendix) point to correct, current unit numbers.
- Every quantitative benchmark is either evidence inside a Decision unit's Before→After, or lifted to Section 1 — none invented a fake "alternative considered" just to house a number.
- Coordination-related units were checked against the chain-of-command test (Rule 8) before tagging Institution vs. Ecosystem.
- Section 1 includes scale, cost anchor, build effort, downstream reuse, and scope/non-transfer fields where the source material supports them.
- The Source Trace appendix is keyed by source file, covers Sections 1, 3, and 4 (not units alone), correctly flags any derivative/confirms-only files, and is not numbered as "Section 7."
- No Framework references, meta-commentary, or reclassification history remain anywhere in Sections 0–6.
