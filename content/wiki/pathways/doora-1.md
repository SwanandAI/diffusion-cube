---
title: Dooru Mitra
description: AI complaint classification and routing for a city municipal corporation, reducing median time-to-officer from 3.2 days to 0.9 days across six pilot wards.
stage: Pilot
sector: Urban governance / citizen services
location: Rajapura, India
tags: [Citizen Grievance, Municipal Services, Multilingual Classifier]
---

# Dooru Mitra

## Section 0 — Reading guide

This document is written for the next adopter — a city, municipal corporation, or urban governance team considering AI-assisted complaint routing. It records what was decided, what broke, and what the evidence shows, in enough detail that someone who never saw the original project can make better decisions because of it.

The document is organised by four dimensions — Persona, Solution, Institution, Ecosystem — and by the stage at which each insight was discovered: Explore, Define, Pilot, Scale. A coverage grid in Section 2 shows where knowledge is dense and where gaps remain. Section 3 holds the individual micro-innovations — reusable units of decision, failure, and fix. Section 4 lists genuine reusable artifacts. Section 6 maps realistic adopter questions to the relevant units.

Where source material does not establish something, this document says so rather than filling the gap.

---

## Section 1 — Pathway identity

| Field | Value |
|---|---|
| Deployment name | Dooru Mitra |
| Sector | Urban governance / citizen services |
| Geography | Rajapura, India |
| Population served | Citizens of Rajapura lodging complaints with RCMC by SMS, IVR/voice, or ward office counter |
| Stage reached | Pilot (6 wards, October 2024 – February 2025); expansion to 30 wards approved June 2025, not yet live |
| Contributing organisation | Nagarika Labs (implementing partner); Rajapura City Municipal Corporation (deploying institution); Setu Foundation (funder); Prakriya Research (independent evaluator) |
| Key dates | January 2024 design start; August 2024 design approval; October 2024 pilot go-live; February 2025 pilot close; March 2025 independent evaluation published; June 2025 scale decision |
| Summary | Dooru Mitra classifies and routes citizen complaints received by RCMC across SMS, IVR/voice, and counter channels, replacing manual sorting at a central call centre. The pilot ran across 6 wards from October 2024 to February 2025, reducing median time-to-officer from 3.2 days to 0.9 days and misrouting from 27% to 9%. Expansion to 30 wards was approved in June 2025, conditional on fixing voice accuracy and redesigning the return route. |
| Scale / impact achieved | Median time-to-officer: 3.2 days → 0.9 days. Misrouting: 27% → 9%. Overall top-1 classification accuracy: 88%. Voice accuracy: 71%. Pilot covered 6 of 198 wards; ~11,000 complaints per month city-wide (as of June 2025). |
| Cost anchor | Projected running cost ₹1.90 per complaint at 30 wards; ₹1.10 at 198 wards; against ₹6.40 per complaint for manual sorting. Largest cost component at scale is the SMS/IVR gateway, not model hosting. Vendor rates redacted from published cost model. (As of June 2025.) |
| Build effort | January 2024 – February 2025 (approx. 14 months to end of pilot). Team: Nagarika Labs (implementing partner, team size not documented); RCMC IT Cell; Setu Foundation (funder). Partner count: at minimum 4 organisations (Nagarika Labs, RCMC, Setu Foundation, Prakriya Research, VaniConnect). |
| Known downstream adopters | None documented at time of source material. Setu Foundation is in discussion about sharing materials with its urban governance network; no confirmed adopter. |
| Scope / does not transfer when | Taxonomy and labelling guidelines are tied to RCMC's departmental structure; another city must remap categories to its own departments before use. Boundary-case examples in the labelling guidelines are assessed as more directly transferable than the category list. Gateway cost line should be rebuilt from the adopter's own quoted rates. Labelled training data does not leave RCMC and is not available for reuse. |

---

## Section 2 — Coverage grid and gaps

### Coverage grid

| | Explore | Define | Pilot | Scale |
|---|---|---|---|---|
| **Persona** | ●●● | ●● | ●● | ● |
| **Solution** | ●●● | ●●● | ●●● | ●● |
| **Institution** | ●● | ●●● | ●●● | ●● |
| **Ecosystem** | ● | ●●● | ●● | ●● |

### Open questions

