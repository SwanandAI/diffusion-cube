---
title: Dooru Mitra
description: A multilingual complaint-classification and routing system for Rajapura City Municipal Corporation, replacing hand-sorting at a central call centre and cutting median time-to-officer from 3.2 days to 0.9 days across six pilot wards.
stage: Pilot
sector: Urban governance / civic services
location: Rajapura, Karnataka, India
tags: [Citizen Grievance, Multilingual NLP, Voice AI, Municipal Services]
---

# Dooru Mitra

## Section 0 — Reading guide

This document is written for the next team attempting something like this — a city that receives complaints at volume across multiple channels and languages, suspects its routing is slower and less reliable than it should be, and is deciding whether an AI classifier is the right tool.

The document is organised by four dimensions (Persona, Solution, Institution, Ecosystem) and four stages (Explore, Define, Pilot, Scale). You can read it straight through or navigate to the dimension and stage most relevant to your immediate question. Section 6 maps common adopter questions directly to the units where the answers live.

Value concentrates in the micro-innovations in Section 3. Each unit records a real decision, what the alternative was, why the choice was made, and what changed because of it. Units typed Failure and Fix are the ones most worth reading before you make the same mistake.

The reusable artifacts — the category taxonomy, labelling guidelines, test set, cost model, scorecard workbook, and others — are listed in Section 4. Each is described in Section 3 first. None are attached to this document; the contributor has been asked to share them separately.

---

## Section 1 — Pathway identity

| Field | Detail |
|---|---|
| Deployment name | Dooru Mitra |
| Sector | Urban governance / civic services |
| Geography | Rajapura, Karnataka, India |
| Population served | Citizens lodging complaints with Rajapura City Municipal Corporation (RCMC), across phone/IVR, SMS, and ward office counters; in Kannada, English, and mixed Kannada–English |
| Stage reached | Pilot (Scale decision approved, expansion not yet executed as of June 2025) |
| Contributing organisation | Nagarika Labs (implementing partner); Setu Foundation (funder); Rajapura City Municipal Corporation (deploying institution) |
| Key dates | January 2024: project start; August 2024: design approval by steering committee; October 2024: pilot launch (6 wards); February 2025: pilot close; March 2025: independent evaluation published; June 2025: 30-ward expansion approved |
| Summary | Dooru Mitra classifies citizen complaints received by RCMC and routes each to the ward officer and department responsible for it. Before the system, complaints were sorted by hand at the central call centre with no shared definitions, producing 27% misrouting and a 3.2-day median delay. The pilot ran in 6 of 198 wards from October 2024 to February 2025. Overall accuracy reached 88% and misrouting fell to 9%, but voice complaints — 31% of volume — came in at 71% accuracy, well below threshold. The steering committee approved expansion to 30 wards in June 2025, conditional on a voice fix and a redesigned return route. |
| Scale / impact achieved | 6 pilot wards; ~11,000 complaints per month across RCMC (pilot ward share not stated); median time-to-officer: 3.2 days → 0.9 days; misrouting: 27% → 9%. As of June 2025. |
| Cost anchor | Projected running cost ₹1.90 per complaint at 30 wards; ₹1.10 at 198 wards; compared with ₹6.40 per complaint for manual sorting. Largest single component at scale: SMS/IVR gateway (not model hosting). Vendor rates redacted from shared cost model. As of June 2025. |
| Build effort | January 2024 – June 2025 (18 months to pilot close and scale decision). Team includes Nagarika Labs (project lead, data, field coordination), RCMC IT Cell, Setu Foundation, Prakriya Research (independent evaluation), VaniConnect (gateway). Partner count: at least 4 named organisations. |
| Known downstream adopters | None documented in the source. Setu Foundation has initiated a share-back process with its urban governance network; sharing list under preparation as of July 2025. |
| Scope / does-not-transfer-when | Category taxonomy and routing matrix are tightly coupled to RCMC's departmental structure; another city must remap to its own departments before use. Boundary-case labelling examples are assessed as more directly transferable than the category list itself. Gateway cost line should be rebuilt from locally quoted rates; hosting and staffing lines are assessed as more portable. |

---

## Section 2 — Coverage grid and open questions

### Coverage grid

