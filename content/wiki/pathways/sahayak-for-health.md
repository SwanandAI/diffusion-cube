---
title: Sahayika
description: A WhatsApp assistant for community health workers in rural India that surfaces clinical answers from a doctor-curated knowledge base and escalates to nurse-midwives — revealing that escalation routes require formal supervisor assignment before they function at scale.
stage: Pilot
sector: Health
location: Rural India
tags: [Community Health, Voice AI, Rural, Escalation Design]
---

# Sahayika

## Section 0 — Reading guide

This pathway documents a WhatsApp-based clinical support tool for community health workers in rural India. It is most useful to adopters who are designing AI-assisted tools where the AI layer performs well but depends on a human escalation route that sits outside anyone's formal job description.

The densest knowledge in this document is in the Pilot stage — particularly around escalation failure and what it reveals about institutional design. The Explore and Define stages contain useful prior decisions on channel, knowledge base architecture, and the majority-vote escalation mechanism. Scale is entirely undocumented: the steering group has decided on a second pilot rather than expansion.

Navigate by unit number. If you are designing an escalation route, start with Units 4, 6, and 7. If you are choosing a channel or architecture, start with Units 1 and 2. If you are thinking about institutional ownership, start with Units 5 and 8.

---

## Section 1 — Pathway identity

| Field | Detail |
|---|---|
| Deployment name | Sahayika |
| Sector | Health |
| Geography | Rural India (one state; district not named in source) |
| Population served | Community health workers needing real-time answers to clinical and government-scheme questions |
| Stage reached | Pilot |
| Contributing organisations | NGO (field work and district relationships); private research lab (technical build and evaluation) |
| Funder | Philanthropic foundation |
| Key dates | Month 0: grant proposal; Month 3: design note; Months 6–9: pilot dashboard; Month 14: steering group review |
| Summary | Sahayika is a WhatsApp assistant for 120 community health workers in rural India, drawing answers from a doctor-curated knowledge base and escalating unresolvable questions to nurse-midwives by majority vote. The knowledge base performed well. The escalation route collapsed by month 3 because nurse-midwife participation was never formally assigned by block supervisors. The steering group has decided on a redesigned second pilot before any wider rollout. |
| Scale and impact achieved | 120 CHWs enrolled. Month 1: 70% weekly active, escalation median wait 4 hours. Month 3: 35% weekly active, escalation median wait 80 hours. As of month 14. |
| Cost anchor | Not documented in the source |
| Build effort | 18-month grant period; part-time NGO programme staff and research lab researchers. Detail beyond this not documented in the source. |
| Known downstream adopters | Not documented in the source |
| Scope / does not transfer when | The escalation failure insight is most relevant when a human tier sits outside the deploying institution's direct management authority. It does not transfer cleanly to deployments where the AI operates without a human escalation tier, or where the escalation role is already formally assigned before the pilot begins. |

---

## Section 2 — Coverage grid and open questions

### Coverage grid

| | Explore | Define | Pilot | Scale |
|---|---|---|---|---|
| **Persona** | ●●● | ●● | ●● | ○ |
| **Solution** | ●● | ●●● | ●●● | ○ |
| **Institution** | ●● | ●● | ●●● | ○ |
| **Ecosystem** | ● | ●● | ●● | ○ |

### Open questions

1. **Why did weekly active use fall from 70% to 35% between months 1 and 3?** The project team suspects novelty wore off, but no health worker interviews were conducted to investigate (see Units 6 and 7). If the fall reflects a scope or quality problem rather than novelty, the fix for the second pilot is different.

2. **What will block supervisors need to formally assign escalation duty — and has anyone approached them?** The steering group's decision to rebuild the escalation route depends on supervisor action. No engagement with block supervisors is documented before or during the pilot (Units 5 and 8).

3. **What is the post-grant operating model?** The state health mission has not been approached. No running-cost figure, candidate institutional home, or sustainability pathway is documented (Unit 5).

