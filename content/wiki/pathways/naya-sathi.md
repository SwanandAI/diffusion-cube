---
title: Nyaya Saathi
description: A Hindi/Marathi voice-and-text legal guidance assistant for women experiencing domestic violence in urban and peri-urban India, where shared phone access — not literacy — proved the binding constraint.
stage: Pilot
sector: Legal Aid
location: Urban and peri-urban India
tags: [Domestic Violence, Voice AI, Safety-by-Design, Assisted Use]
---

# Nyaya Saathi

## Section 0 — Reading guide

This document is written for the next team considering an AI-assisted legal guidance tool for a population with restricted private device access. It is not a case study of what was built; it is a record of what was learned, so the next adopter can start from here rather than from scratch.

Where knowledge is dense — the shared-phone threat model, the safety feature set, the pivot from self-use to assisted use — units are specific enough to reuse directly. Where knowledge is thin or absent — ecosystem partnerships, cost data, the sustained assisted-use model — the gaps are flagged explicitly so the next adopter knows what to go find rather than what to assume.

Navigate by the retrieval guide in Section 6 if you have a specific question. Navigate by the coverage grid in Section 2 if you want to see where this pathway's evidence is strong and where it runs out.

---

## Section 1 — Pathway identity

| Field | Value |
|---|---|
| Deployment name | Nyaya Saathi |
| Sector | Legal aid / domestic violence |
| Geography | Urban and peri-urban India |
| Population served | Women experiencing domestic violence, Hindi- and Marathi-speaking |
| Stage reached | Pilot |
| Contributing organisation | Indian NGO (name not documented in the source) |
| Key dates | First users: approximately project month 7. Pilot paused: project month 12. Document as of: October 26, 2026 |
| Summary | Nyaya Saathi is a Hindi/Marathi voice-and-text legal guidance assistant built for women experiencing domestic violence who cannot afford legal advice. Approximately 2,000 women used it during the pilot. The team discovered that shared phone access — not literacy — was the binding constraint, paused the pilot at month 12, and is rebuilding around a paralegal-assisted use model. |
| Scale achieved | ~2,014 women used the tool at least once during the pilot; 806 returned for a second session (40% return rate); 71% of sessions used voice input. As of October 26, 2026. |
| Cost anchor | Not documented in the source |
| Build effort | Part-time NGO team, foundation-funded, approximately 7 months from start to first users, 16 months total to pause decision. Team size and partner count not documented in the source. |
| Known downstream adopters | Not documented in the source |
| Scope / does not transfer when | Designed for women with access to a personal smartphone. The core safety architecture does not transfer when a user has no reliable private moment with any device — the redesign toward paralegal-assisted use addresses this, but that model is not yet documented. |

---

## Section 2 — Coverage grid and open questions

### Coverage grid

| | Explore | Define | Pilot | Scale |
|---|---|---|---|---|
| **Persona** | ●●● | ●● | ●●● | ○ |
| **Solution** | ●● | ●●● | ●●● | ○ |
| **Institution** | ●● | ●● | ●●● | ○ |
| **Ecosystem** | ○ | ● | ● | ○ |

*●●● strong coverage · ●● partial coverage · ● thin coverage · ○ not documented*

### Open questions

1. **What does the paralegal-assisted use model look like in practice, and how is it governed?** The pivot to assisted use is documented as a decision (Unit 7), but how paralegals are trained, how the tool is integrated into helpline calls, and who holds content authority in the new model are not yet documented. Relevant to Institution/Define and Ecosystem/Define before the next build begins.

2. **What are the actual cost-per-interaction figures?** No cost data appears in the source. Any team evaluating whether to replicate this needs an order-of-magnitude figure for foundation-funded NGO deployment in this sector.

3. **What ecosystem agreements are in place or needed?** No data partners, technology vendors, or delivery infrastructure partners are named in the source. The Ecosystem dimension has almost no coverage at any stage. Before a next adopter proceeds to Define, they need to know which external dependencies existed for Nyaya Saathi and whether any are reusable.