| | Explore | Define | Pilot | Scale |
|---|---|---|---|---|
| **Persona** | ●●● | ●● | ●● | ● |
| **Solution** | ●●● | ●●● | ●●● | ●● |
| **Institution** | ●● | ●●● | ●●● | ●● |
| **Ecosystem** | ● | ●●● | ●● | ●● |

●●● rich coverage · ●● partial · ● sparse · ○ not documented

### Open questions

**1. Why did Wards 19 and 70 bypass the return route — and does the answer change how new wards are onboarded?**
The pilot found that officers in these two wards forwarded misrouted complaints by WhatsApp rather than using the reason-code return route. Prakriya could not establish whether training differed; Meena Hegde (field coordinator) reported delivering the same session in all six wards. The root cause — workflow friction, local norm, ward culture, or something else — is undocumented. The 30-ward expansion is conditional on redesigning the return route for speed, but if the cause is not friction alone, a faster route may not be sufficient. Relates to Unit 7.

**2. What is the voice fix, and has it been validated before new wards go live?**
The steering committee made expansion conditional on a voice fix being in place. The fix is not described in any source document. Voice accuracy at 71% was traced primarily to transcription of place names and colloquial terms, but Prakriya noted it could not cleanly separate transcription error from classifier error. Whether the fix addresses transcription, the classifier, or both — and how it will be tested — is not documented. Relates to Units 6 and 8.

**3. Who is the named person responsible for the routing matrix in the IT Cell?**
Meeting 3 (August 2024) carried this as an open action. The completion report notes the matrix changed eleven times during the pilot as officers were transferred, and that naming an owner from the start is listed under "what we would do differently." Whether a named owner exists as of June 2025 is not documented. Relates to Unit 5.

**4. Will the handover playbook be completed before 30-ward expansion?**
The handover playbook covering retraining, relabelling, and routing matrix maintenance was not completed before the grant closed. Farhan Sheikh (IT Cell) reported writing parts himself as he goes. Whether it will exist before new wards go live is not documented. Relates to Unit 9 and the gap in Institution × Scale.

**5. What is the ward officer training budget for the 30-ward expansion?**
The Additional Commissioner confirmed gateway and hosting costs move to the IT Cell budget line. The steering committee noted that ward officer training costs for new wards had not been included and needed to be raised with Finance. Resolution is not documented. Relates to Institution × Scale coverage.

---

## Section 3 — Micro-innovations

### Persona

**1. Defining the problem as routing delay, not resolution time**

- **Dimension:** Persona
- **Stage:** Explore
- **Type:** Strategic Decision
- **Decision:** Scope the intervention to the delay between a complaint being lodged and the responsible officer seeing it — not to resolution time once seen.
- **Alternative considered:** Not documented in the source. The scoping is stated as RCMC's brief to Nagarika Labs, not as a choice made between competing framings.
- **Why:** The bottleneck RCMC could actually fix with a classifier was the routing step. Resolution time depends on officer capacity, department processes, and political factors outside the system's control. Scoping to the wrong outcome would have made the system look like it was failing at things it was never designed to affect.
- **What this looked like here:** RCMC's brief was explicit: the problem was the delay between lodging and the right officer seeing the complaint, not what happened after. This scoping held throughout — the pilot evaluation measured time-to-officer, not time-to-resolution.
- **Condition — applies when:** The institution can identify a specific, measurable bottleneck in the complaint journey that AI can address, and is willing to hold the system accountable only for that bottleneck.
- **Before → After:** Before: the framing risked measuring success against resolution time, which the system cannot control. After: pilot success criteria were time-to-officer and misrouting rate — both within the system's actual scope.

---

**2. Channel assumption corrected before build**

- **Dimension:** Persona
- **Stage:** Define
- **Type:** Strategic Decision
- **Decision:** Redesign the channel mix assumption to treat voice as a primary channel requiring explicit design attention, not a minor supplement to SMS.
- **Alternative considered:** Proceeding with the original design, which assumed SMS would be the main channel.
- **Why:** Call centre data gathered between the January exploratory meeting and the August 2024 design review showed voice was close to a third of complaint volume. Building primarily for SMS and treating voice as secondary meant that 31% of real users would encounter a system not designed for them.
- **What this looked like here:** The steering committee noted the change at the August 2024 meeting and approved the design to proceed with voice to be addressed in the pilot — meaning it was acknowledged but not fully resolved before build. This deferred decision became the pilot's main failure.
- **Condition — applies when:** Channel volume data is available before architecture is finalised. If it is not, collecting it should be a Define-stage prerequisite.
- **Before → After:** Before: design assumed SMS primary, voice peripheral. After: voice was flagged as requiring dedicated attention — though the attention came too late, in the pilot rather than in the training data.

