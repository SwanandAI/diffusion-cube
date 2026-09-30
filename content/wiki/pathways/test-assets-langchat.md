---
title: LangChat Multilingual Chat
description: A real-time multilingual chat platform where each participant writes and reads in their own language, removing the need for a shared language in group conversations.
stage: Explore
sector: Technology / Communication
location: Maharashtra, India
tags: [Multilingual Chat, Real-Time Translation, Language Inclusion]
---

# LangChat Multilingual Chat

## Section 0 — Reading guide

This document is written for the next team building a real-time multilingual chat product — one where participants write in their own language and read others' messages translated into their own language. It is not a case study of what was built. It is a record of the decisions made, the alternatives considered, and the conditions under which those decisions apply, so that the next adopter can start where this one stopped.

Knowledge is organised across four dimensions — Persona, Solution, Institution, and Ecosystem — and across four stages of adoption: Explore, Define, Pilot, and Scale. This deployment has reached Explore stage. Coverage is densest there; Define, Pilot, and Scale cells are largely open and represent the work still ahead.

The reusable content is in Section 3. The retrieval guide in Section 6 maps common adopter questions to the relevant units by number.

---

## Section 1 — Pathway identity

| Field | Detail |
|---|---|
| Deployment name | LangChat Multilingual Chat |
| Sector | Technology / Communication |
| Geography | Maharashtra, India |
| Population served | People in group conversations who cannot follow discussion in the dominant language |
| Stage reached | Explore |
| Contributing organisation | Tekdi Technologies |
| Key dates | Not documented in the source |
| Summary | LangChat enables real-time group chat where each participant writes in their own language and reads all messages translated into their own language. Real-time messaging is built on Supabase Realtime, an open-source third-party engine. The product design and data model are complete. No real users yet. |
| Scale / impact achieved | Not documented in the source |

**Cost anchor:** Not documented in the source

**Build effort:** Not documented in the source

**Known downstream adopters:** Not documented in the source

**Scope / does not transfer when:** Does not apply as-is where translation must be certified or legally admissible, or where participants cannot read text in their preferred language.

---

## Section 2 — Coverage grid and gaps

| Dimension | Explore | Define | Pilot | Scale |
|---|---|---|---|---|
| Persona | ●● | ○ | ○ | ○ |
| Solution | ●● | ●●● | ○ | ○ |
| Institution | ● | ○ | ○ | ○ |
| Ecosystem | ○ | ○ | ○ | ○ |

**Key:** ●●● dense · ●● covered · ● partial · ○ open

### Open gaps — priority order for this stage

1. **Named excluded user in Maharashtra context (Persona × Explore).** Unit 1 names passive non-participation as the workaround, but does not identify a specific community, workplace, or service setting in Maharashtra. Without this, the problem definition cannot be stress-tested and the solution scope cannot be bounded.

2. **Translation provider choice not yet made (Solution × Define).** Units 3 and 4 establish the abstraction layer and decision criteria, but no provider has been chosen and no comparative evaluation has been run. This is the single most consequential pending decision before any pilot.

3. **No institutional owner or governance named (Institution × Explore/Define).** Unit 6 flags the safety risk of wrong translations in high-stakes contexts, but names no owner, no approval process, and no redress mechanism. Without this, the safety concern remains identified but unmanaged.

4. **No ecosystem dependencies documented beyond Supabase Realtime (Ecosystem × all stages).** Translation provider, data residency agreements, and distribution channel across Maharashtra are all unnamed. These are unmanaged dependencies that will block Define and Pilot.

5. **Latency budget not set (Solution × Define).** Unit 7 includes a latency budget item, but no figure has been committed. Latency is named as a top concern; an unset budget means pilot success criteria cannot be defined.

6. **No pilot testing sequence documented as executed (Solution × Pilot).** Units 7 and 8 provide pre-pilot testing tools, but no evidence exists that either has been run or is planned against a specific timeline. The gap between template and execution is not yet closed.

---

## Section 3 — Micro-innovations

### Persona

**1. Start with the workaround, not the problem statement**

- **Dimension:** Persona
- **Stage:** Explore
- **Type:** Strategic Decision
- **Decision:** Define the excluded user by observing what they do when the formal system fails — the workaround reveals the real baseline against which any solution must compete.
- **Alternative considered:** Not documented in the source
- **Why:** In LangChat's case, the workaround was passive non-participation: people in group chats who cannot follow the dominant language resort to emoji reactions rather than substantive exchange. This is a lower baseline than "uses a bilingual intermediary" — it means the replacement bar is low, but it also means trust and habit formation are the real challenges, not feature parity.
- **What this looked like here:** The product lead observed group chats where one person follows everything and three others react only with emojis. That observation, not a market analysis, drove the product definition.
- **Condition — applies when:** The excluded user is invisible in usage data because non-participation leaves no signal. Workaround observation is the only reliable evidence method in these cases.

