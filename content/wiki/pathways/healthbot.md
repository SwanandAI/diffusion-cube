---
title: Sahayika
description: A WhatsApp-based assistant helping community health workers in rural India get timely answers on danger signs, drug doses, and government schemes, with escalation to a panel of nurse-midwives when the system cannot answer confidently.
stage: Define
sector: Health
location: Rural India
tags: [Community Health, Maternal Health, Voice AI, WhatsApp]
---

# Sahayika

## Section 0 — Reading guide

This pathway documents a WhatsApp-based assistant for community health workers in rural districts of India. It is written for the next adopter — someone deciding whether to build something similar, what the hard choices are, and what conditions must be true before building begins.

Knowledge in this pathway is organised by four dimensions (Persona, Solution, Institution, Ecosystem) and four stages (Explore, Define, Pilot, Scale). The deployment reached Define stage at the time of documentation — Pilot and Scale cells are empty, and the gaps section names what remains unresolved. The densest knowledge is in Solution/Define and Persona/Explore. Navigate to the dimension and stage most relevant to your current question; the retrieval guide in Section 6 maps common adopter questions to specific units.

---

## Section 1 — Pathway identity

| Field | Detail |
|---|---|
| Deployment name | Sahayika |
| Sector | Health |
| Geography | Rural India |
| Population served | Community health workers (CHWs) in rural districts, responsible for maternal and child health |
| Stage reached | Define |
| Contributing organisation | NGO (field lead) + private research lab (technical lead) |
| Key dates | Project month 0 (grant proposal); Design note v1.2 at project month 3 |
| Summary | Sahayika is a WhatsApp-based assistant for community health workers in rural districts, answering questions about danger signs, drug doses, and government schemes from a doctor-curated knowledge base. Unresolved questions escalate to a panel of nurse-midwives via a majority-vote mechanism. The deployment reached Define stage with architecture and recruitment approach settled; no pilot data exists yet. |
| Scale / impact achieved | Not documented in the source — no pilot has run |
| Cost anchor | Not documented in the source. Budget is 18 months covering design, build, and a pilot with 120 health workers; staff time draws on existing NGO programme staff and lab researchers (no cost figures given) |
| Build effort | Project month 3 at time of design note; team is part-time NGO programme staff plus lab researchers; partner count: two organisations plus district health office relationship |
| Known downstream adopters | Not documented in the source |
| Scope | Answering CHW questions on danger signs, drug doses, and government schemes via WhatsApp; escalation to nurse-midwives for low-confidence responses |
| Does not transfer when | Nurse-midwives are unavailable or unwilling to participate in asynchronous escalation; WhatsApp is not used or trusted by the CHW population; Hindi and local dialect are not the primary working languages |

---

## Section 2 — Coverage grid and gaps

| Dimension | Explore | Define | Pilot | Scale |
|---|---|---|---|---|
| Persona | ●● | ● | ○ | ○ |
| Solution | ●● | ●● | ○ | ○ |
| Institution | ● | ● | ○ | ○ |
| Ecosystem | ● | ● | ○ | ○ |

**Key:** ●●● rich · ●● present · ● thin · ○ none

### Open questions

1. **Persona/Define — binary success definition missing.** Unit 1 names the core user problem, but no single "must-answer question" or binary success criterion has been stated for the pilot. The design note does not define what a failed pilot looks like from the CHW's perspective. What is the minimum performance on danger-sign queries that would justify proceeding to scale?

2. **Persona/Pilot and Scale — user segment variation unexamined.** The design recruits 120 CHWs voluntarily (Unit 2), but there is no documentation of how the system will behave across different literacy levels, voice-vs-text preferences, or dialect variation within the block. If the pilot reveals a performance gap between user subgroups, no response is designed.

3. **Institution/Define — content authority and approval process unnamed.** Two doctors curate the knowledge base (Unit 5), but the design note does not name who approves changes to what the system is permitted to say, nor who holds authority to pause the service if a harmful answer is sent. This is the Define stage's primary institutional gap.

4. **Institution/Explore and Define — sustainability deferred without a named owner.** Ongoing running costs are to be discussed with the state health mission during the pilot (Unit 6), but no named contact, timeline, or trigger for that conversation exists. Deferral without a named owner is a common reason post-pilot systems are not adopted. Which person inside the state health mission is expected to engage on this?

5. **Ecosystem/Define — nurse-midwife input not collected.** Unit 7 documents that design input from nurse-midwives was considered but not scheduled. This is a gap not just in relationship-building but in system design: the escalation workload per nurse-midwife, the reply interface, and the incentive to respond are all unvalidated by the people who must operate the escalation layer.

6. **Solution/Pilot — no failure taxonomy defined.** The system distinguishes confident from unconfident answers (Unit 4), but there is no documented classification of failure modes — wrong answer sent confidently, escalation unanswered, answer returned too slowly to be useful, voice transcription error. Without this, pilot support issues cannot be diagnosed to root cause.

---

## Section 3 — Micro-innovations