1. **Persona × Scale — Which new user segments will arrive in the 30-ward expansion, and what design changes does each require?** The pilot wards are not described as a representative sample of the city. Wards 19 and 70 already showed different uptake patterns from the other four pilot wards (Unit 7). Whether the 30-ward expansion will surface additional dialect, literacy, or channel-preference variation is not documented. *(Related: Unit 7.)*

2. **Solution × Scale — Which components will be unbundled or renegotiated at 30-ward scale, and do formal data SLAs exist for the State e-Governance Mission feed?** The MoU with the State e-Governance Mission is signed, but whether it includes a service-level agreement with a named cadence and accountability for the grievance portal feed is not documented. *(Related: Unit 6.)*

3. **Institution × Scale — If the project team exits, does the institution retain the capability?** The handover playbook was not completed before the grant closed. The Head of IT Cell is writing sections of it individually. There is no documented evidence that the system can survive a leadership or team change without the original implementers. *(Related: Unit 9.)*

4. **Institution × Scale — Is the ward officer training cost funded for new wards?** Gateway and hosting costs are confirmed on the IT Cell budget line for 2025–26. The cost of training ward officers in the 24 new wards has not been included and was flagged to Finance but not resolved. *(Related: Unit 9.)*

5. **Ecosystem × Explore — What prior attempts to solve complaint routing in comparable cities preceded this deployment, and what did they establish?** No precedent deployments or failed prior attempts are documented in the source material.

6. **Solution × Scale — What is the fix for voice accuracy, and has it been designed?** The scale decision is conditional on a voice fix being in place before new wards go live. The fix is not described in any source document. The root cause (transcription of place names and colloquial terms) is identified but the transcription-vs-classifier contribution is not separated cleanly. *(Related: Unit 4.)*

7. **Ecosystem × Pilot — Why did Wards 19 and 70 bypass the reason-code route?** The evaluation documents the behaviour and rules out training differences, but does not establish the cause. Whether it reflects the return route's design, ward-level culture, officer seniority, or something else is not documented. *(Related: Unit 7.)*

8. **Persona × Pilot — Does Dooru Mitra change what complainants experience, and do they know it exists?** Citizen outcomes are measured through time-to-officer and reopen rates. Whether complainants noticed a change, understood the consent notice, or altered their lodging behaviour is partially addressed by the consent notice testing (40 citizens, Unit 8) but not by the broader pilot evaluation.

---

## Section 3 — Micro-innovations

### Persona

**1. Fix the routing delay, not the resolution time**

- **Dimension:** Persona
- **Stage:** Explore
- **Type:** Strategic Decision
- **Decision:** Define the system's mandate as reducing the time between a complaint being lodged and the right officer seeing it — not the time taken to resolve it once seen.
- **Alternative considered:** Not documented explicitly, but the broader problem of slow complaint resolution was the presenting concern. The team narrowed to the routing bottleneck as the specific, addressable failure point.
- **Why:** Manual sorting at the call centre was the measurable, fixable failure. Downstream resolution time involves officer workload, departmental processes, and political factors outside the system's reach. Fixing what you can reach is a precondition for demonstrating that AI added value.
- **What this looked like here:** RCMC receives ~11,000 complaints per month. The call centre sorted all of them by hand, with no shared definitions. Misrouted complaints were bounced between offices for days. Scoping to the routing step made success measurable and the system's contribution attributable.
- **Condition — applies when:** The target problem has a long causal chain with multiple failure points. Scoping to the earliest measurable bottleneck lets a pilot demonstrate value without requiring downstream systems to also change.

---

**2. Agree what the categories are before labelling anything**

- **Dimension:** Persona
- **Stage:** Define
- **Type:** Strategic Decision
- **Decision:** Before labelling any complaints, convene department heads to agree on a shared complaint taxonomy — definitions, inclusion and exclusion criteria, and the responsible department for each category.
- **Alternative considered:** Not documented. The completion report treats the taxonomy workshops as a prerequisite, not a choice that was debated.
- **Why:** Without agreed definitions, labellers make independent judgment calls on hard cases, producing inconsistent training data. The same complaint about a blocked drain went to Engineering, Health, or Solid Waste depending on who read it — that variance is what the model would learn to reproduce, not correct.
- **What this looked like here:** Six workshops with department heads produced the Dooru taxonomy v3 — 22 categories, each with a definition and inclusion/exclusion notes. During the pilot, four category pairs that labellers and officers could not reliably tell apart were merged, reducing the list to 18.
- **Condition — applies when:** The classification target reflects internal departmental structure rather than a natural or user-facing categorisation. If departments disagree about ownership of cases at the boundary, the model will be trained on that disagreement.