---

### Solution

**3. Rules-only router tested and rejected before classifier build**

- **Dimension:** Solution
- **Stage:** Explore
- **Type:** Strategic Decision
- **Decision:** Test a rules-only keyword router against historical complaints before committing to a machine-learning classifier, and move to the classifier only when the rules approach demonstrably failed.
- **Alternative considered:** Proceeding directly to a fine-tuned multilingual classifier without testing the simpler option.
- **Why:** A rules-only router is cheaper to build, easier to audit, and requires no labelled training data. If it had worked, it would have been the right tool. Testing it first meant the decision to use a classifier was based on evidence — 61% accuracy on 2,000 historical complaints, mostly failing on mixed-script and colloquial descriptions — rather than assumption.
- **What this looked like here:** Nagarika ran a two-week test on 2,000 historical complaints. The 61% accuracy figure and the failure mode (mixed-script and colloquial text) were what determined the move to a fine-tuned multilingual classifier with a small rules layer for policy-fixed categories (e.g. dog-bite complaints always go to Health).
- **Condition — applies when:** Historical complaint data exists in sufficient volume to run a meaningful test. Two weeks and 2,000 complaints was sufficient here to surface the failure mode clearly.
- **Before → After:** Before: no evidence base for the architectural choice. After: the classifier decision was grounded in a documented failure of the simpler alternative, which made the choice defensible to the institution and auditable later.

---

**4. Taxonomy co-produced with department heads before labelling began**

- **Dimension:** Solution
- **Stage:** Define
- **Type:** Playbook
- **Playbook:**
  1. Convene department heads (not IT staff) across six working sessions to define what the complaint categories are, including definitions, inclusion and exclusion notes, and the responsible department for each.
  2. Do not begin labelling until the category list is agreed and documented. The taxonomy is the labelling standard — labelling before the taxonomy is fixed produces inconsistent data.
  3. Write labelling guidelines with worked examples covering the hard boundary cases. Paraphrase examples so no complainant is identifiable.
  4. Train labellers on the guidelines before they touch the corpus. Use call centre staff who already know the complaint types.
  5. Do not treat the taxonomy as fixed after labelling begins. Expect consolidation: categories that labellers and officers cannot reliably tell apart in practice should be merged. Document each merge and its reason.
- **Note:** The most common failure mode is beginning labelling with a provisional category list and discovering mid-way that two categories are not reliably distinguishable. Here, 22 categories were consolidated to 18 during the pilot for exactly this reason. Running a small labelling test before committing to the full corpus would surface this earlier.
- **Condition — applies when:** The institution has multiple departments with overlapping complaint types and no shared definitions. The process is most important where the same physical complaint (e.g. a blocked drain) could legitimately go to more than one department depending on interpretation.
- **Before → After:** Before: call centre staff assigned complaints using informal judgement with no shared definitions, producing high inter-rater disagreement. After: the taxonomy and guidelines reduced this enough to make labelling consistent across four labellers working on 38,000 complaints.

---

**5. Training data matched to text channel, not to live channel mix**

- **Dimension:** Solution
- **Stage:** Pilot
- **Type:** Failure and Fix
- **Failure:** The classifier was trained on 38,000 labelled complaints drawn almost entirely from SMS and counter text. Voice transcripts were under 4% of training data. In live operation, voice/IVR was 31% of volume. Voice accuracy in the pilot was 71%, against 92% for SMS and 94% for counter. Most voice errors traced to transcription of place names and colloquial terms — the classifier had not encountered these forms at training.
- **Fix:** After the pilot, 150 IVR transcripts that the model got wrong were added to the adversarial test set, expanding it from 600 to 750 examples. A dedicated voice fix is a condition of the 30-ward expansion. The nature of that fix is not documented in the source.
- **Insight:** Training data must reflect live channel mix, not data availability. SMS and counter text is easier to collect and cleaner to label — which is exactly why it will dominate a training corpus if no one actively corrects for it. Voice transcripts are harder to collect, noisier, and raise additional consent and privacy questions, but if voice is a significant share of volume, the model will be deployed into a distribution it has not seen.
- **Condition — applies when:** A system receives input across multiple channels with meaningfully different linguistic registers. The gap between training distribution and live distribution is a direct predictor of performance disparity across those channels.