### Persona

**1. Starting from the CHW's operational gap, not a technology brief**

- Dimension: Persona
- Sub-category: A. Problem and Persona
- Stage: Explore
- Type: Strategic Decision
- Decision: Frame the deployment around a specific, observable CHW behaviour — delaying or guessing when a supervising nurse-midwife is unreachable — rather than around AI capability or a general "digital health" mandate.
- Alternative considered: Not documented in the source. The grant proposal does not describe alternatives evaluated.
- Why: The specific behaviour (delay and guessing under uncertainty) defines both the success condition and the safety boundary. A system that reduces guessing on danger signs has a measurable, meaningful outcome; a system that "supports CHWs digitally" does not.
- What this looked like here: The proposal names danger signs, drug doses, and government schemes as the three question types — each maps directly to a documented failure mode in the CHW's current situation.
- Condition — applies when: The target user has a specific, recurring decision point where they currently lack reliable information and act anyway.

---

**2. Voluntary opt-in recruitment via an existing convening moment**

- Dimension: Persona
- Sub-category: D. Scope, Inclusion, and Trust
- Stage: Define
- Type: Tactical Decision
- Decision: Recruit CHWs at their sector meeting by invitation, with participation activated by sending a WhatsApp message — no separate enrolment process.
- Alternative considered: Not documented in the source.
- Why: Using an existing convening moment reduces recruitment friction and signals institutional legitimacy (the invitation comes in an official setting). Activation via WhatsApp confirms the channel works for the user before they need it for a health question.
- What this looked like here: 120 CHWs across the block are the target; participation is voluntary, meaning the pilot population self-selects toward more motivated or digitally confident workers — a consideration for interpreting pilot results.
- Condition — applies when: A regular, block-level meeting already convenes the target user group; WhatsApp penetration in the population is sufficient for message-based activation.

---

### Solution

**3. WhatsApp as the primary channel based on existing CHW behaviour**

- Dimension: Solution
- Sub-category: B. UX, Channel, and Integration
- Stage: Explore
- Type: Strategic Decision
- Decision: Deliver the assistant through WhatsApp rather than a dedicated app or SMS, on the basis that CHWs already use it.
- Alternative considered: Not documented in the source.
- Why: Avoiding a new app eliminates a class of adoption friction (installation, login, learning a new interface). The channel the user already trusts becomes the interface.
- What this looked like here: Voice notes are accepted and transcribed before retrieval, extending WhatsApp's native voice capability into the retrieval pipeline without requiring a separate voice interface.
- Condition — applies when: The target user population already uses WhatsApp regularly in a professional or semi-professional context; mobile data availability is sufficient for voice note transmission.

**4. Retrieval-confidence threshold triggering human escalation, not blanket human review**

- Dimension: Solution
- Sub-category: A. AI Fit and Comparative Advantage
- Stage: Define
- Also relevant at: Pilot
- Type: Strategic Decision
- Decision: Route questions to human nurse-midwives only when retrieval confidence falls below a threshold; send LLM-drafted answers directly when confidence is sufficient, with post-hoc doctor review of a weekly sample.
- Alternative considered: Human review of every answer before it reaches the CHW (synchronous review gate).
- Why: A synchronous review gate would make response time dependent on nurse-midwife availability — the exact failure mode the system is designed to replace. Confidence-based routing preserves speed for high-confidence answers while maintaining a human backstop for genuinely uncertain ones. Post-hoc sampling by doctors provides a quality signal without blocking delivery.
- What this looked like here: Five nurse-midwives per block participate in escalation; a majority of three is required before the escalated answer is returned. This is the design; no pilot data yet validates whether the threshold, the majority rule, or the nurse-midwife response rate performs as intended.
- Condition — applies when: The knowledge domain is well-bounded enough that a retrieval-confidence score is a meaningful proxy for answer quality; enough human escalation capacity exists to handle the expected low-confidence volume without creating a new queue.
- Before → After: Not documented in the source — no pilot data available.

**5. Doctor-curated knowledge base as the ground-truth layer**

- Dimension: Solution
- Sub-category: D. Data and Knowledge Readiness
- Stage: Define
- Type: Tactical Decision
- Decision: Restrict the retrieval layer to a knowledge base curated by two doctors, reviewed and updated weekly, rather than allowing the LLM to draw on general medical knowledge.
- Alternative considered: General LLM knowledge without a curated retrieval layer.
- Why: For a safety-critical health use case, the scope of permissible answers must be bounded by clinical review, not by what the model was trained on. Curation also makes the knowledge base auditable — a harmful answer can be traced to a specific document and corrected.
- What this looked like here: Doctors review a weekly sample of sent answers and update the knowledge base based on what they find. The cadence and process for resolving a knowledge base error urgently (i.e., before the next weekly review) are not documented.
- Condition — applies when: The question domain is narrow enough to be covered by a maintained knowledge base; clinically qualified reviewers are available on a recurring basis.

---

### Institution

**6. Sustainability deferred to pilot without a named owner**

