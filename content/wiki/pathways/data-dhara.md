---
type: Pathway
title: AI for Government Data Interoperability — National
description: A horizontal data-unlock pathway (Data DHARA) turning fragmented, siloed government records into coordinated, machine-readable systems — illustrated through Nivesh Suvidha (Invest UP) and three sibling deployments.
tags: [Data Infrastructure, Governance]
stage: Define
timestamp: 2026-05-01
---

# Overview

Data DHARA is a horizontal enabler pathway, not a single deployment: each
implementation solves a local use case while generating reusable
technical assets and non-technical know-how that lowers cost and
uncertainty for every subsequent adopter. The core thesis: AI adoption
in citizen delivery systems is blocked less by absence of data than by
absent institutional pathways — governance, inter-departmental
coordination, and operational trust — that turn fragmented information
into coordinated, machine-readable systems.

**Four sibling pathways have emerged from pilots:**

| Pathway | Issue | Reusable asset |
|---|---|---|
| Delhi vital statistics → health outcomes | Vital-statistics data locked inside departmental PDFs, not linkable across health/nutrition/education systems | Cross-department linkage playbook + data harmonisation/linkage toolkit + AI-readiness dataset score |
| Invest UP — Nivesh Mitra / **Nivesh Suvidha** | Investment policy intelligence fragmented across 45 UP departments; ~15,000 investor queries backlogged | Document taxonomy, metadata schema, and a chatbot answering policy/scheme/land questions with traceability to source documents |
| Invest UP — UPSIDA | Manual, hard-to-audit land-allotment scoring across 43 investor-facing services | 7 reusable use-case categories (verification, eligibility scoring, policy intelligence, calculation, decision support, certificate generation, incentive assessment) |
| Data for exports (first-time MSME exporters) | Trade, registry, and compliance data fragmented, English-only, and priced for large exporters only | Schema-normalised, multilingual trade/registry datasets for the long tail of MSME exporters |

This concept focuses primarily on **Nivesh Suvidha** (Invest UP), the
sub-pathway with the most detailed interview material (the "Six
Shifts" structured interview), with the other three cited where they
add a distinct lesson.

**Where this pathway doesn't apply.** Weakest where an institution has
no willingness to name a nodal owner for data, or where the underlying
data genuinely doesn't exist yet (rather than existing but being
fragmented/siloed/PDF-locked).

# Problem

## Explore

It's not a data problem — it's an institutional-alignment and
process-redesign problem that data insights can power. Across every use
case touched (vital statistics, investment promotion, exports), the
authoritative data exists but is stale, siloed, un-linkable, or trapped
in PDFs. For an AI pipeline, a PDF is not data — it's a picture of data.

## Define

For Nivesh Suvidha specifically: Udyami Mitras (investment facilitation
officers) and investors couldn't get timely, accurate answers on
policy, scheme, incentive, and process questions — answers were buried
in unstructured circulars, manuals, GOs, and hidden URLs. ~15,000
investor queries had accumulated, evidencing the operational burden of
fragmentation, not absence of information.

## Pilot

The first visible proof point that made the institution believe the
system worked: an Udyami Mitra team spent a week searching for a
document, failed, then watched the AI retrieve it in seconds on a demo
call.

## Scale

A sectoral pathway compresses the next deployment in that sector; data
unlock is the horizontal that lets every vertical pathway start closer
to the finish line.

# Persona

## Explore

Two personas for Nivesh Suvidha: investors looking to set up business
in UP, and Udyami Mitras (account managers/facilitation officers for
investors) — qualified professionals whose role is to speed up
investment decisions but who instead spend significant time finding
even basic information.

## Define

The demand signal was real, not assumed: Udyami Mitras' actual role is
support and speed, and the fragmentation directly undermined the job
they were hired to do.

## Pilot

The 20 Udyami Mitras in the first pilot cohort were not trained before
access — use itself was the training. Query complexity progressed
naturally: simple policy questions → scheme eligibility → routing
support → subsidy calculations.

## Scale

Design intent is explicit: investors should become more capable of
navigating the investment process, not more dependent on a helpline —
agency, not dependency, is the target outcome.

# Technology

## Explore

Data is not ready for AI to use as-is. A document schema was built:
title, summary, text, category, sub-category, document type, tags,
policy year, issuing department, fee, timelines, approval phase.

## Define

Architecture: hybrid — hosted on InvestUP's own cloud infrastructure
with full data/code ownership sitting with InvestUP; AWS used during
the build phase for speed, then migrated. Cloud-agnostic, open-source
foundation layer, separable from the vendor instance to avoid lock-in.

## Pilot

All data used is publicly available and owned by InvestUP — no
sensitive or confidential data involved, so no formal data-access
approval was required; the vendor's access is operational-only and
revocable, with every AI output traceable to a specific policy version.

For the Delhi vital-statistics pathway: a staged pipeline — dataset
inventory → metadata tagging → schema transformation →
dissemination-ready datasets → API access → discoverable catalogue →
agent/MCP access — runnable inside a department's own infrastructure.

## Scale

Reusable technical toolkits named explicitly: a structured,
machine-readable government policy/GO knowledge repo (reusable across
deployments); purpose-built investor UI toolkit; an open-source code
repo deployable by any state or agency; a telemetry/usage-analytics
framework.