---

**6. Confidence floor added to catch out-of-remit complaints**

- **Dimension:** Solution
- **Stage:** Pilot
- **Type:** Failure and Fix
- **Failure:** Pre-exposure testing revealed that the model forced every complaint into one of the 22 categories, including complaints about matters outside RCMC's remit (electricity supply, which is a state utility). There was no mechanism to decline classification.
- **Fix:** An "outside RCMC remit" category was added, and a confidence floor was implemented below which complaints route to a human at the call centre rather than to a ward officer.
- **Insight:** A classifier with no abstention mechanism will always produce an answer, including for inputs it should not answer. In a public grievance context, a confident wrong routing is worse than an acknowledged non-answer — it consumes officer time and erodes trust in the system. The confidence floor is the enforcement mechanism for the system's own scope boundary.
- **Condition — applies when:** The institution receives complaints that fall outside its mandate, and there is a human backstop (here, the call centre) capable of handling the overflow. Without the human backstop, a confidence floor alone does not resolve the case.

---

### Institution

**7. Misrouting SOP framed as officer workflow, not system error**

- **Dimension:** Institution
- **Stage:** Pilot
- **Also relevant at:** Scale
- **Type:** Strategic Decision
- **Decision:** Frame the misrouting correction process as a normal part of the officer's workflow — "what to do when a complaint reaches you by mistake" — rather than as error reporting or feedback to the technology team.
- **Alternative considered:** Not documented in the source. The framing choice is implicit in the SOP's title and the training materials' focus.
- **Why:** Officers who see the return-with-reason-code route as a correction mechanism for the AI system have little personal stake in using it consistently. Officers who see it as their own professional tool for managing their caseload correctly are more likely to use it. The reason codes also feed relabelling, so consistent use has a compounding benefit for the system — but that benefit does not need to be the officer's motivation.
- **What this looked like here:** The one-page SOP was titled *What to do when a complaint reaches you by mistake* and focused on the officer's action, not on the system's error. Training materials (flip chart and video) similarly emphasised what the system gets wrong and how the officer handles it, not how the classifier works.
- **Condition — applies when:** The correction mechanism depends on frontline workers who have no direct stake in model performance. Framing matters most where the alternative (informal forwarding by phone or messaging app) is faster and easier than the formal route.
- **Before → After:** Before: no formal return route existed; misrouted complaints were bounced informally between offices. After: four of six pilot wards used the reason-code route consistently. Two wards did not, and the reason is not established — the SOP framing alone was not sufficient.

---

**8. Staged pre-exposure testing before any real complaint was routed**

- **Dimension:** Institution
- **Stage:** Pilot
- **Type:** Playbook
- **Playbook:**
  1. Compile an adversarial test set covering the known hard cases: abusive messages, heavy dialect, mixed-script text, out-of-remit complaints, and attempts to route to a named officer. Start with 600 complaints; add to it after each round.
  2. Run round 1 internally with the implementation team. Gate: do not proceed to round 2 until the team agrees the system handles the hard cases acceptably.
  3. Run round 2 with call centre staff (here: 12 staff). Gate: do not proceed to round 3 until call centre staff can identify which failure types remain and what the response to each should be.
  4. Run round 3 with ward staff across all pilot wards (here: 30 staff). Gate: no real complaint is routed until this round clears.
  5. Use failures identified in each round to update the model, the confidence floor, or the category list before advancing.