4. **What triggered the 60% non-return rate specifically — phone-checking fear, or also content gaps?** The interview synthesis attributes non-return primarily to the shared-phone threat (Unit 5). The analytics note the return rate as the concern, but whether content gaps or wrong legal information also contributed is not documented. Relevant to Persona/Define and Solution/Pilot.

5. **How was content accuracy governed — who approved what the system said?** The programme committee is named as the decision authority (Unit 6), but who held content authority — who approved the legal guidance itself — is not documented in the source. This is a gap in Institution/Define.

6. **What is the plan for sustaining the redesigned service?** The pilot was foundation-funded and part-time. No budget line, recurring funding model, or named operational owner for the assisted-use rebuild is documented. Relevant to Institution/Scale and Ecosystem/Scale.

---

## Section 3 — Micro-innovations

### Persona

**1. Starting threat modelling before building the persona definition**

- **Dimension:** Persona
- **Stage:** Explore
- **Type:** Strategic Decision
- **Decision:** Conduct a structured risk workshop with legal aid staff and survivors' advocates before finalising the product definition — treating risk identification as input to persona definition, not a later compliance step.
- **Alternative considered:** Not documented in the source.
- **Why:** Women experiencing domestic violence face compounding risks from seeking help. The workshop surfaced the abuser-finds-the-chat risk and the literacy assumption before any design work began — both shaped the product spec directly. Without this, the team would likely have built a standard chat interface and discovered the threat model only in the pilot.
- **What this looked like here:** A project month 1 workshop with two survivors' advocates and legal aid staff produced a ranked list of harm scenarios and a set of design mandates — auto-delete, disguised icon, voice input — before the product specification was written.
- **Condition — applies when:** The population faces active monitoring or surveillance from people in their household; the cost of discovery by a third party is physical harm, not embarrassment or inconvenience.

---

**2. Predicting literacy as the main barrier — and being wrong**

- **Dimension:** Persona
- **Stage:** Explore
- **Also relevant at:** Pilot
- **Type:** Failure and Fix
- **Failure:** The team predicted literacy would be the main barrier to use, based on assessments of the population. Voice input was prioritised on that basis. In practice, 71% of sessions used voice — literacy was not limiting use for those who came. The binding constraint was shared phone access: 60% of users never returned, and 19 of 25 interviewed women cited their partner regularly checking their phone.
- **Fix:** Paused the pilot at month 12 and redesigned around paralegal-assisted use — women would use the tool with a trained paralegal during a helpline call, rather than installing it on their own phone.
- **Insight:** When the population faces active surveillance, the threat model is not about the individual's capabilities but about the device's exposure. Workaround research (who else holds the phone?) is a better predictor of adoption than capability research (can she read?) for this population.
- **Condition — applies when:** The target user shares a device with someone who may have hostile intent; the cost of discovery is high.

---

**3. Shared phone access as a binding constraint**

- **Dimension:** Persona
- **Stage:** Pilot
- **Type:** Failure and Fix
- **Failure:** Even with auto-delete and a disguised icon, 14 of 25 women interviewed feared notification previews appearing on the lock screen while the phone was in someone else's hand. Six feared an unfamiliar app being noticed. The safety architecture addressed post-session discovery but not real-time exposure.
- **Fix:** The product spec had already scoped out OS-level notification control as a v1 exclusion (S3 gap). The team accepted this as an unresolved constraint and incorporated it into the pivot decision — the shared-phone environment was not solvable at the app layer alone.
- **Insight:** Safety-by-design at the app layer does not fully address threat models where the device itself is monitored in real time. The OS notification gap (Unit 4) is a structural limit of self-installed app delivery for this population.
- **Condition — applies when:** The user's device is subject to real-time inspection by a hostile household member; app-layer safety features are necessary but not sufficient.

---

### Solution

**4. The OS notification gap: a known unresolved risk**