4. **What does "retrieval confidence sufficient" mean in practice, and who set the threshold?** The design note describes a confidence gate that routes questions either directly to the health worker or to nurses, but the threshold, how it was set, and whether it was reviewed during the pilot are not documented (Unit 3).

5. **Which questions are falling outside the knowledge base's scope, and how are they distributed across clinical versus scheme domains?** Escalation topics are named in the source (drug interactions, scheme eligibility edge cases, newborn danger signs), but whether the knowledge base was extended in response, or scope boundaries re-examined, is not documented (Unit 3).

6. **Is the district health officer a formal governance partner or a permanent observer?** Steering group minutes list the DHO as observer. If the second pilot requires supervisor-level buy-in, this role needs to be renegotiated before the pilot restarts (Unit 8).

---

## Section 3 — Micro-innovations

### Persona

**1. Framing exclusion as decision uncertainty, not technology absence**

- **Dimension:** Persona
- **Stage:** Explore
- **Type:** Strategic Decision
- **Decision:** Define the target user's problem as decision uncertainty under time pressure — CHWs have phones and connectivity; what they lack is a trusted, reachable answer when their supervisor is unavailable for days.
- **Alternative considered:** Not documented in the source.
- **Why:** Framing the bottleneck as human availability rather than technology access directed the solution toward knowledge retrieval and escalation design, not device provision or connectivity work. A different framing would have produced a different intervention.
- **What this looked like here:** The grant proposal named danger signs, drug doses, and government schemes as the question types, and nurse-midwives being unreachable for days as the structural failure — establishing from the outset that the problem is access to authoritative answers, not access to a device.
- **Condition — applies when:** The target population already has the required device and connectivity but lacks a reliable pathway to authoritative answers during the working day.

---

### Solution

**2. WhatsApp as channel, with voice transcription as a thin input layer**

- **Dimension:** Solution
- **Stage:** Explore
- **Type:** Strategic Decision
- **Decision:** Use WhatsApp as the primary channel, with voice note transcription to support workers who prefer speaking over typing.
- **Alternative considered:** Not documented in the source.
- **Why:** CHWs carried government-issued smartphones and were already active WhatsApp users. Adding a new application would have introduced an adoption barrier the team chose to avoid. Voice transcription kept the retrieval and LLM layer channel-agnostic.
- **What this looked like here:** Voice notes are transcribed before retrieval; the knowledge base and LLM layer receive text regardless of how the question arrived.
- **Condition — applies when:** The target population is already active on WhatsApp and carries smartphones. Fails when connectivity is too patchy for reliable message delivery, or when the institution cannot accept WhatsApp as a data carrier for health information.

---

**3. Majority-vote escalation across five nurses as a substitute for single-nurse availability**

- **Dimension:** Solution
- **Stage:** Define
- **Also relevant at:** Pilot
- **Type:** Strategic Decision
- **Decision:** Route unresolved questions to five nurse-midwives simultaneously and return the majority answer when three agree, rather than assigning a single escalation contact per CHW or per block.
- **Alternative considered:** Single named nurse contact per block or per CHW cohort.
- **Why:** A single contact reproduces the availability problem the tool was designed to solve. Distributing the question across five nurses was intended to make response time a function of the group, not any one individual's availability.
- **What this looked like here:** The mechanism produced a 4-hour median escalation wait in month 1. By month 3 the median had risen to 80 hours — demonstrating that the mechanism's performance depends entirely on nurses treating escalation as their job. The design was sound; the institutional condition it assumed was not in place.
- **Condition — applies when:** Multiple nurses are enrolled and regard participation as a work duty. Fails when nurse participation is informal and unsupervised — the majority-vote mechanism does not compensate for low response rates if the underlying cause is unassigned duty.

---

**4. Human review after delivery, not before**

