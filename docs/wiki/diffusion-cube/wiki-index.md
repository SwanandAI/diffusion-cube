# Diffusion Cube — Wiki Index

Navigational hub for this wiki. For the executive entry point, see [`README.md`](README.md). For the single most information-dense document (best first read for an AI agent), see [`ai-context.md`](ai-context.md).

# Executive Documentation
* [AI Context](ai-context.md)
* [Architecture Overview](architecture/architecture-overview.md)
* [Business Overview](business/business-overview.md)

# Business
* [Users](business/users-and-personas.md)
* [Workflows](business/workflows.md)
* [Business Rules](business/business-rules.md)

# Architecture
* [Components](architecture/component-diagram.md) (includes system context / C4-style context diagram)
* [Sequence & Workflow Diagrams](architecture/sequence-diagrams.md)
* [Configuration](architecture/configuration.md)
* [Testing](architecture/testing.md)
* [Coding Standards](architecture/coding-patterns.md)
* [Repository Conventions](architecture/repository-conventions.md)

# Application
* [Frontend](application/frontend.md)
* [Backend](application/backend.md)
* [APIs](application/api-specification.md)
* [Database](application/database.md)

# Integrations
* [AI/LLM](integrations/ai-llm.md)
* [Third Party Services](integrations/third-party-integrations.md)
* [Cache](integrations/caching.md)
* [Async Processing](integrations/async-processing.md)

# Operations
* [Infrastructure](operations/infrastructure.md)
* [Deployment](operations/deployment.md)
* [Monitoring](operations/monitoring.md)
* [Troubleshooting](operations/troubleshooting.md)
* [Disaster Recovery](operations/disaster-recovery.md)

# Knowledge Base
* [Glossary](knowledge/glossary.md)
* [Technical Debt](knowledge/technical-debt.md)
* [References](knowledge/references.md)
* [Legacy Artifacts](knowledge/legacy-artifacts.md)

---

# Document Control

| Attribute | Value |
|---|---|
| Service | Diffusion Cube (`ai-diffusion-cube-app`) |
| Branch analyzed | `Swanand_DC` |
| Generated | 2026-09-28 |
| Method | Full repository read (routes, components, `lib/`, all 32 migrations, content corpus, infra/CI config) plus reconciliation against this repo's own root-level architecture/design documents |
| Gaps | Called out with plain-language **Note** sections where details are not documented in this wiki (see [`repository-map.md`](repository-map.md) for the raw-documents note) |

# Source / Raw Documents

`docs/raw_documents/` holds two source documents, reconciled against code while writing this wiki — see [`architecture/architecture-overview.md#reconciliation-with-raw-architecture-documents`](architecture/architecture-overview.md#reconciliation-with-raw-architecture-documents) and [`business/business-overview.md#reconciliation-with-raw-business-documents`](business/business-overview.md#reconciliation-with-raw-business-documents) for claim-by-claim tables:

- [`../raw_documents/Pathway Framework.pdf`](../raw_documents/Pathway%20Framework.pdf) — the original AI Diffusion Pathway Framework specification (dimensions, sub-categories, stage weights, unit types, pathway document output structure). **Confirms, does not add**: `content/framework.md` and `content/pathway-generation-prompt.md` are a near-verbatim, current, accurate transcription of this document — no reconciliation gap found.
- [`../raw_documents/AI DIffusion Cube - Product Charter.docx`](../raw_documents/AI%20DIffusion%20Cube%20-%20Product%20Charter.docx) — product vision, scope, roadmap milestones (through 15-Mar-27), team/execution model, and a prioritized requirements backlog with status. Primary source for [`business/business-overview.md`](business/business-overview.md#roadmap-planned-not-yet-implemented)'s Roadmap section and several [`knowledge/technical-debt.md`](knowledge/technical-debt.md) items now marked as roadmap-acknowledged rather than purely organic gaps. **Contains a time-sensitive operational fact**: both the AWS account and the Anthropic/Claude API access this app depends on are free-trial grants with expiry dates (Claude API: 28-Oct-2026; AWS: plan for a replacement by Nov-2026) — see [`operations/deployment.md#operational-dependency-risk`](operations/deployment.md#operational-dependency-risk-from-the-product-charter).

The following root-level files serve the same secondary-reference role and were reconciled against code while writing this wiki:

- [`../../../ARCHITECTURE.md`](../../../ARCHITECTURE.md) — current, mostly accurate architecture narrative (one stale paragraph noted)
- [`../../../CLAUDE.md`](../../../CLAUDE.md) — AI-agent instructions describing an earlier app state
- [`../../../conversation_design.md`](../../../conversation_design.md) — companion tone/posture design doc, ~126 commits stale
- [`../../../specs/SIGNUP_OTP_SPEC.md`](../../../specs/SIGNUP_OTP_SPEC.md) — current, accurate auth spec
- [`../../../specs/SIGNUP_APPROVAL_OPTIONS.md`](../../../specs/SIGNUP_APPROVAL_OPTIONS.md) — superseded auth design proposal
- [`../../../specs/ACCOUNT_DELETION_SPEC.md`](../../../specs/ACCOUNT_DELETION_SPEC.md) — self-serve account deletion, password Show/Hide, sign-out confirmation
- [`../../../README.md`](../../../README.md), [`../../../AGENTS.md`](../../../AGENTS.md) — unmodified `create-next-app` boilerplate, no project-specific content

Full reconciliation detail and use-for-what guidance: [`knowledge/references.md`](knowledge/references.md).