---

**3. Scope the pre-exposure test to what the system will refuse, not just what it will accept**

- **Dimension:** Persona
- **Stage:** Define
- **Also relevant at:** Pilot
- **Type:** Playbook
- **Playbook:**
  1. Before any real complaint is routed by the system, assemble a set of deliberately difficult complaints — abusive messages, heavy dialect, mixed-script text, out-of-remit complaints, and attempts to direct the system to a named officer.
  2. Run testing in three rounds: first the implementation team, then a sample of call centre staff, then staff across all pilot locations.
  3. Do not advance to the next round until the current round's failure modes are documented and addressed.
  4. Use failures from this test to identify missing categories (e.g. "outside RCMC remit") and to set the confidence floor below which complaints route to a human.
- **Note:** The most useful failures here are out-of-remit cases and edge cases at category boundaries — not volume accuracy on normal complaints. Skipping to normal-complaint testing without adversarial cases leaves the model without a refusal path.
- **Condition — applies when:** The system will be exposed to unstructured public input with no pre-filtering. Out-of-remit cases are not a rare edge case in a public grievance system — they are predictable volume.
- **Before → After:** Before this test, the model forced every complaint into one of the 22 categories. After: an "outside RCMC remit" category and a confidence floor were added, giving the system a legitimate path for complaints it cannot classify.

---

### Solution

**4. Train on the channels you actually deploy on**

- **Dimension:** Solution
- **Stage:** Pilot
- **Type:** Failure and Fix
- **Failure:** The classifier was trained almost entirely on SMS and counter text (voice transcripts were under 4% of training data). Voice complaints are 31% of live volume. Voice accuracy in the pilot was 71% against 88% overall and a threshold of 85%.
- **Fix:** Not yet implemented at the time of source material. The scale decision is conditional on a voice fix being in place before new wards go live. Divya Kulkarni added 150 IVR transcripts the model got wrong to the red-team set (bringing it to 750 cases) as a step toward future retraining.
- **Insight:** Channel distribution in training data must match channel distribution in live volume. This was known — the steering committee noted at the August 2024 design approval that voice was close to a third of volume — but the labelling effort did not adjust. The completion report names starting voice data collection during Define (not Pilot) as the main thing the team would do differently.
- **Condition — applies when:** A multi-channel intake system where channel distribution was not known precisely at the start of labelling. The fix is to check live channel proportions early and weight labelling effort accordingly, not to assume text-heavy archives represent live volume.

---

**5. Add a transliteration step before the classifier for mixed-script input**

- **Dimension:** Solution
- **Stage:** Define
- **Type:** Tactical Decision
- **Decision:** For mixed-script SMS (Kannada words written in Latin characters), add an open-source Kannada–English transliteration step before the classifier rather than training the classifier to handle raw mixed-script input.
- **Alternative considered:** Not documented explicitly. The completion report describes moving from a rules-only router (which failed at 61% on mixed-script and colloquial descriptions) to the fine-tuned classifier with a transliteration pre-step; whether training the classifier directly on mixed-script data was considered is not stated.
- **Why:** Mixed-script colloquial text is a known failure mode for multilingual classifiers trained on normalised text. A preprocessing step is modular — it can be updated or replaced without retraining the classifier.
- **What this looked like here:** An open-source library was used. No further detail on the specific library or its performance contribution is documented in the source material.
- **Condition — applies when:** The user population routinely writes in transliterated form (e.g. typing a regional language in Latin script via mobile keyboard). This is common in Indian language SMS and messaging contexts.

---

**6. Keep call recordings and transcripts as institutional property in the gateway RFP**

- **Dimension:** Solution
- **Stage:** Define
- **Also relevant at:** Scale
- **Type:** Strategic Decision
- **Decision:** Specify in the SMS/IVR gateway RFP that call recordings and transcripts remain RCMC property, not the vendor's.
- **Alternative considered:** Not documented. The steering committee minutes record this as a condition confirmed by the IT Cell Head, not as a contested choice.
- **Why:** Transcripts are the raw material for retraining and quality review. If they belong to the vendor, the institution cannot retrain the classifier, audit routing decisions, or switch vendors without losing access to its own operational data.
- **What this looked like here:** The RFP was published on the state e-procurement portal. The data ownership condition was included at the Define stage, before the vendor was selected, making it a contract requirement rather than a post-selection negotiation.
- **Condition — applies when:** Gateway procurement precedes model maturity. Locking in data ownership at RFP stage costs nothing; renegotiating it after contract award is difficult or impossible.