- **Dimension:** Solution
- **Stage:** Define
- **Type:** Strategic Decision
- **Decision:** Send knowledge-base answers directly to the health worker; doctors review a weekly sample afterwards and update the knowledge base accordingly.
- **Alternative considered:** Not documented in the source.
- **Why:** Pre-delivery review would have introduced delays incompatible with the use case. A CHW asking about a danger sign cannot wait hours for a doctor to approve the answer. Post-delivery review was the team's way of maintaining quality without sacrificing response time.
- **What this looked like here:** Doctors curated the knowledge base and reviewed weekly samples of sent answers. KB answers were well received throughout the pilot. No adverse events are documented in the source.
- **Condition — applies when:** The knowledge base is tightly scoped and curated by qualified professionals, and the question domain is bounded enough that most answers can be trusted before review. Requires a functioning feedback loop so errors identified in review actually update the knowledge base.

---

### Institution

**5. Sustainability and formal ownership left unresolved at grant stage**

- **Dimension:** Institution
- **Stage:** Explore
- **Type:** Failure and Fix
- **Failure:** The grant proposal deferred sustainability to a future conversation with the state health mission during the pilot. No institutional home was named, no running-cost estimate was made, and no commitment was sought before build began.
- **Fix:** Not yet actioned. Steering group minutes at month 14 record the question as still open; the state health mission has not been approached.
- **Insight:** A deployment that defers the question of institutional ownership until the grant is nearly spent arrives at the end of the pilot with a functioning tool and no operator. The fix is to name a candidate institutional home and begin that conversation before build, not during the pilot.
- **Condition — applies when:** The deploying organisation — NGO, research lab, or foundation-funded project — is not the intended long-term operator. Relevant in any grant-funded deployment where a government body would need to absorb the service after funding ends.

---

**6. Escalation route designed without nurse input or formal duty assignment**

- **Dimension:** Institution
- **Stage:** Pilot
- **Type:** Failure and Fix
- **Failure:** Nurse-midwives were briefed on their escalation role at a block meeting but were not consulted in its design and received no formal duty assignment from their supervisors. By month 3, median escalation wait had risen to 80 hours and escalation volume had fallen by more than two-thirds, as health workers stopped asking questions they expected would go unanswered.
- **Fix:** The steering group decided to rebuild the escalation route before any further rollout, with block supervisors formally assigning the duty on a rota. This has not yet been implemented.
- **Insight:** An escalation route that depends on voluntary participation from workers whose supervisors have not recognised the role is not a stable design — it is a favour. The majority-vote mechanism was technically sound; the failure was that the institutional condition it required was never created.
- **Condition — applies when:** The escalation tier sits in a separate management chain from the deploying organisation. The fix requires the institution that manages those workers to act — it cannot be resolved by the deploying NGO or lab alone.

---

### Ecosystem

**7. Block supervisors identified as load-bearing missing actor, mid-pilot**

- **Dimension:** Ecosystem
- **Stage:** Pilot
- **Type:** Failure and Fix
- **Failure:** Block supervisors — the line managers who set nurse-midwife duties — were not in the partner map at design or launch. The escalation route was built on nurse participation that supervisors had never sanctioned. The district health officer attended steering group meetings as an observer but did not hold authority over block-level duty assignment.
- **Fix:** The DHO confirmed at the month-14 steering group that nothing will change without block supervisor involvement. The second pilot's design must begin there, not with nurses.
- **Insight:** When an ecosystem actor's cooperation is load-bearing but they are not formally in the partner map, the failure is invisible until it breaks — because the tool appears to be working (KB answers are fine) while the dependency quietly fails. The partner map must follow duty-setting authority, not just the people who will do the work.
- **Condition — applies when:** A human escalation or validation tier is staffed by workers whose duties are set by a separate management chain. Identifying who assigns those duties — and partnering with them, not just the workers — is the structural requirement.

---

**8. District health officer engaged as observer rather than accountable partner**

- **Dimension:** Ecosystem
- **Stage:** Define
- **Also relevant at:** Pilot
- **Type:** Strategic Decision
- **Decision:** The district health officer was included in steering group meetings as an observer, not as a named partner with defined responsibilities.
- **Alternative considered:** Not documented in the source.
- **Why:** Not documented in the source. The observer role may reflect an early stage of government engagement or a deliberate choice to keep the pilot light on formal commitments.
- **What this looked like here:** The DHO's substantive contribution came only at month 14, when they clarified that block supervisors hold duty-setting authority. Had this been established at Define stage, the partner map would have been different before the pilot began.
- **Condition — applies when:** Government officials are engaged but not yet ready to take formal accountability. Fails when the deployment depends on actions — duty assignment, data access, institutional sign-off — that only those officials can authorise. Observer status in that situation defers a necessary conversation rather than managing it.

