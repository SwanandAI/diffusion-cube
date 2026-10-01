# The AI Diffusion Pathway Framework

This framework serves two purposes: (1) generating a structured pathway document from raw source material, and (2) guiding an adopter conversationally toward relevant know-how. Both uses draw on the same underlying structure — dimensions, sub-categories, stages, unit types, and insight forms — just applied in different directions: generation extracts units from raw text into this structure; adopter guidance retrieves units from this structure to answer a live question.

## The four dimensions

| Dimension | Central question | Sub-categories |
|---|---|---|
| Persona | Are we solving the right problem for the right person? | A. Problem and Persona · B. Current Journey and Friction · C. Outcome and Success · D. Scope, Inclusion, and Trust |
| Solution | Are we building the right system to solve it? | A. AI Fit and Comparative Advantage · B. UX, Channel, and Integration · C. Model, Architecture, and Infrastructure · D. Data and Knowledge Readiness · E. Performance, Reliability, and Scale |
| Institution | Can the institution own, absorb, govern, and sustain it? | A. Mandate, Ownership, and Decision Rights · B. Workforce and Change · C. Governance, Safety, and Redress · D. Accountability, Liability, and Compliance · E. Data Stewardship · F. Operating Model and Sustainability · G. Institutionalisation and Continuous Improvement |
| Ecosystem | Can the required network of actors execute and support it? | A. Partner Architecture and Roles · B. External Data and Infrastructure Dependencies · C. Delivery, Distribution, and Trust · D. Coordination, Procurement, and Incentives · E. Resilience, Portability, and Contingencies · F. Ecosystem Learning and Diffusion |

**30/70 thesis:** Persona + Solution = defining and building the right thing. Institution + Ecosystem = the larger work of enabling adoption, accountability, and sustainability. Not four equal shares of effort.

## Cross-cutting concerns

**Data:**
- Persona — evidence for problem/population/outcome
- Solution — is data usable/reliable/current
- Institution — who owns/authorises/corrects it
- Ecosystem — external sources, agreements, SLAs

**Trust:**
- Persona — does the excluded user trust this channel enough to use it
- Solution — is trust conveyed through channel/UX choices — tone, disclosure, voice vs. text
- Institution — accountability: who the user blames when it's wrong, who stands behind the answer
- Ecosystem — trust in delivery partners and distribution channels, independent of the institution itself

## The four adopter stages

| Stage | Central question | Done when... |
|---|---|---|
| Explore | Is AI appropriate, and what would it take? | Precise excluded-user definition. Honest comparison with alternatives. Order-of-magnitude cost sense. |
| Define | What must be true before building? | Named data owners. Named mandate holder. Architecture posture chosen. Safety boundaries designed. |
| Pilot | What breaks with real users and real institutional conditions? | Failure taxonomy. Named institutional response to first public failure. Real cost-per-interaction data. |
| Scale | Can the institution own, sustain, and continuously improve it? | Budget line. Named operational owner. Monitoring mechanism. Operating model written down. |

## The question bank — insight forms per dimension × stage

### EXPLORE — Is AI the right answer, and what would it take?

| Dimension | Core question | Listening for | Insight form | Corpus example |
|---|---|---|---|---|
| Persona | Who specifically is excluded from this service today — and what do they do instead? | The workaround is the data. It reveals the real replacement baseline. | Excluded user + named barrier + current workaround | MahaVISTAAR: women farmers receiving contradictory advice from fertiliser sellers. No trusted official source in their language. |
| Solution | What channel or system are you replacing, what does it fail at, and is AI actually the right tool for that failure? | Two human callers, paper forms, nothing — plus honest reasoning on AI-fit vs simpler fixes. | Current channel + failure mode + AI-fit justification | Blue Dots: an ITI field visit in Dharwad found four in five job seekers had no resume, and employers advertised on posters, poles, and auto-rickshaws — not portals. That redirected the team to voice before a line of code was written. |
| Institution | Who inside the institution has to personally want this to work — and do they know yet? | Not procurement sign-off. The person whose professional stake is tied to success. | Named champion + their specific stake | Bhili Language Enablement: the Nandurbar District Collector personally convened the effort and chaired the language-prioritisation meeting — a prior tribal posting had already shown her what changes when a service speaks someone's own language. |
| Ecosystem | Who else has tried to solve this for this population, and what happened? | Precedent deployments, failed attempts, adjacent tools. Who do they trust as a reference peer? | Named precedent + what transferred + what didn't | Voice AI for Inclusion: the same architecture went from 9 months (MahaVISTAAR, built from scratch) to 3 months (Ethiopia's ATI) to 3 weeks (Amul/Sarlaben). The build compressed each time; trust-building and data partnerships still had to be redone locally. |

