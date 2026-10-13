---
title: Sahayika
description: A WhatsApp assistant for rural community health workers in India that answers clinical and scheme questions from a doctor-curated knowledge base, with nurse-midwife escalation for low-confidence cases — revealing that escalation routes fail without formal duty assignment.
stage: Pilot
sector: Community Health
location: Rural India
tags: [Community Health Workers, Rural, WhatsApp, Voice AI]
---

# Sahayika

## Section 0 — Reading guide

This pathway documents a first pilot of an NGO-led WhatsApp assistant for community health workers in rural India. The deployment reached month 14 of an 18-month grant before the steering group decided to rework and re-pilot. The most transferable knowledge sits in the failure of the escalation route — a pattern that will recur in any deployment where human responders are recruited informally rather than formally assigned.

Knowledge is densest at Pilot stage across all four dimensions. Explore and Define have partial coverage. Scale has no coverage; this deployment has not reached it.

Navigate by what you need:
- **Designing an escalation route** → Units 3, 4, 5
- **Understanding why use drops after launch** → Unit 6
- **Thinking about formal duty assignment before building** → Units 2, 4
- **Governance and oversight model** → Unit 3
- **Sustainability and running costs** → Section 2 gaps

---

## Section 1 — Pathway identity

| Field | Detail |
|---|---|
| Deployment name | Sahayika |
| Sector | Community Health |
| Geography | Rural India (one state; district not named in the source) |
| Population served | Community health workers (CHWs) in rural districts, using government-issued smartphones, needing clinical and government-scheme answers when supervising nurse-midwives are unreachable |
| Stage reached | Pilot (first pilot complete; rework and second pilot decided) |
| Contributing organisation | NGO (field work and relationships); private research lab (build and evaluation); philanthropic foundation (funder) |
| Key dates | Month 0: grant proposal. Month 3: design note. Months 6–9: pilot dashboard. Month 8: nurse interviews. Month 14: steering group review. As of October 2026. |
| Summary | Sahayika is an NGO-led WhatsApp assistant that answers CHW questions from a doctor-curated knowledge base, with nurse-midwife escalation for low-confidence cases. A first pilot with 120 workers revealed that the escalation route broke down within two months because nurse duties were never formally assigned. Weekly use halved over three months; cause not established. The steering group has decided to rework and re-pilot before any expansion. |
| Scale / impact achieved | 120 health workers in pilot. 70% weekly active in month 1; 35% by month 3. 212 escalations in month 1 (median wait 4 hours); 61 in month 3 (median wait 80 hours). As of month 14. |
| Cost anchor | Not documented in the source |
| Build effort | 18-month grant covering design, build, and pilot. Part-time NGO programme staff and research lab researchers. As of month 14. |
| Known downstream adopters | Not documented in the source |
| Scope / does-not-transfer-when | Not documented in the source |

---

## Section 2 — Coverage grid and open questions

### Coverage grid

| | Explore | Define | Pilot | Scale |
|---|---|---|---|---|
| **Persona** | ●● | ○ | ●● | ○ |
| **Solution** | ●● | ●● | ●● | ○ |
| **Institution** | ●● | ● | ●● | ○ |
| **Ecosystem** | ● | ○ | ●● | ○ |

### Open questions this pathway leaves unanswered

1. **Why did weekly use fall from 70% to 35%?** (Persona × Pilot) The decline is documented in Units 5 and 6, but the cause was never investigated — no CHW interviews were conducted about it. The project team's working hypothesis (novelty wore off) is unverified. Any adopter planning a similar assistant needs to design use-monitoring and user interviews into the pilot from the start, not as a retrospective.

2. **What does success look like for a CHW using this system?** (Persona × Define) No success definition for an individual CHW interaction — or for the pilot as a whole from the CHW's perspective — is documented. Unit 1 establishes the problem, but no binary success criterion was set before the pilot ran.

3. **Which CHW questions fall inside the system's scope and which must be refused?** (Persona × Define) The design note defines the escalation trigger (retrieval confidence) but not the outer boundary of what the system is expected to answer. Drug interactions, scheme eligibility edge cases, and newborn danger signs were the most escalated topics — it is not clear whether these were intended to be handled by the knowledge base, by escalation, or refused.

