```yaml
---
title: Dooru Mitra
description: AI complaint classifier and router that routes citizen complaints to the right ward officer and department at Rajapura City Municipal Corporation, replacing manual call centre sorting.
stage: Pilot
sector: Urban governance / civic complaints
location: Rajapura, Karnataka, India
tags: [Civic Complaints, Urban Governance, Multilingual Classifier, Voice AI]
---
```

---

# Dooru Mitra

## Section 0 — Reading guide

This pathway documents how Rajapura City Municipal Corporation (RCMC) and Nagarika Labs built and piloted an AI complaint classifier to replace manual sorting at a civic call centre. It is written for the next team attempting something similar — a municipality, urban local body, or civic technology implementer considering AI-assisted complaint routing across multiple channels and languages.

Knowledge concentrates most densely at **Solution × Define** (what the classifier architecture required and why) and **Solution × Pilot** (what broke, specifically on voice, and how the team responded). The **Persona** and **Institution** dimensions are well-evidenced at Pilot stage from the independent evaluation. **Ecosystem** coverage is thinner — partner roles are named but the coordination detail is sparse.

Navigate by dimension if you have a specific concern (e.g. data readiness, governance, partner dependencies). Navigate by stage if you are at a known decision point (e.g. about to run a pre-exposure test, or choosing between rules-only and ML approaches).

---

## Section 1 — Pathway identity

| Field | Detail |
|---|---|
| Deployment name | Dooru Mitra |
| Sector | Urban governance / civic complaints |
| Geography | Rajapura, Karnataka, India |
| Population served | Citizens lodging complaints with Rajapura City Municipal Corporation (~11,000 complaints/month) in Kannada, English, and mixed Kannada–English |
| Stage reached | Pilot |
| Contributing organisation | Nagarika Labs (implementing partner); Rajapura City Municipal Corporation (deploying institution); Setu Foundation (funder); Prakriya Research (independent evaluator) |
| Key dates | January 2024 (project start); August 2024 (design approved by steering committee); October 2024 (pilot launched, 6 wards); February 2025 (pilot closed); March 2025 (independent evaluation published); June 2025 (30-ward expansion approved) |
| Summary | Dooru Mitra classifies and routes citizen complaints received across phone/IVR, SMS, and counter channels, replacing manual call centre sorting. The pilot ran across 6 wards from October 2024 to February 2025, reducing median time-to-officer from 3.2 days to 0.9 days and misrouting from 27% to 9%. A 30-ward expansion was approved in June 2025, conditional on fixing voice accuracy (currently 71% against an 85% threshold) and redesigning the complaint return route. |
| Scale / impact achieved | 6 pilot wards; ~11,000 complaints/month total volume; median time-to-officer 3.2 days → 0.9 days; misrouting 27% → 9% (as of February 2025) |
| Cost anchor | Projected running cost ₹1.90 per complaint at 30 wards; ₹1.10 per complaint at full 198-ward scale; compared to ₹6.40 per complaint for manual sorting. Largest cost component at scale is the SMS/IVR gateway, not model hosting. (As of June 2025; vendor rates redacted from published model.) |
| Build effort | January 2024 – June 2025 (18 months to end of Phase 1). Core team: Nagarika Labs (implementing partner, at least 2 staff named). Partners: RCMC IT Cell, Setu Foundation, VaniConnect (gateway), Prakriya Research (evaluation). |
| Known downstream adopters | Setu Foundation network share-back initiated; materials list under preparation as of July 2025. Legal review of open-sourcing classifier code pending. No downstream adopters documented yet. |
| Scope / does not transfer when | Category taxonomy and routing matrix are specific to RCMC's departmental structure — another city must remap to its own departments before use. Boundary-case labelling examples are more directly transferable than the category list. Cost model gateway line must be rebuilt from locally quoted rates. |

---

## Section 2 — Coverage grid and open questions

### Coverage map

| | Explore | Define | Pilot | Scale |
|---|---|---|---|---|
| **Persona** | ●● | ●● | ●●● | ● |
| **Solution** | ●● | ●●● | ●●● | ● |
| **Institution** | ●● | ●● | ●● | ●● |
| **Ecosystem** | ● | ●● | ●● | ● |