---

### Solution

**2. Per-recipient translation rather than a single pivot language**

- **Dimension:** Solution
- **Stage:** Explore
- **Type:** Strategic Decision
- **Decision:** Translate every message into each recipient's chosen language rather than translating everything into one shared language such as English.
- **Alternative considered:** Single pivot language (e.g. English) for all participants.
- **Why:** A single pivot language relocates the exclusion rather than removing it. For a population where English is itself the barrier, an English-pivot system serves the already-included and excludes the same people the product is meant to reach.
- **What this looked like here:** The LangChat product lead named English-as-pivot explicitly as the failure mode the architecture was designed to avoid. Per-recipient translation is the founding design decision.
- **Condition — applies when:** The target population has no shared language at all, including no shared second language. If participants share a comfortable second language, a pivot approach is simpler and cheaper.

**3. Original message always accessible alongside the translation**

- **Dimension:** Solution
- **Stage:** Explore
- **Type:** Strategic Decision
- **Decision:** Store the original message permanently and give every participant a one-tap way to view it next to the translation.
- **Alternative considered:** Show only the translated message; original not surfaced.
- **Why:** Machine translation loses context on names, numbers, dates, and idioms. Bilingual participants in a group can act as a natural correction layer — but only if they can see the original. Hiding it removes the fastest and cheapest quality-check available.
- **What this looked like here:** The inline "view original" toggle is a product feature, not a safety afterthought. The product lead named bilingual group members as a quality-check mechanism.
- **Condition — applies when:** Groups contain at least some bilingual participants, or when the cost of a wrong translation is high enough that a correction mechanism is needed before formal review is triggered.

**4. Provider-agnostic translation interface built before provider is chosen**

- **Dimension:** Solution
- **Stage:** Define
- **Also relevant at:** Pilot
- **Type:** Strategic Decision
- **Decision:** Route all translation calls through a single provider-agnostic abstraction layer so that the provider can be swapped without changing chat code.
- **Alternative considered:** Integrate directly with a chosen translation API.
- **Why:** Latency and cost per message are the two variables most likely to force a provider change after the pilot. Direct integration would make that change expensive. The abstraction layer makes provider substitution a configuration decision rather than a rebuild.
- **What this looked like here:** The layer was built before a provider was chosen — the architecture decision preceded and enabled the provider evaluation, not the reverse.
- **Condition — applies when:** Provider selection is genuinely undecided at the time of build, or when cost and latency requirements are not yet known. If a provider is already contractually committed, the abstraction layer adds complexity without near-term benefit.
- **Before → After:** Not documented in the source — no provider has been chosen yet, so the before/after of a provider swap has not been observed.

**5. Supabase Realtime as the real-time messaging infrastructure**

- **Dimension:** Solution
- **Stage:** Define
- **Type:** Tactical Decision
- **Decision:** Build LangChat's live messaging layer on Supabase Realtime, an open-source third-party engine, rather than on a custom WebSocket implementation.
- **Alternative considered:** Custom WebSocket implementation built in-house.
- **Why:** An open-source engine reduces the build effort required for real-time message delivery and benefits from community maintenance. Using a named, established open-source dependency rather than a custom build also makes the infrastructure layer inspectable and replaceable — consistent with the broader architectural posture of keeping components modular.
- **What this looked like here:** Supabase Realtime handles the live messaging layer; the translation layer sits above it and is kept separate. This separation means a future switch of either component does not require rebuilding the other.
- **Condition — applies when:** The team has no strong reason to own the WebSocket layer itself and latency characteristics of Supabase Realtime are acceptable for the target use case. Does not apply where data residency requirements prohibit use of third-party open-source infrastructure, or where the messaging layer must be fully self-hosted from the outset.

---

### Institution

**6. Name the high-stakes exclusion zones before pilot, not after a failure**

- **Dimension:** Institution
- **Stage:** Explore
- **Also relevant at:** Define
- **Type:** Strategic Decision
- **Decision:** Produce a written statement of contexts this product must not be used for without human verification before any pilot begins — not as a response to an incident.
- **Alternative considered:** Address misuse contexts reactively as they arise during or after pilot.
- **Why:** A wrong translation in a medical, legal, or emergency context can cause direct harm. Identifying and communicating these exclusion zones in advance sets a boundary the institution can own and enforce. Reactive boundary-setting after a failure is reputationally and practically harder.
- **What this looked like here:** The product lead named medical advice as the primary worry. The launch checklist formalises this as a pre-pilot requirement: a written list of prohibited contexts plus a visible "machine-translated" label on every translated message.
- **Condition — applies when:** The product is general-purpose enough that users might apply it to high-stakes decisions the system was not designed to support. Domain-specific tools with narrow use cases face less risk from scope drift.