---

### Institution

**7. Design the return route before go-live; treat reason codes as a feedback mechanism, not a blame mechanism**

- **Dimension:** Institution
- **Stage:** Pilot
- **Type:** Failure and Fix
- **Failure:** In two of the six pilot wards (Wards 19 and 70), ward officers bypassed the designed return-with-reason-code route and forwarded misrouted complaints to colleagues via WhatsApp instead. Officers said the return route took longer than a phone call. The reason codes from those wards did not feed into relabelling.
- **Fix:** The steering committee's scale decision made redesigning the return route for speed a condition of expansion, alongside the voice fix. The specific redesign is not documented in the source material.
- **Insight:** A feedback route that is slower than the informal workaround will be bypassed. The reason-code route's value is not just correctness data for the model — it is the institution's only systematic signal about what the classifier is getting wrong. Bypassing it breaks the improvement loop.
- **Condition — applies when:** Ward officers or frontline staff have an informal alternative (phone, messaging app) that achieves the immediate goal (getting the complaint to the right person) faster than the designed route. Speed of the formal route must be competitive with the informal one, or the formal route will be used only by compliant staff, not all staff.

---

**8. Test the consent notice with low-literacy users before go-live**

- **Dimension:** Institution
- **Stage:** Pilot
- **Type:** Tactical Decision
- **Decision:** Test the citizen consent notice (explaining automated sorting and the opt-out path) with real users, including low-literacy users, before the pilot went live — and revise based on comprehension, not only legal adequacy.
- **Alternative considered:** Not documented. The evaluation describes the testing as part of the pilot design; whether a legal-review-only approach was considered is not stated.
- **Why:** A notice that satisfies legal requirements but is not understood by low-literacy users does not constitute meaningful consent. The IVR (spoken) version was noticeably better understood than the SMS (text) version by low-literacy respondents; the SMS text was shortened as a result.
- **What this looked like here:** 40 citizens tested the notice text, half with low literacy. The final notice in both languages and both channels is documented in the evaluation report's appendix.
- **Condition — applies when:** The user population includes low-literacy users and the system operates across both text and voice channels. The appropriate consent format differs by channel and literacy level — a single notice text is unlikely to serve both.

---

**9. Name a person responsible for the routing matrix before go-live**

- **Dimension:** Institution
- **Stage:** Define
- **Also relevant at:** Pilot
- **Type:** Failure and Fix
- **Failure:** The routing matrix (category × ward → responsible officer role) was drafted by Nagarika Labs before go-live. The August 2024 steering committee meeting noted that the IT Cell needed to name a person responsible — this action was carried to the next meeting without being completed. During the pilot the matrix changed eleven times as officers were transferred.
- **Fix:** Not fully resolved in the source material. The completion report names getting the routing matrix owned by a named person in the IT Cell from the start as one of the two main things the team would do differently. At the time of writing, the Head of IT Cell holds de facto ownership but no formal named owner is documented.
- **Insight:** The routing matrix is the most operationally volatile component of a complaint-routing system. Officer transfers, departmental restructuring, and seasonal workload changes all require matrix updates. Without a named owner, updates happen informally or not at all, and misrouting increases silently.
- **Condition — applies when:** The routing target is a named officer role rather than a fixed department, in an institution with regular officer transfers. The matrix must be treated as a living operational document with a named maintainer, not a one-time configuration.

---

### Ecosystem

**10. Use the MoU template for the grievance portal feed as a reusable instrument for other urban local bodies**

- **Dimension:** Ecosystem
- **Stage:** Define
- **Type:** Toolkit Asset
- **Toolkit asset:** A data-sharing MoU template with the State e-Governance Mission, with the State's schedule removed. The unsigned template is available on request to other urban local bodies through RCMC Legal.
- **Purpose:** Establishes the legal basis for an urban local body to access the integrated grievance portal feed from the State e-Governance Mission — the data source that makes complaint intake cross-channel.
- **Reusable as-is:** The template structure and standard clauses transfer directly; another ULB replaces the schedule with its own jurisdiction and data scope. The Legal Advisor noted at the June 2025 steering committee that several ULBs had already asked for it.
- **Condition — applies when:** An urban local body in the same state is seeking access to the State e-Governance Mission grievance portal feed and needs a precedent instrument. ULBs in other states would need to adapt it for their own state's governance structure and data-sharing norms.