### DEFINE — What are the irreversible decisions?

| Dimension | Core question | Listening for | Insight form | Corpus example |
|---|---|---|---|---|
| Persona | What is the one question a user will ask that this system must answer, or the pilot fails? | Forces scope to its minimum. Shapes data model, prompt design, safety boundaries. | Single critical use case + binary success definition | Voice AI Adoption Barriers: Pradical Works fixed connect rate, talk-time distribution, and lead conversion as success metrics before a single call went out — the resulting pilot data was measurably cleaner than every other pilot in the same cohort. |
| Solution | Which architecture choices, if wrong, would take six months to undo — and is every data source named, with an accountable owner for each? | Residency, vendor lock-in, sovereignty, orchestration ownership. Not "government data" — ICAR, IMD, APMC, named humans. | Irreversible decisions list + data source registry (source × owner × cadence × accountability) | Blue Dots: building open, UPI-style shared rails instead of a platform any one organisation owns is named directly as the single most consequential, hardest-to-reverse decision in the pathway. |
| Institution | Who approves what the system says, have they agreed to own that, and what testing/timeline has the institution committed to before real users? | Content authority, not technical sign-off. Staged testing with named gate criteria. | Content authority + approval process + testing progression | African Voice AI: testing runs through a named, gated sequence — internal team, then partner staff, then field agents, then real farmers — with no stage advancing until its own criterion is actually met, not just scheduled. |
| Ecosystem | Which parts can you not build yourselves — and do you have a named partner for each? | Data owners, language models, telephony partners, integrators, field networks. Unnamed dependencies are unmanaged risk. | Dependency map: component × build-or-source × named partner | Bhili Language Enablement: eight distinct ecosystem roles, all named before model work. Project stalled when the linguist role was unnamed for three months. |

### PILOT — Live with real users. What's breaking?

| Dimension | Core question | Listening for | Insight form | Corpus example |
|---|---|---|---|---|
| Persona | Which user interactions are failing — is that a scope problem or a quality problem? | Scope = outside mandate. Quality = mandate questions answered badly. Different fixes. | Failure taxonomy: scope vs quality vs experience | AI-Assisted Job Matching: pilot support issues are logged into eight categories from day one — software, data, vacancy input, recommendation quality, workflow, access, training, unknown — so a bad recommendation's real cause is never guessed at after the fact. |
| Solution | Which component is causing the most pain, is it replaceable, and which data source is going stale or wrong? | Bundled-vs-unbundled plays out here. Data quality failures at Pilot look like AI failures to users. | Component failure + replaceability + data quality issue + owner response time | MahaVISTAAR: mandi price 48hr lag caused wrong harvest-timing advice. Fix: governance call with APMC to 6-hr cadence — not a technical fix. |
| Institution | What has the institution seen fail publicly — and did they own it or disown it? | How the institution responds to the first failure is the strongest signal about whether this scales. | First public failure + institutional response (own vs disown) | Bhili Language Enablement: in a live field demo, the helpline answered a farmer's cotton-pest question directly and declined a scheme question outright — "I will answer only farming-related questions" — rather than guessing to seem more capable. |
| Ecosystem | Which partner is underperforming — and do you have an alternative? | Mid-pilot switching is painful but possible. Post-scale switching requires a rebuild. | Partner performance log + contingency plan | Voice AI for Inclusion: running more than one vendor in parallel during the pilot revealed real comparative performance and added only a 2–5% cost premium in one deployment — far less than the lock-in risk it removed. |

### SCALE — Expanding to population. Can the institution own this without the founding team?