- Dimension: Institution
- Sub-category: F. Operating Model and Sustainability
- Stage: Explore
- Also relevant at: Define
- Type: Strategic Decision
- Decision: Defer the sustainability conversation with the state health mission until the pilot phase, rather than seeking a commitment at grant stage.
- Alternative considered: Seeking an early letter of intent or in-principle funding commitment from the state health mission before the pilot begins.
- Why: Not documented in the source. The grant proposal notes the deferral without explaining the reasoning — it may reflect a view that pilot evidence is needed before a government body will engage seriously, or simply that the conversation has not been initiated.
- What this looked like here: Running costs (model usage, knowledge base maintenance) are identified as the items to be discussed. No named contact at the state health mission, no timeline, and no trigger condition for the conversation are recorded.
- Condition — applies when: This decision pattern (defer to pilot) is most common — and most risky — when no champion inside the government body has already expressed interest. If no one is waiting for the pilot results, deferral becomes indefinite.

---

### Ecosystem

**7. Nurse-midwife escalation layer designed without nurse-midwife input**

- Dimension: Ecosystem
- Sub-category: A. Partner Architecture and Roles
- Stage: Define
- Type: Failure and Fix
- Failure: The design note records that nurse-midwives were intended to provide design input on the escalation flow, but this was not scheduled due to time constraints. The escalation interface, reply format, expected workload per nurse-midwife, and incentive to respond were all designed without input from the people who must operate the layer.
- Fix: Not documented in the source — the design note records the gap but does not describe a remediation plan before pilot launch.
- Insight: An escalation layer that depends on a specific partner group's willingness and capacity to respond is a partnership design problem, not just a technical one. When that group's input is absent from design, workload and interface assumptions are unvalidated — the most common cause of escalation layers failing to operate as designed once live.
- Condition — applies when: The system's performance on low-confidence queries depends on a named group of external actors responding within a defined time window; that group was not involved in designing the expectations placed on them.

**8. Two-organisation delivery model with distinct roles**

- Dimension: Ecosystem
- Sub-category: A. Partner Architecture and Roles
- Stage: Explore
- Type: Tactical Decision
- Decision: Assign the technical build and evaluation to the research lab, and field work and district health office relationships to the NGO — a clean role split rather than a shared or blended model.
- Alternative considered: Not documented in the source.
- Why: The split matches each organisation's existing capability and relationships. The lab has technical depth; the NGO has community trust and institutional relationships. A blended model with shared ownership of both functions typically produces slower decisions and unclear accountability.
- What this looked like here: The district health office relationship is held by the NGO, not by the lab — meaning the institutional relationship that would matter most for sustainability sits with the field organisation, not the technical one.
- Condition — applies when: Two distinct organisations each have a clear comparative advantage in non-overlapping parts of the delivery; the handoff points between their roles are well-defined before building begins.

---

## Section 4 — Toolkits and playbooks

No reusable resources documented.

---

## Section 6 — Retrieval guide

- *"How did they decide which questions the system would answer?"* → Unit 1
- *"Why WhatsApp instead of a dedicated app?"* → Unit 3
- *"How does the escalation to nurse-midwives work?"* → Unit 4
- *"What stops the LLM giving a harmful medical answer?"* → Unit 5
- *"How did they recruit health workers for the pilot?"* → Unit 2
- *"Who curates the knowledge base and how often is it updated?"* → Unit 5
- *"How is sustainability planned — who pays after the grant?"* → Unit 6
- *"What happens when the nurse-midwives don't respond to escalations?"* → Unit 7
- *"Who is responsible for field relationships vs. technical build?"* → Unit 8
- *"What are the biggest unresolved risks before the pilot?"* → Section 2 gaps, Units 6, 7
- *"How were design decisions validated with end users?"* → Unit 7 (and Section 2, gap 5)
- *"What does a failed pilot look like for this deployment?"* → Section 2, gap 1

---

---

## Source Trace appendix

*Contributor-facing only — not surfaced in adopter-facing responses.*

| Source file | Covers | Notes |
|---|---|---|
| 01-grant-proposal.md (project month 0) | Section 1 — all identity fields; Unit 1 (Persona/Explore); Unit 6 (Institution/Explore); Unit 8 (Ecosystem/Explore); Section 2 gaps 4, 5 | Primary source. Synthetic test document as noted in file header. |
| 02-design-note.md v1.2 (project month 3) | Unit 2 (Persona/Define); Unit 3 (Solution/Explore); Unit 4 (Solution/Define); Unit 5 (Solution/Define); Unit 7 (Ecosystem/Define); Section 2 gaps 1, 2, 3, 5, 6 | Primary source. Synthetic test document as noted in file header. Adds all design-stage architecture and the nurse-midwife escalation detail not present in the grant proposal. |
| Adoption Companion conversation (October 22, 2026, 10:30 AM) | Stage confirmation (Define); meta fields in Section 1 | Contributor's own account; confirms stage. No new facts beyond what the uploaded documents establish. |