- **Dimension:** Solution
- **Stage:** Define
- **Also relevant at:** Pilot
- **Type:** Strategic Decision
- **Decision:** Explicitly scope out OS-level notification preview control as out of scope for v1, document it as a known gap, and proceed with the remaining safety features.
- **Alternative considered:** Not documented in the source; the spec records the exclusion but not what alternatives were evaluated.
- **Why:** Controlling what the phone's OS displays on the lock screen requires either OS-level integration or user configuration that the team could not reliably enforce. Scoping it out allowed the other safety features to proceed, while the gap was documented rather than ignored.
- **What this looked like here:** The product spec noted "Out of scope for v1: controlling how the phone's operating system shows notification previews" — a single line that became material when pilot interviews showed 14 of 25 women specifically feared notification previews.
- **Condition — applies when:** Deploying a safety-sensitive app to users whose devices are monitored by hostile household members; the gap is acceptable only if the delivery model does not rely solely on self-installed app use.

---

**5. Four-feature safety architecture as an integrated set**

- **Dimension:** Solution
- **Stage:** Define
- **Type:** Strategic Decision
- **Decision:** Design safety as a bundle of four interdependent features — auto-delete (S1), disguised icon (S2), quick exit (S3), and voice input (S4) — specified together before any technical build, with each feature addressing a distinct threat vector.
- **Alternative considered:** Not documented in the source.
- **Why:** Each feature addresses a different moment of exposure: S1 covers post-session discovery of chat history; S2 covers incidental phone-checking; S3 covers real-time discovery while the app is open; S4 reduces the need to produce visible text. Treating them as a bundle rather than independent features means the architecture reflects the threat model as a whole, not a list of independent improvements.
- **What this looked like here:** All four features appear in the product specification at project month 3, before any user-facing build. S4 (voice) also addressed the literacy concern the team had originally identified, giving it dual justification.
- **Condition — applies when:** The population faces a multi-vector threat from household surveillance; a single safety feature leaves other exposure points unaddressed.

---

### Institution

**6. Programme committee as content and pause authority**

- **Dimension:** Institution
- **Stage:** Pilot
- **Type:** Strategic Decision
- **Decision:** Vest the authority to pause the pilot — and implicitly to approve what the system does — in a programme committee, not the technical team.
- **Alternative considered:** Not documented in the source.
- **Why:** The decision to pause at month 12 was made by the programme committee on the basis of interview evidence, not a technical trigger. This placed accountability for user safety with the people holding institutional and legal-aid expertise, and meant the pause decision was made and documented formally rather than allowed to drift.
- **What this looked like here:** The pause decision note is authored by the programme committee and records the reason (interview evidence), the decision (pause, do not widen), and the next step (rebuild around assisted use). The knowledge content and voice features are explicitly preserved.
- **Condition — applies when:** The system gives guidance that could affect a user's safety or legal position; content authority and risk authority need to sit with domain experts, not the build team.

---

**7. Pausing rather than widening on a 40% return rate**

- **Dimension:** Institution
- **Stage:** Pilot
- **Type:** Strategic Decision
- **Decision:** Treat a 40% return rate combined with qualitative evidence of threat-model failure as sufficient grounds to pause and redesign — not to iterate features within the existing delivery model.
- **Alternative considered:** Continuing to widen the pilot while iterating on features; not documented whether this was formally considered.
- **Why:** The interview synthesis showed the constraint was structural — the delivery model (self-installed app on a shared phone) was incompatible with the threat model for a significant portion of the target population. Widening would have increased exposure without resolving the underlying problem.
- **What this looked like here:** The programme committee paused at month 12, explicitly stated "do not widen," and named a redesign direction (paralegal-assisted use) before the pilot closed.
- **Condition — applies when:** Pilot data shows the delivery model itself — not specific features — is the source of failure; continuing would scale the structural problem rather than test an iteration.

---

### Ecosystem

**8. Paralegals as the assisted-use delivery channel**