---

### Toolkit Assets

**7. Multilingual Chat Launch Readiness Checklist**

- **Dimension:** Solution / Institution
- **Stage:** Define
- **Also relevant at:** Pilot
- **Type:** Toolkit Asset
- **Toolkit asset:** A structured pre-pilot checklist covering six areas: problem and people (Persona), translation architecture (Solution), translation provider evaluation criteria, real-time experience requirements, safety and scope boundaries, and pre-pilot testing protocol. Version 0.1, published by LangChat / Tekdi Technologies.
- **Purpose:** Ensures a team has made — and documented — the minimum set of decisions required before exposing a multilingual chat product to real users. Items left "Not yet" become known, named risks carried consciously into the pilot rather than discovered as failures.
- **Reusable as-is:** The checklist is provider-agnostic and product-agnostic. Any team building real-time chat with per-recipient translation can lift it directly. The provider evaluation section is structured as a comparison table and works for any set of candidate providers.
- **Condition — applies when:** Participants each read one language well but share no common language, and message-level translation latency of one to two seconds is acceptable. Does not apply as-is where translation must be certified or legally admissible.

**8. Language QA Test Matrix — filled translation test set**

- **Dimension:** Solution
- **Stage:** Define
- **Also relevant at:** Pilot
- **Type:** Toolkit Asset
- **Toolkit asset:** A filled CSV test set of five phrase categories — greeting, number, name, idiom, and domain term — translated from English into Hindi, Tamil, and Bengali, with an explicit acceptance criterion per row. Categories and criteria: greetings must preserve informal-polite tone; numbers and dates must be reproduced exactly without change; person names must not be translated; idioms must convey meaning rather than literal words; domain terms may remain in English where no established target-language equivalent exists.
- **Purpose:** Provides a ready-to-run baseline test set for evaluating translation provider quality before pilot launch and for regression testing before each release. Each row is a pass/fail check, not a subjective assessment.
- **Reusable as-is:** The phrase set and acceptance criteria can be lifted directly for any Hindi, Tamil, or Bengali deployment. Teams targeting other languages can use the five category structure and per-row criteria format as the template and substitute their own phrases and expected outputs. The check_notes column carries the acceptance criterion in plain language, making native-speaker review straightforward.
- **Condition — applies when:** The deployment targets Hindi, Tamil, and/or Bengali as recipient languages and uses English as a source language for testing purposes. Phrase coverage is sufficient for a baseline check; teams with domain-specific vocabulary (legal, medical, agricultural) should extend the domain-term category before treating the set as complete.

**9. LangChat open-source codebase**

- **Dimension:** Solution
- **Stage:** Explore
- **Also relevant at:** Define, Pilot
- **Type:** Toolkit Asset
- **Toolkit asset:** The full LangChat codebase, publicly available at https://github.com/LangChat/langchat. Includes the real-time messaging layer (built on Supabase Realtime), the provider-agnostic translation abstraction layer, the data model separating messages from translations, and the per-recipient language preference architecture.
- **Purpose:** Gives another team a working starting point for building real-time multilingual chat, removing the need to design the core architecture from scratch. The translation abstraction layer and data model in particular embody the design decisions documented in Units 2–5.
- **Reusable as-is:** Open-source and publicly accessible. A team can fork the repository and adapt it for their own deployment context, provider choice, and language set without rebuilding the foundational architecture.
- **Condition — applies when:** The adopting team is building a product with the same core architecture — per-recipient translation, original message retained, provider-agnostic layer. Does not apply as-is where data residency requirements prohibit use of the underlying Supabase Realtime dependency, or where the messaging layer must be fully self-hosted.

---

## Section 4 — Toolkits and playbooks

| Unit | Asset / Playbook | Type | Reuse condition |
|---|---|---|---|
| 7 | Multilingual Chat Launch Readiness Checklist | Toolkit Asset | Applies when building real-time chat with per-recipient translation and latency of 1–2 seconds is acceptable; not for certified or legally admissible translation |
| 8 | Language QA Test Matrix — filled translation test set | Toolkit Asset | Applies directly for Hindi, Tamil, Bengali with English source; use category structure as template for other languages; extend domain-term rows for specialist vocabulary |
| 9 | LangChat open-source codebase | Toolkit Asset | Applies when building per-recipient multilingual chat on Supabase Realtime; review data residency requirements before use; fork and adapt for provider and language set |