4. **Who has content authority — who approves what the system is permitted to say?** (Institution × Define) Doctors curate the knowledge base and review a weekly sample, but no formal content approval process or accountability for knowledge base accuracy is named. This is an open governance gap before any re-pilot or expansion (relates to Unit 3).

5. **Who owns and operates this after the grant ends?** (Institution × Scale / Institution × Explore) Running costs have not been taken to the state health mission. No budget line beyond the grant exists. The steering group minutes record the question as open. This is the single largest sustainability gap in the pathway.

6. **What formal agreement exists with the district health office or block supervisors?** (Ecosystem × Define) The district health officer attended the steering group as an observer. The block supervisor role in assigning nurse duties is identified as decisive (Unit 4), but no formal agreement, MOU, or coordination mechanism exists as of month 14.

7. **What happens when WhatsApp or the underlying model is unavailable?** (Solution × Define) No fallback or contingency for platform or model unavailability is documented. On patchy connections with government-issued smartphones, this is a live operational risk.

---

## Section 3 — Micro-innovations

### Persona

**1. Workaround as the need signal**

- **Dimension:** Persona
- **Stage:** Explore
- **Type:** Strategic Decision
- **Decision:** Define the problem not from the institution's service description but from what the excluded user does when the system fails them. CHWs were delaying decisions or guessing when nurse-midwives were unreachable — that workaround (and its clinical risk) is what established the case for the assistant.
- **Alternative considered:** Not documented in the source
- **Why:** A service-description framing would have produced a tool that answered the questions the system already handled. The workaround framing revealed the actual gap: unreachable supervisors and no trusted fallback.
- **What this looked like here:** Grant proposal named the delay-or-guess behaviour explicitly as the need, before any technical design began. That framing carried through to the choice of WhatsApp (already in CHWs' hands) and voice input (for workers less comfortable typing).
- **Condition — applies when:** The population has a visible workaround that reveals the real failure mode of the existing system. Where no workaround exists, the need signal requires different methods.

---

**2. Voluntary recruitment without incentive design**

- **Dimension:** Persona
- **Stage:** Define
- **Type:** Strategic Decision
- **Decision:** Recruit CHWs voluntarily at their sector meeting, with no formal requirement and no documented incentive for sustained use.
- **Alternative considered:** Not documented in the source
- **Why:** Not documented in the source. Voluntary participation was named in the design note without a rationale.
- **What this looked like here:** Workers joined by sending a message after a briefing. No follow-up mechanism for workers who stopped using the system was designed in.
- **Condition — applies when:** Not documented in the source. The absence of incentive design is a documented risk factor — voluntary uptake without a use-retention design tends to produce the pattern seen here: high early engagement, unexplained later drop.
- **Before → After:** Not documented in the source (the link between voluntary-only recruitment and the use decline was not investigated).

---

**3. Post-hoc oversight as the governance model**

- **Dimension:** Solution
- **Stage:** Define
- **Also relevant at:** Pilot
- **Type:** Strategic Decision
- **Decision:** Send answers to CHWs before human review, with doctors reviewing a weekly sample after the fact and updating the knowledge base.
- **Alternative considered:** Human review before answers are sent (pre-deployment review).
- **Why:** Pre-deployment review would introduce latency incompatible with a CHW who needs an answer during a home visit. Post-hoc review was chosen to preserve responsiveness, with the weekly doctor sample as the quality mechanism.
- **What this looked like here:** Doctors reviewed sent answers weekly and updated the knowledge base. No instance of a harmful sent answer is documented in the source, but no systematic harm-monitoring mechanism beyond the weekly sample is described either.
- **Condition — applies when:** The use case requires fast response (minutes, not hours) and the risk of an incorrect answer is manageable within a weekly review cycle. Fails when incorrect answers carry immediate, irreversible clinical consequence — in that setting, a faster review loop or pre-deployment gate is needed.

---

**4. Escalation route designed without the responders**

- **Dimension:** Institution
- **Stage:** Define
- **Also relevant at:** Pilot
- **Type:** Failure and Fix
- **Failure:** Nurse-midwives were briefed on their escalation role at a block meeting but were not consulted during design. Their role was not added to their formal duties. By month 2, median escalation wait time had risen from 4 hours to 72 hours. By month 3, escalation volume had fallen by more than two thirds — CHWs had stopped asking questions they expected would go unanswered.
- **Fix:** The steering group decided to rebuild the escalation route before any wider rollout, with nurse supervisors formally assigning it. Implementation of the fix is pending the second pilot.
- **Insight:** An escalation route that depends on human responders will not hold unless the responding role is formally assigned by the responders' own supervisors. Informal briefing and goodwill are not a substitute for duty assignment. The responders' own time and workload constraints must be surfaced during design, not assumed away.
- **Condition — applies when:** Any deployment that relies on human responders who are not the deploying organisation's own staff. The risk is highest when responders have an existing full workload and no formal recognition or time allocation for the new role.

---

**5. Block supervisor as the decisive governance actor**

- **Dimension:** Ecosystem
- **Stage:** Pilot
- **Type:** Strategic Decision
- **Decision:** The district health officer confirmed at the steering group that nurse duties are set by block supervisors — not by the NGO, the lab, or the district health office itself. Nothing in the escalation route will change without block supervisor assignment.
- **Alternative considered:** Not documented in the source
- **Why:** The block supervisor holds the line authority over nurse-midwife duties. Any workaround that bypasses that authority (e.g. appeals to the district health officer, or direct nurse agreement) will not be durable.
- **What this looked like here:** This insight arrived at month 14 — after the escalation route had already failed. The block supervisor role was not identified as a required partner at the design stage.
- **Condition — applies when:** Any health system deployment in which human responders sit in a distinct administrative hierarchy from the deploying organisation. Map the chain of duty assignment before designing any human-in-the-loop component.
- **Before → After:** Before: escalation route designed assuming nurse briefing was sufficient. After: steering group decision to involve supervisors in formal assignment before re-pilot — governance actor identified but not yet engaged.

---

**6. Use decline without a monitoring design**

- **Dimension:** Persona
- **Stage:** Pilot
- **Type:** Failure and Fix
- **Failure:** Weekly active use fell from 70% in month 1 to 35% by month 3. The project team did not interview CHWs about the decline during the pilot; its cause remains unestablished at month 14.
- **Fix:** Not implemented. The steering group noted the decline but did not commission a cause investigation before the review.
- **Insight:** A use decline of this scale during a pilot is not self-explaining. Without a designed monitoring mechanism (user interviews at month 2, exit surveys for workers who stopped, structured feedback channels), the cause cannot be distinguished from novelty effects, unmet need, usability problems, or the escalation breakdown itself. Any re-pilot should build use-monitoring in from day one — not treat it as something to investigate retrospectively if numbers fall.
- **Condition — applies when:** Any deployment where sustained voluntary use is the primary adoption signal. Applies especially when the user population has limited time and no formal obligation to use the system.

---

**7. No running-cost plan before the grant ends**

- **Dimension:** Institution
- **Stage:** Pilot
- **Also relevant at:** Explore
- **Type:** Failure and Fix
- **Failure:** The grant covers design, build, and pilot. The state health mission — the logical long-term funder — has not been approached as of month 14. Running costs (model usage, knowledge base maintenance) are unresolved. The foundation asked about post-grant funding at the steering group; no answer was given.
- **Fix:** Not documented in the source. The question was noted as open.
- **Insight:** Philanthropic funding for a pilot does not automatically convert into institutional funding for a service. The state health mission needs to be engaged during the pilot — not after — so that a sustainability conversation has time to mature before the grant ends. Waiting until month 14 of an 18-month grant leaves no runway.
- **Condition — applies when:** Any pilot funded by a time-limited philanthropic or project grant, where long-term operation depends on a government institution absorbing running costs. The earlier the sustainability conversation starts, the more options remain open.

---

**8. Nurse-midwife exclusion from design as an adoption risk**

- **Dimension:** Ecosystem
- **Stage:** Define
- **Also relevant at:** Pilot
- **Type:** Strategic Decision
- **Decision:** Nurse-midwife design input was described in the design note as "considered but not scheduled, due to time." Nurses were briefed on their role, not consulted about it.
- **Alternative considered:** Involving nurses in designing the escalation protocol (timing, rota, reply format, workload).
- **Why:** Not documented in the source. The decision appears to have been a time constraint, not a deliberate design choice.
- **What this looked like here:** Nurses reported at month 8 that they had first heard about their role at the briefing. Several said they were not asked how the protocol should work. Their own suggestions — a supervisor-assigned rota and a fixed daily time slot — were the same fixes the steering group later decided to implement after the route had already failed.
- **Condition — applies when:** Any design process that depends on human responders outside the deploying organisation's direct authority. Excluding those responders from design does not save time — it relocates the cost to the pilot, where the failure is more expensive to fix.

---

## Section 4 — Reusable resources

| # | Title | Type | Reuse condition |
| --- | --- | --- | --- |
| — | [docs.google.com](https://docs.google.com/document/d/1FZt-VAkJE71RFMbewkGGMnuMC0eksNli-_7gHTi-5Z0/edit?tab=t.0) <!-- asset-id: asset-dedc5a85-841d-4799-97c9-ef15ec09a7cb --> | Toolkit Asset | Not documented in the source |
| — | [docs.google.com](https://docs.google.com/document/d/1QgZ63uubAXgSzG2bsL_SCHzqGMYzfEJa8U0F3ZZ54Lk/edit?usp=sharing) <!-- asset-id: asset-fe04c882-835b-4102-ba49-85727251f69e --> | Toolkit Asset | Not documented in the source |
| — | [docs.google.com](https://docs.google.com/document/d/1K9bW_1zONlJMTSO2FEJ9v-Pphu0j6o5f5bJKSD7H_Qg/edit?usp=sharing) <!-- asset-id: asset-b0f7b5dc-cd14-47a0-849a-1f70451d949c --> | Toolkit Asset | Not documented in the source |
| — | [Sahayak guideline v3](/api/toolkit-assets/asset-ab586f12-ecfc-4499-9972-32bea221add3/download) <!-- asset-id: asset-ab586f12-ecfc-4499-9972-32bea221add3 --> | Toolkit Asset | Not documented in the source |

---

## Section 6 — Retrieval guide

- *"How do I design an escalation route that won't break down?"* → Unit 4, Unit 5, Unit 8
- *"What happens if the nurses won't answer escalations?"* → Unit 4, Unit 5
- *"Who do I need sign-off from before assigning human responders?"* → Unit 5
- *"How do I know if the drop in use is a real problem or just novelty wearing off?"* → Unit 6
- *"Should answers go out before a human reviews them?"* → Unit 3
- *"How do I make the case that the problem is real before building?"* → Unit 1
- *"What goes wrong if I recruit users voluntarily with no retention design?"* → Unit 2, Unit 6
- *"When should I start the conversation about funding after the grant?"* → Unit 7
- *"Do I need to talk to the state health mission during the pilot?"* → Unit 7
- *"What if the people I need to co-design with don't have time?"* → Unit 8
- *"How do I find out who actually controls the duties of my human responders?"* → Unit 5

---

## Source Trace appendix

*Contributor-facing only — not surfaced in adopter-facing responses.*

| Source file | Covers | Notes |
|---|---|---|
| 01-grant-proposal.md, month 0 | Section 1 (deployment name, sector, geography, population, partners, build effort, sustainability gap); Unit 1 (workaround framing); Unit 7 (no running-cost plan) | Primary source for Explore-stage Persona and Institution framing |
| 02-design-note.md, month 3 | Section 1 (channel, languages, oversight model, nurse briefing); Units 2, 3, 4, 8 (voluntary recruitment, post-hoc oversight, escalation design, nurse exclusion) | Primary source for Define-stage Solution and Institution units |
| 03-pilot-dashboard-notes.md, months 6–9 | Section 1 (scale/impact numbers); Units 5, 6 (escalation breakdown data, use decline data) | Primary source for quantitative pilot metrics; analyst notes confirm cause of decline is uninvestigated |
| 04-nurse-interview-notes.md, month 8 | Units 4, 5, 8 (nurse experience of escalation, block supervisor insight, design exclusion quotes) | Primary source for nurse-side failure analysis; direct quotes used as evidence |
| 05-steering-group-minutes.md, month 14 | Section 1 (stage, steering group decision); Units 4, 5, 7 (fix decision, block supervisor named, running cost open); Section 2 gaps (sustainability, DHO role) | Primary source for governance decisions and open questions |
| 99-sahayika-evaluation.md, synthetic date | Sections 1 and 2 (background, findings summary); confirms Units 3, 4, 6 | Derivative summary prepared by research partner; confirms content from 01–05 but does not add new facts — treated as confirms only |