- **Dimension:** Ecosystem
- **Stage:** Pilot
- **Also relevant at:** Define
- **Type:** Strategic Decision
- **Decision:** Pivot the delivery model from self-installed app on a personal device to paralegal-mediated access during helpline calls — using existing trusted intermediaries rather than building a new direct channel.
- **Alternative considered:** Not documented in the source beyond the implicit alternative of continuing with direct user installation.
- **Why:** The shared-phone threat model cannot be resolved at the app layer alone (Unit 4). Paralegals already have the user's trust, operate in a context where phone-checking by the abuser is not a real-time risk, and hold the legal-aid expertise to contextualise the tool's output. The pivot repurposes the existing knowledge and voice infrastructure rather than discarding it.
- **What this looked like here:** Named in the month 12 pause decision as the next direction; not yet built or documented beyond the decision note.
- **Condition — applies when:** The population cannot use a self-installed app safely due to household surveillance; the deploying institution already operates a trusted intermediary channel with trained staff.

---

## Section 4 — Reusable resources

| # | Title | Type | Reuse condition | File |
| --- | --- | --- | --- | --- |
| — | [Pause decision note](/api/toolkit-assets/asset-950de435-0304-4c41-8e43-1fcae2eb6d92/download?preview=1) <!-- asset-id: asset-950de435-0304-4c41-8e43-1fcae2eb6d92 --> | Toolkit Asset | Reusable by any team facing a go/no-go decision on a legal aid or similar deployment; the criteria and context references should be updated to reflect the specific project's situation and geography. | [05-pause-decision-note.md](/api/toolkit-assets/asset-950de435-0304-4c41-8e43-1fcae2eb6d92/download) |

---

## Section 6 — Retrieval guide

*"How do I identify the real barrier to adoption before I build?"* → Unit 2, Unit 3

*"What safety features should a domestic violence legal tool have?"* → Unit 5

*"Why did women not come back to the tool?"* → Unit 3, Unit 4

*"How do I handle the OS notification risk on a safety-sensitive app?"* → Unit 4

*"Who should have authority to pause a pilot?"* → Unit 6

*"When should I pause rather than continue iterating?"* → Unit 7

*"How do I involve survivors or advocates in the design process?"* → Unit 1

*"What do I do when my threat model doesn't match my delivery model?"* → Unit 3, Unit 8

*"How do paralegals fit into a digital legal guidance service?"* → Unit 8

*"What does a shared-phone threat model mean for app design?"* → Unit 2, Unit 3, Unit 4, Unit 5

---

---
*Source Trace appendix — contributor-facing only, not surfaced in adopter responses*

| Source file | Covers | Notes |
|---|---|---|
| 01-risk-workshop-notes.md, project month 1 | Section 1 (population, geography, sector); Unit 1 (risk workshop decision); Unit 2 (literacy prediction); Unit 5 (voice and safety feature rationale) | Primary source for Explore-stage persona and solution framing |
| 02-product-spec.md, project month 3 | Unit 4 (OS notification gap); Unit 5 (four-feature safety architecture) | Primary source for Define-stage solution decisions |
| 03-usage-analytics.md, project month 10 | Section 1 (scale achieved: 2,014 users, 806 returning, 71% voice); Unit 2 (voice use rate); Unit 3 (return rate) | Primary source for Pilot-stage usage metrics |
| 04-interview-synthesis.md, project month 11 | Unit 2 (literacy prediction failure); Unit 3 (shared phone as binding constraint); Unit 4 (notification preview fear) | Primary source for Pilot-stage persona failure analysis |
| 05-pause-decision-note.md, project month 12 | Unit 6 (programme committee authority); Unit 7 (pause decision); Unit 8 (paralegal pivot) | Primary source for Pilot-stage institution and ecosystem decisions |
| 99-nyaya-saathi-interview.md, as of October 26, 2026 | Section 1 (all identity fields, build effort, NGO description); Units 1–8 (confirms and contextualises all units) | Confirms and adds narrative context; derivative of above documents for most factual claims; primary for Section 1 build effort and organisational description |