---

## Section 4 — Toolkits and playbooks

| # | Title | Type | Reuse condition | File |
| --- | --- | --- | --- | --- |
| — | [Sahayak guideline](/api/toolkit-assets/asset-45fe4781-4c76-4976-8d41-95f1fb74282f/download?preview=1) <!-- asset-id: asset-45fe4781-4c76-4976-8d41-95f1fb74282f --> | Toolkit Asset | Reusable by any rural health deployment looking to train health workers; the content and examples would need to be adapted to fit the local context and specific roles of the health workers involved. | [Sahayak - guideline v3.pdf](/api/toolkit-assets/asset-45fe4781-4c76-4976-8d41-95f1fb74282f/download) |

---

## Section 6 — Retrieval guide

*"How do I stop my escalation route from collapsing once the pilot starts?"* → Unit 6, Unit 7

*"Should I use WhatsApp or build a separate app for my health workers?"* → Unit 2

*"We have nurses who could answer escalated questions — how should we structure that?"* → Unit 3, Unit 6

*"The nurses say they will help but their managers haven't agreed — does that matter?"* → Unit 6, Unit 7

*"How do I figure out who actually has authority over the people in my escalation tier?"* → Unit 7, Unit 8

*"Do we need government commitment before the pilot, or can we sort sustainability later?"* → Unit 5

*"Our knowledge base answers are good but usage is falling — what should I investigate?"* → Unit 6; Section 2 open question 1

*"How do I design human review of AI answers without slowing down response time?"* → Unit 4

*"The district health office is interested but not committing — how should we handle that?"* → Unit 8, Unit 5

*"We briefed our escalation partners but did not consult them — is that a problem?"* → Unit 6, Unit 7

*"We are defining who the user is — how do we frame the problem correctly?"* → Unit 1

---

---

### Source Trace appendix (contributor-facing only — not surfaced in adopter responses)

| Source file | Covers | Notes |
|---|---|---|
| 01-grant-proposal.md, month 0 | Section 1 (population, partners, budget/duration, sustainability gap); Unit 1; Unit 5 (failure origin) | Primary source for Explore-stage framing and the sustainability gap |
| 02-design-note.md, month 3 | Section 1 (build effort); Units 2, 3, 4, 8 (Define-stage decisions); Unit 6 (nurse briefing without consultation — origin) | Primary source for architecture, channel, and escalation mechanism design |
| 03-pilot-dashboard-notes.md, months 6–9 | Section 1 (scale and impact numbers); Units 3, 6, 7 (pilot-stage quantitative evidence); Section 2 open question 1 | Primary source for usage and escalation metrics; analyst notes flag uninvestigated usage decline |
| 04-nurse-interview-notes.md, month 8 | Units 6, 7 (nurse quotes and structural diagnosis); Section 2 open questions 1 and 2 | Primary source for the institutional failure diagnosis; nurse quotes underpin Unit 6 |
| 05-steering-group-minutes.md, month 14 | Section 1 (stage reached, steering group decision); Units 5, 7, 8 (DHO clarification, sustainability open question); Section 2 open questions 2, 3, 6 | Primary source for the governance decision and DHO's clarification on block supervisor authority |
| 99-sahayika-evaluation.md, date not stated | Confirms Section 1, Units 1–8, Section 2 open questions 1–3 | Evaluation summary prepared by research partner; derivative of the above files — confirms content, does not add new facts beyond what the primary sources establish |
| Adoption Companion conversation, October 13, 2026 | Section 1 (summary, stage confirmation); grid density metadata | Contributor's own account of stage and framing; treated as contributor account, not independently verified |