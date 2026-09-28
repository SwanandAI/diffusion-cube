# Diffusion Cube — Service Wiki

**Diffusion Cube** is the Next.js conversational companion to **100pathways.com** — a web app helping people adopt AI well by grounding advice in a corpus of real, documented deployments ("pathways"), compared against a user's own situation on a 4-dimension × 4-stage framework. It ships three products behind one app shell: a public pathway library (`/explore`), a signed-in Explorer analysis flow (`/analyse`), and a signed-in Contributor pipeline for turning a deployment write-up into a new corpus pathway (`/contribute`), plus an admin console (`/admin`).

This wiki is generated from the repository as it stands (branch `Swanand_DC`), verified file-by-file, and reconciled against this repo's own prior architecture/design documents where they've drifted from current code. Start with [`ai-context.md`](ai-context.md) if you're an AI agent orienting on this codebase; start with this page and [`architecture/architecture-overview.md`](architecture/architecture-overview.md) if you're a person.

For full navigation, see [`wiki-index.md`](wiki-index.md).

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

# Knowledge Base
* [Glossary](knowledge/glossary.md)
* [Technical Debt](knowledge/technical-debt.md)
* [References](knowledge/references.md)

---

*See also [`repository-map.md`](repository-map.md) for a folder-by-folder guide, and [`knowledge/legacy-artifacts.md`](knowledge/legacy-artifacts.md) for a "not part of this yet" checklist, before making changes.*