- **Note:** The most consequential finding here came in round 3: the out-of-remit gap, which led to the addition of an "outside RCMC remit" category and the confidence floor. Earlier rounds had not surfaced it clearly enough to act on. Do not treat round 3 as a check on rounds 1 and 2 — it surfaces different failure modes because the tester population is different.
- **Condition — applies when:** The system will make consequential routing decisions on behalf of citizens before any human reviews them. The gate structure is most important where a confident wrong answer has a real cost — here, a complaint sitting in the wrong officer's queue for days.
- **Before → After:** Not documented in the source for individual rounds. The adversarial test set expanded from 600 to 750 after the pilot, incorporating the voice failures the live deployment revealed — the process continues after go-live.

---

**9. Code ownership placed with RCMC from the start**

- **Dimension:** Institution
- **Stage:** Define
- **Type:** Strategic Decision
- **Decision:** Place the classifier code in RCMC's own GitHub organisation from the outset, with the department holding the code under the implementation agreement.
- **Alternative considered:** Not documented in the source.
- **Why:** If the implementing partner holds the code, the institution's ability to maintain, audit, retrain, or transfer the system depends on the implementing partner's continued involvement and goodwill. Placing the code with RCMC from the start means a future retraining, a vendor change, or a legal review can proceed without needing the implementing partner's cooperation.
- **What this looked like here:** The completion report states this as a fact about the agreement, not as a contested decision. The open-sourcing of the classifier code remained under Legal review as of June 2025 — whether it will be shared with other cities has not been decided.
- **Condition — applies when:** The institution has, or intends to build, internal technical capacity to maintain the codebase. Code ownership without the capacity to use it is a governance formality rather than a real capability.

---

### Ecosystem

**10. Data sharing MoU with State e-Governance Mission negotiated before build**

- **Dimension:** Ecosystem
- **Stage:** Define
- **Type:** Strategic Decision
- **Decision:** Formalise access to the integrated grievance portal feed through a signed data sharing MoU with the State e-Governance Mission before building the pipeline that depends on it.
- **Alternative considered:** Not documented in the source.
- **Why:** An informal arrangement with an external data source creates a dependency that can be withdrawn or disrupted at any point. A signed MoU establishes that the feed is an accountable commitment, not a courtesy. It also creates a template that other urban local bodies can adapt — the unsigned version with the State schedule removed was offered to other cities on request.
- **What this looked like here:** The MoU was signed by the August 2024 design approval meeting. The Legal Advisor noted at that meeting that the unsigned template could be given to other urban local bodies, several of which had already asked for it.
- **Condition — applies when:** The system depends on data from an external government body. The MoU template's transferability is conditional on the receiving city having a comparable State e-Governance Mission structure — cities in states without an equivalent body would need to identify a different counterpart or data source.

---

## Section 4 — Toolkits and playbooks

| # | Title | Type | Reuse condition |
| --- | --- | --- | --- |
| 4 | Complaint category taxonomy and labelling guidelines | Toolkit Asset | Remap category list to your own departmental structure before use; boundary-case examples transfer more directly than categories. See Unit 4. |
| 4 | Labelling guidelines with 140 worked examples | Toolkit Asset | Paraphrase examples so no complainant is identifiable; examples covering hard boundary cases are the most portable part. See Unit 4. |
| 5 | Adversarial pre-exposure test set (750 complaints) | Toolkit Asset | Voice transcripts contain place names; check before sharing outside RCMC. Add your own hard cases before use — the set reflects RCMC's specific failure modes. See Unit 8. |
| 6 | Cost model (vendor rates redacted) | Toolkit Asset | Rebuild the gateway line from locally quoted rates; hosting and staffing lines are more portable. See Section 1 cost anchor. |
| 7 | Weekly scorecard workbook (accuracy, misrouting, time-to-officer by category/ward/channel) | Toolkit Asset | Replace the category sheet with your own taxonomy; formulas do not depend on number of categories. See Unit 8. |
| 8 | Misrouting SOP — What to do when a complaint reaches you by mistake | Toolkit Asset | Reframe officer actions for your own routing logic and reason codes before use. See Unit 7. |
| 9 | Data dictionary for complaint record fields | Toolkit Asset | Directly transferable to any urban local body with the "ward stored three ways" problem; remap field names to your call centre software. See Section 1. |
| 10 | Data sharing MoU template (State e-Governance Mission, schedule removed) | Toolkit Asset | Available to other urban local bodies on request from RCMC; applicable where a comparable State e-Governance Mission structure exists. See Unit 10. |
| 8 | Staged pre-exposure testing playbook | Playbook | Use where the system makes consequential routing decisions before human review; gate structure is most important where a wrong answer has a real downstream cost. See Unit 8. |
| 4 | Complaint category co-production playbook | Playbook | Use where the institution has multiple departments with overlapping complaint types and no shared definitions. See Unit 4. |