---

**11. Specify scorecard metrics and category breakdown before the pilot begins, not after**

- **Dimension:** Ecosystem
- **Stage:** Define
- **Also relevant at:** Pilot
- **Type:** Strategic Decision
- **Decision:** Agree the M&E framework — including the specific thresholds (85% top-1 accuracy, misrouting below 10%), the breakdown by channel and category, and the weekly scorecard format — with the independent evaluator before go-live, not at the point of evaluation.
- **Alternative considered:** Not documented. The evaluation report states the framework was agreed in August 2024 with RCMC and Nagarika Labs; the process of reaching it is not described.
- **Why:** Pre-agreed thresholds make the scale decision defensible and the pilot evaluation independent. If the evaluator and implementer agree on thresholds after seeing results, the thresholds are not independent. The channel-level breakdown (SMS vs voice vs counter) was what revealed the voice accuracy problem — an aggregate figure alone would have obscured it.
- **What this looked like here:** Prakriya Research tracked accuracy, misrouting, time-to-officer, and reopen rates weekly in a scorecard workbook, broken out by category, ward, and channel. The workbook is still in active use by RCMC weekly.
- **Condition — applies when:** An independent evaluator is engaged. The M&E framework and thresholds should be the evaluator's instrument, agreed before results exist, or the evaluation cannot be independent.

---

## Section 4 — Toolkits and playbooks

| # | Title | Type | Reuse condition | File |
| --- | --- | --- | --- | --- |
| 5 | Complaint record data dictionary | Toolkit Asset | Directly reusable by any ULB with multi-system complaint intake where the same field is stored differently across systems; category names should be localised. | — |
| 6 | Data sharing MoU template (State e-Governance Mission, schedule removed) | Toolkit Asset | Reusable by ULBs in the same state seeking access to the State e-Governance Mission grievance portal feed; requires schedule adaptation for other states. | — |
| 8 | Citizen consent notice — SMS and IVR, Kannada and English | Toolkit Asset | Reusable as a format and comprehension-testing approach; notice text must be rewritten for the deploying institution and retested with local low-literacy users before use. | — |
| 10 | [Misrouting SOP (What to do when a complaint reaches you by mistake)](/api/toolkit-assets/asset-82595ff2-74d5-4834-a402-154f64ba5a28/download?preview=1) <!-- asset-id: asset-82595ff2-74d5-4834-a402-154f64ba5a28 --> | Toolkit Asset | Directly reusable by ward officers or equivalent frontline staff; category and reason-code references must be updated to match the adopter's taxonomy. | [01_completion-report_nagarika-labs.md](/api/toolkit-assets/asset-82595ff2-74d5-4834-a402-154f64ba5a28/download) |
| 11 | Ward officer training flip chart (Kannada) | Toolkit Asset | Reusable as a format — focuses on what the system gets wrong and how to use the return route, not on how the software works; must be translated and localised for the adopter's language and taxonomy. | — |
| 12 | Pilot scorecard workbook (weekly accuracy, misrouting, time-to-officer by category/ward/channel) | Toolkit Asset | Reusable by replacing the category sheet with the adopter's own taxonomy; formulas do not depend on the number of categories. | — |
| 13 | Labelling guidelines with 140 worked examples (boundary cases) | Toolkit Asset | Boundary-case examples likely transfer more directly than the category list; categories must be remapped to the adopter's departmental structure before use. | — |
| — | [sahayika evaluation](/api/toolkit-assets/asset-93457eac-2354-4b26-90f4-06cfe319b6a7/download?preview=1) <!-- asset-id: asset-93457eac-2354-4b26-90f4-06cfe319b6a7 --> | Toolkit Asset | Not documented in the source | [99-sahayika-evaluation.md](/api/toolkit-assets/asset-93457eac-2354-4b26-90f4-06cfe319b6a7/download) |
| — | [Sahayika Helper](/api/toolkit-assets/asset-17474a2b-9fee-4c8b-9599-14c0d1fbf378/download?preview=1) <!-- asset-id: asset-17474a2b-9fee-4c8b-9599-14c0d1fbf378 --> | Toolkit Asset | Could be reused by others working on similar urban governance or citizen services deployments in India where conditions need to be defined; the specific conditions would need to be adapted to suit the local context and deployment requirements. | [IMG_20260509_155034.jpg.jpeg.pdf](/api/toolkit-assets/asset-17474a2b-9fee-4c8b-9599-14c0d1fbf378/download) |
| — | [test 2](/api/toolkit-assets/asset-7f4c2d26-b961-429c-b1f4-8e6d68c78ed4/download?preview=1) <!-- asset-id: asset-7f4c2d26-b961-429c-b1f4-8e6d68c78ed4 --> | Toolkit Asset | May be reusable by others testing document sharing on the pathway, but content should be replaced with real deployment-specific material before use. | [04_email-thread_lessons-for-share-back.md](/api/toolkit-assets/asset-7f4c2d26-b961-429c-b1f4-8e6d68c78ed4/download) |