# Institution

## Explore

No single nodal officer was appointed for data sourcing at the outset,
and more broadly there was no internal digital-transformation
leadership to own the AI agenda — decisions and momentum depended
entirely on the CEO, a fragile foundation.

## Define

Invest UP (under UP's Infrastructure & Industrial Development
Department) is the nodal institution; the Invest UP CEO signs off on
budget and project. From MoU (Nov 2025) to SOW (Jan 2026) to a live
pilot with 20 Udyami Mitras (~March 2026) took roughly 3-4 months.

## Pilot

What to do differently for the next use case: request a designated
nodal officer (SME) upfront; identify all data/access requirements and
get owner timeline commitments before work begins; invest in in-person
engagement with both the working team and the CEO early, not only at
signing and final demo.

## Scale

Building and sustaining an AI system requires capabilities most
government institutions don't yet have — data management, prompt
engineering, system maintenance. Without deliberate capacity building,
institutions stay dependent on external vendors indefinitely, with no
path to self-sufficiency.

# Ecosystem

## Explore

An August 2025 workshop at EkStep's Bangalore office first brought
Invest UP leadership, the Udyami Mitra team, and market/ecosystem
players together — EkStep presented the Data & AI Readiness project;
teams shared operational challenges directly.

## Define

Named roles: Invest UP (nodal institution, supplies/validates data),
Kenpath Technologies (vendor, builds and maintains tools/pipeline/
chatbot/telemetry), EkStep/People+AI (AI expertise, owns the reusable
DPG layer), Anthropic (model supplier), 26 Nivesh Mitra issuing
departments (indirect contributors via their process-flow documents),
Udyami Mitras across 75 districts (front-line users).

## Pilot

Coordinating across institution, vendor, and ecosystem partners
required significant orchestration effort from a neutral organisation
(EkStep) — the absence of a single nodal officer meant sourcing required
chasing multiple stakeholders, and coordination between the
institutional team and the vendor team needed more deliberate structure
than was initially in place.

## Scale

Contribution and ownership beyond the CEO stayed limited — other team
members showed low engagement partly because the initiative sat outside
their core mandated work. Scaling to more departments/states requires
solving this, not just replicating the technology.

# Workforce

## Explore

Not distinctly documented separately from Pilot in this source.

## Define

Not distinctly documented separately from Pilot in this source.

## Pilot

Frontline users (Udyami Mitras) were not trained — access was the
training, with complexity absorbed incrementally through natural query
progression. Effectively all decisions still require human judgment:
policy interpretation, scheme eligibility, land allotment approvals,
and investor routing remain with human officers — the AI surfaces
information and options, judgment and accountability stay with the
institution.

## Scale

Lack of internal digital-transformation leadership (no Chief Digital
Officer / Chief Data Officer) means no one owns the AI agenda
institutionally at scale — named explicitly as a drawback of AI
adoption in the state.

# Operating Model

## Explore

Not distinctly documented separately from Define in this source.

## Define

Velocity came from in-person engagement with leadership (the CEO as
central decision-maker) — gaining confidence in the broader vision,
not positioning this as a standalone technical deliverable — and from
building iteratively as deployment revealed gaps, rather than waiting
for a complete centralised policy repository.

## Pilot

Cost drivers: cloud cost and LLM (Claude credit) usage — the latter is
also where costs unexpectedly increased. Steady-state (post-pilot)
requires: infrastructure/LLM usage tracking, a process to self-update
the knowledge repo, a self-hosted-vs-subscription LLM decision,
continuous feedback collection, and continuous enhancement of the
knowledge repo.

## Scale

Named drawbacks of AI adoption at state scale: no internal digital-
transformation leadership; capacity-building gap for 0-to-1 deployment;
dependency on SIs/consultants/vendors with no internal capability
transfer; vendor procurement ties institutions to poor performers with
no easy exit; vendors go "out of sight, out of mind" post-engagement
with no SLAs; poor access to appropriate data with no central
repositories or ownership structures.

# Lessons for the Next Adopter

* Treat the "data problem" as an institutional-alignment and process-redesign problem — data pipelines and APIs are necessary but not sufficient.
* Name a nodal officer for data sourcing before work begins; a project that depends entirely on one senior sponsor (like a CEO) has a fragile foundation.
* Package every engagement into two components: a reusable technical toolkit and the non-technical mechanisms (institutional anchoring, coordination, playbook) that make it land — the second is roughly 70% of the value.
* Design the AI as an advisory layer that keeps judgment and accountability with human officers, not a decision-making replacement.
* Budget explicitly for the capacity-building gap — without it, institutions stay dependent on vendors with no path to self-sufficiency.

# Citations

[1] Data Unlock Project Thesis — `../../All Pathways/5. Data DHARA pathway - Nivesh Suvidha. /Data Unlock Thesis.pdf`
[2] Six Shifts & Deployment Questions (Nivesh Suvidha interview) — `../../All Pathways/5. Data DHARA pathway - Nivesh Suvidha. /Six Shifts responses.pdf`

Related pathway: [Blue Dots](blue-dots.md) and [CEEW Climate Intelligence](ceew-climate-intelligence.md) (share the "coordination and governance, not absence of data" diagnosis).