●●● well evidenced · ●● partially evidenced · ● thin · ○ not evidenced

### Open questions

1. **Why did Wards 19 and 70 not adopt the return route?** The pilot evaluation establishes that uptake was uneven and that officers in those wards bypassed the reason-code route via WhatsApp. The training was reportedly identical to other wards. Neither the evaluation report nor the completion report identifies a root cause. This matters before the 30-ward expansion, because the return route is one of the two conditions on which expansion was approved. *(Relates to Units 6 and 7.)*

2. **What is the specific fix planned for voice accuracy?** The 30-ward expansion is conditional on a voice fix, but none of the source documents describe what that fix is. The evaluation identifies transcription of place names and colloquial terms as the likely source of error, but notes it could not separate transcription failures from classifier failures cleanly. *(Relates to Unit 5.)*

3. **Who is the named person responsible for the routing matrix in the IT Cell?** The August 2024 steering committee minutes record this as an open action, carried to the next meeting. The completion report notes the matrix changed eleven times during the pilot as officers were transferred. Whether a named owner was ever assigned is not documented. *(Relates to Unit 8.)*

4. **Is the handover playbook complete?** The completion report states it was not finished before the grant closed. Farhan Sheikh notes he is writing it himself as he goes. Its status going into the 30-ward expansion is not documented.

5. **What is the training budget for new wards?** The June 2025 steering committee confirmed gateway and hosting costs move to the IT Cell budget line, but noted ward officer training for new wards has not been included and is to be raised with Finance. Resolution is not documented. *(Relates to Unit 9.)*

6. **Can the pre-exposure red-team set (now 750 transcripts) be shared?** Divya Kulkarni flags that the 150 IVR transcripts added post-pilot contain specific place names and have not been cleared for sharing. This limits the reusability of the test set for other cities. *(Relates to Unit 4.)*

7. **Can the classifier code be open-sourced?** Legal review is pending. The Legal Advisor noted that model weights trained on complaint data may need separate consideration from the code itself. Resolution not documented. *(Relates to Unit 10.)*

8. **What does the consent notice literacy finding imply for counter channel users?** The pilot tested the SMS and IVR consent notices with low-literacy citizens and found IVR was better understood. The counter channel (25% of volume) is not mentioned in the consent notice testing. Whether counter staff explain the system to complainants and how is not documented.

---

## Section 3 — Micro-innovations

### Persona

**1. Scoping the problem to routing delay, not resolution time**

- Dimension: Persona
- Stage: Explore
- Also relevant at: Define
- Type: Strategic Decision
- **Decision:** Define the problem RCMC asked the system to solve as the delay between a complaint being lodged and the responsible officer seeing it — explicitly excluding time to resolve once seen.
- **Alternative considered:** Addressing full complaint lifecycle, including resolution tracking and escalation.
- **Why:** The bottleneck RCMC identified was the hand-sorting step, not what officers did after receiving complaints. A narrower scope produced a system that could be evaluated cleanly and held to a binary success condition. Expanding scope would have required integrating resolution workflows, officer performance data, and escalation rules — all outside the implementing team's control.
- **What this looked like here:** The pilot evaluation measured time-to-officer (median 3.2 → 0.9 days) and misrouting rate (27% → 9%) as its primary indicators. Resolution time was explicitly not in scope.
- **Condition — applies when:** The institutional bottleneck is a specific, isolable hand-off step rather than a systemic process failure. Fails when the delay citizens experience is downstream of routing — i.e. when officers receive complaints promptly but do not act on them.

---

**2. Pre-exposure testing with a gated three-round sequence**

- Dimension: Solution
- Stage: Define
- Also relevant at: Pilot
- Type: Playbook
- **Playbook:** Before any real complaint is routed by the system, run a staged test sequence against a set of deliberately difficult cases — abusive messages, heavy-dialect text, mixed-script input, out-of-remit complaints, and attempts to manipulate routing to a named officer. Stage 1: internal team only. Do not proceed to Stage 2 until Stage 1 failures are categorised and addressed. Stage 2: call centre staff (12 in this deployment). Do not proceed to Stage 3 until Stage 2 surfaces no new failure categories. Stage 3: ward staff across all pilot wards (30 in this deployment). Gate to live only after Stage 3 clears.
- **Note:** The common failure mode is running all three rounds in parallel or treating them as a single sign-off step. Each round surfaces a different failure type: the team finds model errors; call centre staff find workflow mismatches; ward staff find edge cases that neither group encounters in normal work.
- **Condition — applies when:** Any multi-channel AI intake system where errors surface differently across user groups. Particularly applicable where frontline users (ward officers) differ significantly in context and complaint type from those who built and initially tested the system.
- **Before → After:** Before Stage 3 testing, the model had no "outside RCMC remit" category and no confidence floor — it forced every complaint into one of 22 categories. Stage 3 testing with ward staff exposed this gap. Both features were added before go-live.