| Dimension | Core question | Listening for | Insight form | Corpus example |
|---|---|---|---|---|
| Persona | Are new user segments arriving that the pilot wasn't designed for? | Scale reveals "the user" was multiple users — feature phone vs smartphone, dialect A vs B. | User segment expansion map + design change required per segment | Blue Dots: a model tuned for Dharwad's Kannada underperformed in a neighbouring district using the "same" state language. A local glossary and pace-matched conversation design recovered the engagement a single state-language model had cost. |
| Solution | Which components are you now unbundling, what triggered it — and which data sources are breaking under scale, do formal SLAs exist? | Cost/control arguments become concrete numbers at scale. | Unbundling decision (component × trigger × gain) + data SLA map | Voice AI for Inclusion: Bharat-VISTAAR required formal data SLAs with 12 state agriculture departments. Each became an accountable node, not just a data source. |
| Institution | Has the institution absorbed this — budget line, named owner, review cadence — and does the system leave people more capable or more dependent? | Absorption vs "still the project team's problem." Workforce agency outcome. | Absorption indicators (budget + owner + review cadence) + agency outcome (capability vs dependency) | African Voice AI: every contract in the programme ends in 2026 and the compute allocation expires that November — the team names "who maintains this SDK in three years" as a still-open funding and governance question, not a technical one. |
| Ecosystem | What from your deployment could the next adopter reuse — with what conditions? | Not "we did X." "X works when Y is true, fails when Z is true." | Transferable unit + condition tag (applies when / fails when) | Nivesh Suvidha: schemas, pipelines, and governance approaches were designed from day one to be picked up by the next state or department — not one-off artefacts. Infrastructure built once and shared is a public good; built once and siloed is technical debt. |

## Exhaustive List of Questions
### 1. Persona Dimension
*From starting with AI to starting with a specific human outcome*

#### A. Problem and Persona
- What is the specific problem or pain point being addressed?
- Who specifically experiences this problem?
- In what context, location, language, or circumstance do they experience it?
- Who is currently excluded or underserved, and why?
- What evidence shows that this is a meaningful and persistent problem?

#### B. Current Journey and Friction
- How is this need addressed today?
- Which people, channels, systems, and institutions are involved in the current journey?
- Where does the current approach fail, slow down, become unaffordable, or exclude people?
- What do users currently do when the formal system does not work?
- Is AI addressing the actual bottleneck, or merely adding another layer to an already broken process?

#### C. Outcome and Success
- If the intervention works, what will be different in the persona's life, decision, or experience?
- What measurable outcome will demonstrate that the problem has been addressed?
- What is the scale of the affected population and the expected depth of impact?
- How quickly must the outcome occur for it to be valuable?
- What leading indicators would show that the solution is moving toward the intended outcome?

#### D. Scope, Inclusion, and Trust
- What is the system expected to do, and what is explicitly outside its scope?
- What questions, decisions, or situations must be refused or escalated?
- Which languages, accessibility needs, and edge-user groups must be supported?
- What would make the persona trust, use, or reject the solution?
- Are new user segments appearing that the original design did not anticipate?
- Does the solution strengthen the persona's agency and capability, or create new dependency?

### 2. Technology Dimension
*From choosing a model to designing a reliable and adaptable system*

#### A. AI Fit and Comparative Advantage
- What capability is required: language understanding, speech, vision, prediction, recommendation, generation, or autonomous action?
- Why is AI appropriate for this problem?
- What was the pre-AI approach?
- What outcome can AI improve that could not be improved sufficiently through process redesign, digitisation, rules, or conventional software?
- What evidence would show that AI is materially moving the needle?

#### B. User Experience, Channel, and Integration
- Through what channel will the persona encounter the solution: phone, app, messaging, assisted interface, or an existing institutional system?
- Why is that channel appropriate for this persona?
- Which existing systems, databases, workflows, and APIs must it integrate with?
- What happens when an upstream system, data source, or external service is unavailable?
- Where does a human enter, review, or take over the journey?
- How will the experience communicate uncertainty, delay, refusal, or failure to the user?

#### C. Model, Architecture, and Infrastructure
- What level of model capability is adequate for the problem?
- What constraints determine the model choice: quality, language support, latency, cost, privacy, or sovereignty?
- What are the choices of compute, hosting, and deployment environment?
- Which architecture decisions would be difficult or expensive to reverse?
- Which components must remain modular and replaceable?
- What is the vendor posture, and how will lock-in be avoided or managed?
- What must remain within the institution, and what may travel to an external model or service?

#### D. Data and Knowledge Readiness
- What data and institutional knowledge does the system require?
- Does each source exist in a usable, machine-readable form?
- How current, complete, and representative must each source be?
- How will stale, conflicting, incomplete, or incorrect data be detected?
- Who maintains the technical pipeline that keeps the data available and current?
- What data is collected from users, and is all of it necessary?
- What data stays with the institution, and what is shared with models, vendors, or partners?