---

## Section 5 — Problem→solution patterns

Covered by the Failure-and-Fix units in Section 3 (Units 4, 7, 9).

---

## Section 6 — Retrieval guide

*"How do I define what the AI system should and shouldn't do?"* → Unit 1, Unit 2

*"We have multiple complaint channels — SMS, phone, counter. How do we handle them all?"* → Unit 4, Unit 5

*"How do we make sure the classifier learns from its own mistakes?"* → Unit 7, Unit 9

*"What should we put in the gateway RFP to protect our data?"* → Unit 6

*"How do I design a test before we go live with real complaints?"* → Unit 3

*"How do we get independent evaluation that will hold up to scrutiny?"* → Unit 11

*"What happens when frontline staff bypass the designed route?"* → Unit 7

*"Our training data is all text but we're getting a lot of voice complaints — what do we do?"* → Unit 4

*"We're expanding to more locations. What broke in the pilot that we need to fix first?"* → Unit 4, Unit 7, Unit 9

*"Who needs to own the routing configuration, and what happens if no one does?"* → Unit 9

*"How do we handle consent for an automated system that ordinary citizens will encounter?"* → Unit 8

*"What MoU do we need to access the state grievance portal feed?"* → Unit 10

*"How do we build a taxonomy of complaint categories?"* → Unit 2, Unit 13 (Section 4)

*"What materials can we share with other cities doing the same thing?"* → Unit 10, Section 4

*"What would this cost per complaint at different scales?"* → Section 1 (cost anchor)

---

## Source Trace appendix

*Contributor-facing only — not surfaced in any adopter-facing response.*

| Source file | Covers | Notes |
|---|---|---|
| 01_completion-report_nagarika-labs.md (Nagarika Labs, 30 June 2025) | Section 1 — all identity and cost/effort fields except pilot accuracy figures; Units 1, 2, 3, 4, 5, 6, 9; Section 4 rows for Units 3, 5, 8, 10, 11, 13 | Primary source. Implementer-authored; represents Nagarika Labs' account of design decisions, data approach, and lessons. Figures for accuracy and misrouting confirmed by 02. |
| 02_pilot-evaluation_prakriya-research.md (Prakriya Research, March 2025) | Section 1 — accuracy figures, misrouting figures, time-to-officer figures; Units 3, 4, 7, 8, 11; Section 4 rows for Units 7, 11, 12; Section 2 gap 8 | Primary source for pilot outcome figures. Independent of implementing partner. Channel-level accuracy breakdown (Unit 4) and uptake findings (Unit 7) originate here. |
| 03_steering-committee-minutes_rcmc.md (RCMC, Meeting 3: 22 August 2024; Meeting 7: 18 June 2025) | Section 1 — scale decision, budget line confirmation, sharing intent; Units 6, 9, 10, 11; Section 2 gaps 3, 4 | Primary source for institutional decisions and governance record. Meeting 3 establishes Define-stage decisions (PIA, MoU, gateway RFP, routing matrix ownership). Meeting 7 establishes scale conditions and sharing intent. |
| 04_email-thread_lessons-for-share-back.md (Nagarika Labs internal, 3–5 July 2025) | Units 4, 7, 9; Section 2 gaps 6, 7; Section 4 — confirms labelling guidelines and data dictionary as shareable; flags video and red-team set as not straightforwardly shareable | Primary source for post-pilot team reflection. Contributor accounts only — not independently verified. Confirms cost model (Annex D) as shareable with rates redacted. Flags that handover playbook was not completed. |