---

### Solution

**3. Rules-only router tested and rejected before committing to ML**

- Dimension: Solution
- Stage: Explore
- Type: Strategic Decision
- **Decision:** Test a rules-only keyword router on historical complaints before committing to a machine learning classifier.
- **Alternative considered:** Proceeding directly to a fine-tuned multilingual classifier based on the team's assessment of complaint language complexity.
- **Why:** A two-week test on 2,000 historical complaints gave a concrete failure rate (61% accuracy) and identified the specific failure mode (mixed-script and colloquial descriptions). This grounded the decision to move to ML in evidence rather than assumption, and gave the institution a documented rationale for the more complex and costly approach.
- **What this looked like here:** The rules router's 61% accuracy on mixed-script and colloquial text, against an 85% threshold, made the gap concrete. The fine-tuned multilingual classifier, with a small rules layer for policy-fixed categories (e.g. dog bites → Health regardless of wording), became the agreed architecture.
- **Condition — applies when:** The complaint language is heterogeneous — multiple scripts, colloquialisms, mixed-language input. A rules router is a reasonable first test whenever the vocabulary of complaints might be more constrained than it appears. Fails when the team skips this test and commits to ML on assumption alone — the cost of the test is two weeks; the cost of the wrong architecture is months.

---

**4. Training data composed almost entirely of text, then deployed on voice**

- Dimension: Solution
- Stage: Pilot
- Type: Failure and Fix
- **Failure:** The classifier was trained on 38,000 labelled complaints drawn from 2022–2023 call centre records, which were predominantly SMS and counter text. Voice/IVR transcripts were under 4% of training data. At pilot, voice was 31% of live volume. Voice accuracy was 71% against an 85% threshold; SMS and counter accuracy was 92–94%.
- **Fix:** Post-pilot, 150 IVR transcripts the model got wrong were added to the red-team test set, expanding it from 600 to 750 cases. A dedicated voice fix is a condition of the 30-ward expansion. The specific fix (re-training with more voice data, transcript pre-processing, or other intervention) is not yet documented.
- **Insight:** The modality of training data must match the modality distribution of live intake. When a channel represents nearly a third of volume, it must be represented in training data — not treated as a variant of text input. The failure here is structural, not incidental: voice transcription introduces a qualitatively different error type (place names, colloquial pronunciation) that text-trained classifiers do not encounter in training.
- **Condition — applies when:** Any complaint or intake system where voice is a significant channel and training data is drawn from written records. The risk is highest when voice users are a distinct population (lower literacy, different dialect) from text users — their complaints will be systematically underrepresented and systematically misclassified.

---

**5. Confidence floor and out-of-remit category added after pre-exposure testing**

- Dimension: Solution
- Stage: Define
- Also relevant at: Pilot
- Type: Tactical Decision
- **Decision:** Add two safety features before go-live: (a) a confidence floor below which complaints are routed to a human at the call centre rather than auto-classified, and (b) an "outside RCMC remit" category for complaints about matters handled by other agencies (e.g. electricity supply).
- **Alternative considered:** Forcing every complaint into one of the 22 departmental categories regardless of confidence or subject matter.
- **Why:** Pre-exposure testing with ward staff revealed the system would otherwise classify complaints about state utility services into RCMC departments — routing complainants to officers with no authority over their issue. The confidence floor addressed the model's tendency to assign a category even when it had low certainty. Both features protect the complainant experience and reduce the misrouting rate.
- **What this looked like here:** The out-of-remit category and confidence floor were not in the original design; they were added after Stage 3 pre-exposure testing surfaced the gap. The pilot evaluation's misrouting threshold of below 10% was met (9%), and the team attributes this in part to these additions.
- **Condition — applies when:** Any classification system operating in a civic or multi-agency context where complaints frequently concern matters outside the deploying institution's remit. The confidence floor is applicable wherever auto-classification confidence varies significantly by complaint type or input modality.