#### E. Performance, Reliability, and Scale
- What does "good enough" performance mean for this particular use case?
- How will quality be evaluated before and during deployment?
- Which failures are model failures, data failures, integration failures, scope failures, or experience failures?
- What are the latency, availability, and cost-per-interaction requirements?
- Which component is currently causing the most pain, and can it be replaced independently?
- How does performance change across languages, user groups, environments, and scale?
- How will the system be monitored, evaluated, and improved after launch?

### 3. Institution Dimension
*From sponsoring a project to owning a sustainable service*

#### A. Mandate, Ownership, and Decision Rights
- Which institution has the mandate to deploy and stand behind the solution?
- Who inside the institution must personally want this to succeed?
- Who is the named institutional owner?
- Who approves what the system is permitted to say or do?
- Which decisions require administrative, policy, legal, procurement, or technical approval?
- Has the institution formally authorised its knowledge, data, workflows, and public authority to be used in this way?
- Who has the authority to pause, change, or discontinue the service?

#### B. Workforce and Change
- Which frontline and institutional roles will be affected?
- How will their work, authority, incentives, and responsibilities change?
- Do workers see the system as support, surveillance, additional work, or replacement?
- Who must test and approve the system before it reaches users?
- What capability-building is needed before, during, and after deployment?
- Are workers using the system as intended, or creating workarounds?
- Does the system leave people more capable, or more dependent?
- If the original project team or senior sponsor leaves, does the institution retain the capability?

#### C. Governance, Safety, and Redress
- What decisions may the AI make, recommend, or support?
- Which decisions must always remain with a human?
- What are the known risks to users, institutions, and affected third parties?
- What safeguards, tests, approval gates, and monitoring mechanisms are required?
- Who monitors incidents and responds when failures occur?
- What is the escalation and redress mechanism for users?
- What records must be retained for auditability?
- How will the institution learn from incidents without disowning the service after the first public failure?

#### D. Accountability, Liability, and Compliance
- Who is answerable when the system produces a harmful, incorrect, or inappropriate outcome?
- Who carries legal, regulatory, contractual, and reputational liability?
- What legal basis permits the collection, processing, and use of data?
- Which privacy, consent, accessibility, sectoral, and procurement obligations apply?
- How are responsibilities divided between the institution, vendors, and implementation partners?
- What assurance, documentation, and audit evidence must be maintained?
- Who signs off that the service is compliant before launch and after material changes?

#### E. Data Stewardship
- Who has the authority to permit the use of institutional data and knowledge?
- Who is accountable for the accuracy and continued maintenance of each internal source?
- What access, consent, licensing, residency, retention, and deletion rules apply?
- Who can update, correct, withdraw, or override institutional information?
- How will disputes between sources or departments be resolved?
- Is the AI layer presenting institutional knowledge, or unintentionally becoming the new source of truth?

#### F. Operating Model and Sustainability
- Who pays for design, setup, integration, and initial deployment?
- Who pays in year two and beyond?
- What is the actual cost per interaction, transaction, or beneficiary?
- Who operates the service day to day?
- Who handles failures, user support, vendor management, and escalation?
- Who updates internal data, approves model changes, and maintains institutional integrations?
- What staffing and capabilities must remain permanently within the institution?
- Is there a recurring budget line, or does the deployment still depend on project funding?
- What must be true for the institution to commit to long-term operation?

#### G. Institutionalisation and Continuous Improvement
- Has the solution become an institutional service, or is it still treated as an external project?
- Is there a named owner, permanent team, budget, service standard, and governance mechanism?
- Can the service survive a leadership change, staff transfer, vendor change, or funding transition?
- How will user feedback, incidents, performance evidence, and policy changes lead to service improvements?
- What signals show that the institution is adopting the service rather than merely hosting a pilot?
- How will the institution periodically reassess whether the solution remains necessary, safe, and effective?

### 4. Ecosystem Dimension
*From procuring inputs to coordinating a network of capabilities*

No population-scale AI deployment is delivered by one organisation alone. The Ecosystem Dimension examines the actors, capabilities, dependencies, agreements, and trust relationships that sit outside the deploying institution but are necessary for the service to work.

#### A. Partner Architecture and Roles
- Which external partners are required across technology, domain expertise, data, implementation, financing, research, and last-mile delivery?
- What precise role, output, and outcome is each partner responsible for?
- Which capabilities cannot be provided by the deploying institution itself?
- Are all critical dependencies and unnamed roles visible before building begins?
- Who is responsible for integrating the work of different partners into one functioning service?
- Which relationships are transactional vendor relationships, and which require long-term collaboration?