<!-- toolkit-assets:start -->
### Toolkit asset files

Files and links the contributor has shared for reuse.

- **Multilingual Chat Launch Readiness Checklist** (File: LangChat-Multilingual-Chat-Launch-Checklist.pdf) — A pre-pilot readiness checklist for teams building real-time chat where each participant reads in their own language, covering persona, translation architecture, provider evaluation, real-time experience, safety, and testing. Reuse when: Applies when participants each read one language well but share no common language, and message-level translation latency of one to two seconds is acceptable; does not apply where translation must be certified or legally admissible. <!-- asset-id: asset-a2db0e4e-8eb3-4018-9c96-35f83f1230ab -->
- **LangChat open-source codebase** (Link: github.com) — Full open-source implementation of real-time multilingual chat with per-recipient translation, provider-agnostic translation layer, and Supabase Realtime messaging. Reuse when: Applies when a team wants to build real-time multilingual chat and can self-host or adapt an open-source codebase; requires a translation API provider to be configured separately. <!-- asset-id: asset-d577660c-5643-45c6-9c3d-1eed00fc574e -->
<!-- toolkit-assets:end -->

---

## Section 6 — Retrieval guide

*"Who is this product for — who is the excluded user?"* → Unit 1

*"Why translate per recipient instead of into a shared language like English?"* → Unit 2

*"How do users catch a wrong translation?"* → Unit 3

*"How do we avoid being locked into one translation provider?"* → Unit 4

*"What real-time messaging infrastructure does LangChat use?"* → Unit 5

*"Why use Supabase Realtime instead of building a custom WebSocket layer?"* → Unit 5

*"What contexts should we block this from being used in?"* → Unit 6

*"What do we need to decide before our first pilot?"* → Unit 7

*"We haven't chosen a translation provider yet — what should we be evaluating?"* → Unit 4, Unit 7

*"We're worried about harmful translations — what safeguards exist?"* → Unit 3, Unit 6, Unit 7

*"What is the minimum architecture we need before a pilot?"* → Unit 2, Unit 4, Unit 5, Unit 7

*"How do we test translation quality before going live?"* → Unit 8

*"We're targeting Hindi, Tamil, and Bengali — is there a ready test set we can use?"* → Unit 8

*"What acceptance criteria should we set for translation quality?"* → Unit 8

*"How do we structure a translation QA process that a native speaker can run?"* → Unit 8

*"Is there existing code we can build from rather than starting from scratch?"* → Unit 9

*"Where can we find a working implementation of the per-recipient translation architecture?"* → Unit 9

*"What questions are still unanswered in this deployment?"* → Section 2 gaps

---

---
*Source Trace appendix — contributor-facing only, never surfaced in adopter responses*

| Source file | Covers | Notes |
|---|---|---|
| Adoption Companion conversation, as of 30 September 2026 | Section 1 — all identity fields; Section 2 — stage, geography, population, contributing organisation; Unit 5 — Supabase Realtime named as infrastructure dependency; Unit 9 — LangChat open-source codebase URL and contributor description; meta confirming Explore stage | Contributor's own account; not independently verified |
| LangChat-Product-Discovery-Interview.docx, as of 30 September 2026 | Units 1, 2, 3, 4, 6 — Decision, Alternative considered, Why, What this looked like here fields; Section 1 summary; Section 2 gap narrative | Primary source for all product-level decisions and product lead quotes |
| LangChat-Multilingual-Chat-Launch-Checklist.pdf, as of 30 September 2026 | Unit 7 — full Toolkit Asset entry; Section 4 table entry for Unit 7; Section 1 scope/does-not-transfer field; Section 2 gaps 5 and 6; confirms Unit 6 safety concern | Primary source for launch checklist toolkit asset; v0.1 template |
| LangChat-Language-QA-Test-Matrix.csv, as of 30 September 2026 | Unit 8 — full Toolkit Asset entry; Section 4 table entry for Unit 8; Section 6 retrieval entries for Unit 8; Section 2 gap 6 (partial — confirms testing tool exists but not yet executed) | Primary source for QA test matrix toolkit asset; filled test set with five phrase categories across Hindi, Tamil, Bengali |
| https://github.com/supabase/realtime, as of 30 September 2026 | Unit 5 — confirms Supabase Realtime is an open-source third-party engine, not a custom WebSocket implementation | Confirms only; no additional facts drawn beyond confirming the nature of the dependency |
| https://github.com/LangChat/langchat, as of 30 September 2026 | Unit 9 — full Toolkit Asset entry; Section 4 table entry for Unit 9; Section 6 retrieval entries for Unit 9 | Primary source for open-source codebase toolkit asset; contributor confirmed publicly accessible and reusable |