---

### Institution

**6. Misrouting reason-code SOP and weekly review loop**

- Dimension: Institution
- Stage: Pilot
- Type: Toolkit Asset
- **Toolkit asset:** A one-page SOP — *What to do when a complaint reaches you by mistake* — given to ward officers, specifying how to return a misrouted complaint with a reason code rather than forwarding it informally. Reason codes are reviewed weekly by the call centre supervisor and feed into relabelling.
- **Purpose:** To create a structured, institution-owned feedback loop between frontline officers and the model — so misrouting generates labelled correction data, not just informal workarounds.
- **Reusable as-is:** The SOP structure (return step, reason code selection, escalation path) transfers to any complaint routing system where frontline receivers can identify misrouting. The specific reason codes are tied to the Dooru taxonomy and would need to be remapped to another city's category structure.
- **Condition — applies when:** A routing system where ward or frontline officers are the first to see misrouted complaints. Fails when officers have no path back to the system — they will route informally (as happened in Wards 19 and 70) and the institution loses both the correction and the signal.

---

**7. Officer training focused on failure modes, not software**

- Dimension: Institution
- Stage: Pilot
- Type: Tactical Decision
- **Decision:** Design ward officer training around what the system gets wrong and how to use the return route — not around how the software works.
- **Alternative considered:** General system walkthrough training covering all features.
- **Why:** Officers' primary operational concern is what to do when a complaint arrives that is not theirs. Training that leads with software mechanics does not address this concern and does not change officer behaviour at the moment of a misrouted complaint. Training that leads with failure cases and the return route puts the most consequential action first.
- **What this looked like here:** Meena Hegde produced a Kannada flip chart for ward offices and a 40-minute training video featuring two ward officers from Ward 41 walking through real anonymised cases. Both materials centre on failure recognition and the reason-code return route.
- **Condition — applies when:** Any system where the frontline user's most consequential interaction with the system is handling its errors, not using its core function. Uptake of the return route was uneven (Wards 19 and 70 bypassed it), but the source documents do not establish whether this reflects a training design problem or a different cause.

---

**8. Routing matrix without a named owner**

- Dimension: Institution
- Stage: Pilot
- Type: Failure and Fix
- **Failure:** The routing matrix (category × ward → responsible officer role) was drafted before go-live but no named person in the IT Cell was assigned to own it. During the pilot the matrix changed eleven times as officers were transferred.
- **Fix:** The completion report identifies this as something the team would do differently — assign a named routing matrix owner in the IT Cell from the start of the project, not after go-live.
- **Insight:** A routing system is only as stable as its routing table. Officer transfers are routine in municipal government; a matrix without a named owner becomes a shared responsibility that no one maintains in practice. The person who owns the matrix must be named before the system goes live, not carried as an open action from a steering committee meeting.
- **Condition — applies when:** Any routing system deployed in an institution with regular staff rotation, transfers, or restructuring. The risk is proportional to the frequency of personnel change relative to the update cadence the routing table requires.

---

### Ecosystem

**9. Gateway and hosting costs confirmed on budget line; training cost unresolved at Scale decision**

- Dimension: Ecosystem
- Stage: Scale
- Type: Tactical Decision
- **Decision:** The June 2025 steering committee confirmed gateway and hosting costs move to the RCMC IT Cell's recurring budget line from 2025–26. Ward officer training costs for new wards were not included in that budget line and were flagged for separate resolution with Finance.
- **Alternative considered:** Keeping all costs under project/grant funding through the expansion phase.
- **Why:** Moving infrastructure costs to a recurring budget line is the signal that the institution has absorbed the core service. However, the training cost being unresolved creates a dependency: the 30-ward expansion requires training new ward officers, and without a budget line for it, training either does not happen or is funded ad hoc.
- **What this looked like here:** The Additional Commissioner confirmed the infrastructure budget move. The training gap was noted in the same meeting without resolution. This is an open risk going into the expansion.
- **Condition — applies when:** Any expansion where the deploying institution controls infrastructure budgets but training budgets sit in a different administrative line. The split is common in municipal government and must be surfaced explicitly before an expansion is approved, not after.