---

## Section 5

*Not included. Failure and Fix units in Section 3 cover this material.*

---

## Section 6 — Retrieval guide

*"How do we decide whether to use a classifier or simpler rules?"* → Unit 3

*"How do we build the category list before labelling?"* → Unit 4

*"Our voice accuracy is worse than SMS — why, and what do we do?"* → Unit 5

*"The model keeps classifying things outside our remit — how do we handle that?"* → Unit 6

*"Ward officers aren't using the feedback route — what can we do?"* → Unit 7, Unit 1

*"How do we test before going live with real users?"* → Unit 8

*"Who should own the code — us or the implementing partner?"* → Unit 9

*"We need data from a state agency — how do we formalise that?"* → Unit 10

*"How do we scope what the system is responsible for?"* → Unit 1

*"The original design assumed a channel that turned out not to be dominant — how should we have caught that?"* → Unit 2, Unit 5

*"What should we include in the pre-exposure test set?"* → Unit 8

*"How do we set pilot success thresholds?"* → Units 3 and 8 (for process); Section 1 (for RCMC's specific thresholds)

*"What does the system cost at scale?"* → Section 1 cost anchor; Unit 6 (cost model as toolkit asset)

*"Can we share our labelled data with other cities?"* → Unit 9, Section 1 (scope/does-not-transfer-when)

*"How do we get a data feed from the state grievance portal?"* → Unit 10

*"What training materials worked for ward officers?"* → Unit 7

*"Who should own the routing matrix?"* → Section 2 open question 3; Unit 4 (playbook step on named ownership)

---

---

## Source Trace appendix

*Contributor-facing only — not surfaced in any adopter-facing response.*

| Source file | Covers | Notes |
|---|---|---|
| 01_completion-report_nagarika-labs.md (30 June 2025) | Section 1 — all identity fields except independent evaluation findings; Section 3 Units 1, 2, 3, 4, 5, 6, 7, 9; Section 4 rows for taxonomy, labelling guidelines, test set, cost model, data dictionary, misrouting SOP; Section 2 open questions 1, 3, 4 | Primary source. Covers build rationale, data approach, pilot approach, cost model, and what-we-would-do-differently. Vendor rates redacted from cost model. |
| 02_pilot-evaluation_prakriya-research.md (March 2025) | Section 1 — scale/impact figures, accuracy and misrouting numbers; Section 3 Units 5, 6, 7, 8; Section 4 rows for scorecard workbook, baseline survey instrument, consent notice; Section 2 open questions 1, 2 | Primary source for pilot outcomes. Independent of Nagarika Labs. Confirms and extends completion report on voice accuracy failure and ward uptake disparity. Prakriya scorecard workbook and evaluation report are Prakriya's own — RCMC/Nagarika to confirm sharing rights before circulation. |
| 03_steering-committee-minutes_rcmc.md (meetings of 22 August 2024 and 18 June 2025) | Section 1 — key dates, scale decision, budget line confirmation; Section 3 Units 2, 9, 10; Section 4 MoU template row; Section 2 open questions 3, 5 | Primary source for institutional decisions, governance process, and conditions attached to scale approval. Confirms channel mix correction (Unit 2) and code/data ownership decisions (Units 9, 10). |
| 04_email-thread_lessons-for-share-back.md (3–5 July 2025) | Section 1 — downstream sharing status; Section 2 open question 1 (Ward 19/70 framing from Meena Hegde); Section 4 — confirms shareable status of taxonomy (18-category version), labelling guidelines, cost model (Annex D); flags non-shareability of voice transcripts (place names) and ward officer video (consent); flags handover playbook as not completed | Contributor-facing internal thread. Confirms and adds nuance to completion report on shareable artifacts. Not independently verified — treat as contributor's own account. Annex D (cost model) confirmed shareable as-is with vendor rates already redacted. |