#### B. External Data and Infrastructure Dependencies
- Which data sources, platforms, registries, models, networks, or infrastructure sit outside the deploying institution?
- Who owns, maintains, and is accountable for each external source or service?
- What permissions, contracts, APIs, standards, and service-level agreements are required?
- How quickly must external sources be updated, and what happens when they become stale or unavailable?
- How will conflicts between external sources and institutional sources be resolved?
- What external dependencies are currently informal and need to become durable agreements before scale?

#### C. Delivery, Distribution, and Trust
- Who takes the solution to the end user?
- Which actors already have the user's trust and access?
- Which partners provide assisted access, local language support, human escalation, or grievance resolution?
- Which organisation represents the service in the eyes of the user?
- How will feedback from frontline and community partners reach the institution and technology teams?
- Can the delivery network reach the groups most likely to be excluded?

#### D. Coordination, Procurement, and Incentives
- Who has the convening authority to resolve cross-organisational dependencies?
- What governance forum brings the institution and partners together to make decisions?
- Are partner incentives aligned with user outcomes and long-term service quality?
- What procurement and contracting arrangements support experimentation without creating permanent lock-in?
- How will changes in scope, cost, performance, or responsibility be negotiated?
- Who manages cross-partner performance and holds each actor to its commitments?

#### E. Resilience, Portability, and Contingencies
- Which partner, vendor, data source, or infrastructure provider is mission-critical?
- What happens if a critical partner underperforms, changes terms, or exits?
- Which partners, components, or capabilities require alternatives or contingency plans?
- Can data, workflows, knowledge, and service history be transferred to another provider?
- Which dependencies can be modularised, diversified, or brought in-house over time?
- What would have to be rebuilt if a major partner changed at Pilot or Scale?

#### F. Ecosystem Learning and Diffusion
- What assets, decisions, standards, failure modes, and lessons can the next adopter reuse?
- What knowledge should remain proprietary, and what should be shared as ecosystem infrastructure?
- Under what conditions will the approach transfer to another institution, sector, geography, or population?
- Where will local trust, policy, data, language, or delivery conditions require adaptation?
- Who is responsible for documenting and sharing what the ecosystem has learned?
- How will the deployment contribute back to the wider AI diffusion ecosystem and enable the next adopter to start where this one stopped?


## The pathway document — output structure

A pathway document is not a case study. A case study documents what was built. A pathway document is written for the next adopter — what they would need to decide, the alternatives they would consider, the conditions under which different choices are correct. Physical analogy: a pathway is not the route the pioneer took. It is the marked trail they left for the next traveller.

| # | Section | Purpose | Contents |
|---|---|---|---|
| 0 | Reading guide | Orients the adopter | What a pathway is. How retrieval works. Where reusable value concentrates. How to navigate by dimension/stage. |
| 1 | Pathway identity | Names the deployment for retrieval | Deployment name, sector, geography, population served, stage reached, contributing organisation, key dates, 2-sentence summary, Scale/impact achieved — Headline usage and outcome numbers, as-of date |
| 2 | Effort details | Details of cost, time and effort | 1. Cost anchor — Setup + run-rate cost order of magnitude, as-of date. 2. Build effort — Time, team size, partner count to reach current stage |
| | Downstream Adoptions | Known downstream adopters / reuse record | Who has since built on this pathway, and how much faster — pathway-level metadata, not a tagged unit |
| 2 | The 4×4 grid | Shows where knowledge is dense and where gaps remain | Coverage map: 4 dimensions × 4 stages, density symbols (●●● / ●● / ● / ○). Empty/thin cells checked against Primary sub-categories, not raw count. |
| 3 | Micro-innovations | The core reusable content | Tagged units organised by dimension, then stage. Each unit: decision, alternative considered, reason for decision, condition tag (applies when / fails when), context of the decision in the adoption, before→after outcome. |
| 4 | Toolkits and playbooks | Reusable artefacts and process knowledge | Technical templates, governance frameworks, testing protocols, prompt patterns, vendor criteria — each tagged with the purpose and conditions for reuse. |
| 5 | Problem→solution patterns | Maps recurring problems to known fixes | Problem → root cause → solution → result → condition. Built from Failure-and-Fix units and other clear problem→fix patterns across deployments. |
| 6 | Retrieval guide | Helps the next adopter find what's relevant fast | Organised by adopter intent (e.g. "I need to avoid vendor lock-in at Define stage") → points to relevant units and toolkit assets. |
| | Source Trace appendix (contributor-only — never adopter-facing) | Traces what was used to build the pathway, for future reconciliation | Table keyed by source file → which Sections/fields/units it covers, and whether it's primary or confirms-only |