---

**10. Labelled complaint corpus held within RCMC; code ownership separate**

- Dimension: Ecosystem
- Stage: Define
- Also relevant at: Scale
- Type: Strategic Decision
- **Decision:** The labelled training corpus (38,000 complaints, containing names, phone numbers, and addresses) is held by the RCMC IT Cell and is not available outside RCMC. The classifier code sits in RCMC's GitHub organisation, with RCMC holding the code under the implementing agreement.
- **Alternative considered:** Shared hosting of labelled data with the implementing partner, or joint ownership of the codebase.
- **Why:** The PIA conditions required that the labelled training data not leave RCMC servers. Separating data custody (RCMC) from code custody (also RCMC, under agreement) means the institution retains both the most sensitive asset and the operational tool, while the implementing partner retains no ongoing access dependency.
- **What this looked like here:** The steering committee's data-sharing discussion at the June 2025 meeting reflects this structure: the taxonomy, labelling guidelines, and SOP can be shared with other cities; the labelled corpus cannot; and open-sourcing the code is under separate legal review.
- **Condition — applies when:** Any government AI deployment where training data contains citizen PII. The principle — data stays with the institution that collected it, code ownership is negotiated separately — is transferable regardless of jurisdiction, though the specific PIA conditions will vary.

---

## Section 4 — Toolkits and playbooks

| # | Title | Type | Reuse condition | File |
| --- | --- | --- | --- | --- |
| 2 | [Pre-exposure testing with a gated three-round sequence](https://docs.google.com/document/d/1saPApEiVlSg_jS_XkcO5uLJn1ZcrHo26dyeWyxjB4CY/edit?tab=t.0) <!-- asset-id: asset-0f984581-67aa-44cf-972b-a87f588f878c --> | Playbook | Any multi-channel AI intake system; adapt the number of rounds and tester groups to the number of distinct user populations | [docs.google.com](https://docs.google.com/document/d/1saPApEiVlSg_jS_XkcO5uLJn1ZcrHo26dyeWyxjB4CY/edit?tab=t.0) |
| 4 | [Labelling guidelines with worked examples](https://docs.google.com/document/d/1DHeXrZs1e0tVMrKvPIlzTnliQVGSmOozgYgIfQG3aGc/edit?tab=t.0) <!-- asset-id: asset-943e2ab6-b0d7-4947-934b-50d6e09178fe --> | Toolkit Asset | Boundary-case examples transfer more directly than category definitions; another city must remap categories to its own departmental structure | [docs.google.com](https://docs.google.com/document/d/1DHeXrZs1e0tVMrKvPIlzTnliQVGSmOozgYgIfQG3aGc/edit?tab=t.0) |
| 5 | Weekly scorecard workbook (accuracy, misrouting, time-to-officer by category/ward/channel) | Toolkit Asset | Replace the category sheet with your own taxonomy; formulas do not depend on number of categories | — |
| 6 | Misrouting reason-code SOP | Toolkit Asset | Reason codes must be remapped to the adopting city's category structure; SOP structure transfers as-is | — |
| 7 | Baseline survey instrument (Kannada and English) | Toolkit Asset | Adapt question set to local complaint channels and languages; method (pre/post, comparison wards) transfers directly | — |
| 8 | Citizen consent notice — SMS and IVR, Kannada and English | Toolkit Asset | Final notice text reflects low-literacy testing; any adopter should run equivalent literacy testing on their own language versions | — |
| 9 | Data dictionary for complaint record fields | Toolkit Asset | Particularly relevant where the same field (e.g. ward) is stored differently across systems; structure transfers, field names must be adapted | — |
| 10 | Data sharing MoU template (unsigned, State schedule removed) | Toolkit Asset | Template available to other urban local bodies on request per steering committee agreement; State-specific schedule must be replaced | — |
| — | [Dooru taxonomy](/api/toolkit-assets/asset-345018c6-de99-42ac-a057-2e77cb7ca45c/download?preview=1) <!-- asset-id: asset-345018c6-de99-42ac-a057-2e77cb7ca45c --> | Toolkit Asset | Reusable by other urban governance deployments that rely on volunteer-led complaint intake; category names and classifications would need to be adapted to reflect the local complaint types and administrative structure of the new area. | [Dooru taxonomy — 18-category consolidated version.pdf](/api/toolkit-assets/asset-345018c6-de99-42ac-a057-2e77cb7ca45c/download) |
| — | [Voluter guideline](/api/toolkit-assets/asset-52914b4b-9a23-4468-bad9-38f6a1b14283/download?preview=1) <!-- asset-id: asset-52914b4b-9a23-4468-bad9-38f6a1b14283 --> | Toolkit Asset | Reusable by other civic complaint deployments running similar volunteer or mitra programmes; role descriptions, local area references, and any Rajapura-specific processes would need to be adapted to the new context. | [Dooru Guidelines 1.pdf](/api/toolkit-assets/asset-52914b4b-9a23-4468-bad9-38f6a1b14283/download) |

---

## Section 6 — Retrieval guide

*"How do we decide between a rules router and a machine learning classifier?"* → Unit 3

*"We're about to launch — how do we test before real users see it?"* → Unit 2

*"Our voice channel is performing much worse than SMS. What's the likely cause?"* → Unit 4

*"How do we handle complaints that are outside our agency's remit?"* → Unit 5

*"Ward officers are bypassing the return route — what do we know about why?"* → Units 6, 7

*"Who should own the routing matrix, and what happens if no one does?"* → Unit 8

*"How do we structure training for frontline officers who don't care about the software?"* → Unit 7

*"What data can we share with other cities, and what must stay internal?"* → Unit 10

*"How do we keep the expansion budget from stalling on training costs?"* → Unit 9

*"What does the pilot tell us about which complainants the system serves least well?"* → Unit 4

*"We need to justify ML over a simpler approach to our steering committee — what's the evidence base?"* → Unit 3

*"How do we make misrouting generate useful retraining data rather than just informal workarounds?"* → Unit 6

*"What should the consent notice cover, and how do we test it for low-literacy users?"* → Unit 8

*"We have a multi-department grievance system — how do we define and maintain the routing rules?"* → Unit 8, Unit 6

*"What does it look like when training data doesn't match live intake modality?"* → Unit 4

*"How do we structure the labelling task so it's consistent across labellers?"* → Unit 4 (context), Section 4 row for Labelling guidelines

---

---

## Source Trace appendix

*Contributor-facing only — not surfaced in any adopter-facing response.*

| Source file | Covers | Notes |
|---|---|---|
| 01_completion-report_nagarika-labs.md (as of 30 June 2025) | Section 1 — all identity fields, cost anchor, build effort, scope/non-transfer; Units 1, 3, 4, 5, 6, 7, 8, 10; Section 4 rows for Labelling guidelines, Misrouting reason-code SOP, Data dictionary, Cost model; Section 2 gaps 3, 4, 5, 6, 7 | Primary source. Most complete account of design decisions, data, and architecture. Vendor rates redacted in Annex D. |
| 02_pilot-evaluation_prakriya-research.md (as of March 2025) | Section 1 — scale/impact figures, pilot dates; Units 4, 5, 6, 7; Section 4 rows for Weekly scorecard workbook, Baseline survey instrument, Citizen consent notice; Section 2 gaps 1, 2, 6, 8 | Primary source for pilot results, accuracy by channel, uptake findings, and consent notice testing. Independent of Nagarika Labs. |
| 03_steering-committee-minutes_rcmc.md (meetings of 22 August 2024 and 18 June 2025) | Section 1 — key dates, expansion decision, budget line confirmation; Units 9, 10; Section 4 row for Data sharing MoU template; Section 2 gaps 3, 5, 7 | Primary source for governance decisions, PIA conditions, data-sharing commitments, and budget status. |
| 04_email-thread_lessons-for-share-back.md (as of 5 July 2025) | Section 2 gaps 6, 7; Section 4 shareability notes for pre-exposure test set and consent notices; Unit 4 (post-pilot red-team expansion to 750) | Primary source for share-back status and data sensitivity flags. Confirms and extends 01 and 02 on specific artifacts; adds the IVR transcript privacy concern not documented elsewhere. |