## The five unit types

| Type | Definition | What makes it reusable |
|---|---|---|
| Strategic Decision | A framing, governance, or design decision that shaped what got built. Usually invisible in the final product. | The condition tag — when does this apply, when doesn't it? |
| Tactical Decision | A stack, sequence, cost, or implementation decision specific enough to reuse. | A before→after: what changed because of this decision. |
| Failure and Fix | Something that broke, the fix, and what the fix revealed about the system. | The fix reveals the structural insight — not the failure alone. |
| Playbook | A genuine multi-step, gated sequence — "do X, then don't proceed to Y until X clears, then Z." A single decision that merely sounds procedural is a Decision, not a Playbook. | The steps themselves, in order, with the gate between them — plus the common failure mode of skipping one. |
| Toolkit Asset | An actual reusable artifact — a checklist, template, schema, test set, glossary, or built tool — that someone else can lift and adapt without rebuilding it. A decision about how to structure something is a Decision, not a Toolkit Asset. | The artifact itself: what it is, what it's for, and what makes it liftable as-is. |

**Tag every unit:** Dimension + Sub-category + Stage + Type + Condition tag.

**Worked example — a single micro-innovation unit (Failure and Fix type):**
- **Failure:** Due to direct hardwiring of the AI layer to the ICAR database, a backend change required an AI-layer rebuild.
- **Fix:** Separated the AI layer from the data layer using a standardised API gateway. The AI system retrieves data but does not own it.
- **Insight:** At scale with multiple data sources, this is the difference between a maintainable system and a fragile one.
- **Condition — applies when:** Multiple data sources with different owners and update cadences; government deployment where data accountability must remain with named departments.
- **Before → After:** Before: data errors required rebuilding the bot prompt architecture. After: data errors are fixed by the data owner without touching the AI layer.

## Extraction discipline — applying to raw material

| Step | What it means |
|---|---|
| **Tag every unit** | Dimension + Sub-category + Stage + Type + Condition tag. No untagged units enter the corpus. `Also relevant at: [Stage, Stage]` — optional. Captures where a unit is useful beyond its stage of origin. Does not count toward the Section 2 coverage grid — grid density is driven by Stage (origin) alone, so gap-detection stays honest. This field feeds only the Section 6 retrieval guide and adopter-facing navigation. Stage reflects where the evidence was discovered (counted in the grid). "Also relevant at" reflects where it's useful (not counted, used for retrieval only). Never merge the two. |
| **Write the before→after** | Every tactical/strategic unit needs an outcome statement. Without it, it's a lesson, not a finding. |
| **Name the failure specifically** | "It didn't work" is not a unit. Name the failure, the fix, and the threshold or insight the fix revealed. |
| **Flag the gaps** | Check against Primary sub-categories per stage, not raw cell density — a filled cell can still miss its stage's real concern. |
| **Don't fabricate** | If a before→after, a named individual, or a condition isn't in the source, write "Not documented in the source" rather than inventing it. |

**The synthesis test:** Could someone who never saw the raw material make a different decision because of this unit? If yes, it's a real unit. If it just describes what happened, it isn't.

## Source Trace appendix — specification

The Source Trace appendix is contributor-only — never surfaced in any adopter-facing response, in any mode. A table keyed by source file, not by unit:

| Source file | Covers | Notes |
|---|---|---|
| [filename/doc, as-of date] | [Sections/fields/unit ranges populated from it] | [Primary source / confirms only / superseded by newer file, etc.] |

Rules:
- Key by raw source file, not by content item — scales better than a per-unit or per-field row.
- "Covers" should reference actual Section numbers and unit ranges (e.g., "Pathway Identity — all fields; Units 1–20; Toolkits table; Problem→Solution patterns"), not vague descriptions.
- When a file is derivative of another (a summary, an earlier draft), say so explicitly and mark it "confirms, doesn't add" rather than listing it as an independent source for the same content.
- This appendix sits outside the Section 0–6 count — it is not part of the adopter-facing structure.
