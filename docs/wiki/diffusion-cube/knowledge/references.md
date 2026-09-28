# References

## Raw documents (`docs/raw_documents/`)

| Document | Status | Use it for |
|---|---|---|
| [`Pathway Framework.pdf`](../../raw_documents/Pathway%20Framework.pdf) | Current and accurate — the original spec | Authoritative source for the 4×4 framework, unit types, and pathway document structure. `content/framework.md`/`content/pathway-generation-prompt.md` are a verified, near-verbatim, current transcription — no gap found |
| [`AI DIffusion Cube - Product Charter.docx`](../../raw_documents/AI%20DIffusion%20Cube%20-%20Product%20Charter.docx) | Current (roadmap through 15-Mar-27) | Product vision, scope, team/execution model, milestone roadmap, and a prioritized requirements backlog — see [`../business/business-overview.md#roadmap-planned-not-yet-implemented`](../business/business-overview.md#roadmap-planned-not-yet-implemented) and the time-sensitive dependency note in [`../operations/deployment.md#operational-dependency-risk-from-the-product-charter`](../operations/deployment.md#operational-dependency-risk-from-the-product-charter) |

## In-repository documents (see also the raw-document inventory in [`../wiki-index.md#source--raw-documents`](../wiki-index.md#source--raw-documents))

| Document | Status | Use it for |
|---|---|---|
| [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) | Current, mostly accurate (one stale paragraph, see [`architecture/architecture-overview.md`](../architecture/architecture-overview.md)) | The most reliable prior architecture narrative in the repo |
| [`CLAUDE.md`](../../../CLAUDE.md) | Substantially stale — describes an earlier "revamp-100pathways" branch state | AI-agent instructions; historical product framing, not current routing/schema |
| [`conversation_design.md`](../../../conversation_design.md) | ~126 commits stale | Companion tone/posture philosophy; not routing, roles, or schema |
| [`specs/SIGNUP_OTP_SPEC.md`](../../../specs/SIGNUP_OTP_SPEC.md) | Current and accurate | Exact OTP signup/reset flow spec |
| [`specs/ACCOUNT_DELETION_SPEC.md`](../../../specs/ACCOUNT_DELETION_SPEC.md) | Current and accurate | Self-serve account deletion (migration 0033), password Show/Hide, sign-out confirmation |
| [`specs/SIGNUP_APPROVAL_OPTIONS.md`](../../../specs/SIGNUP_APPROVAL_OPTIONS.md) | Superseded | Historical decision record — the in-app dashboard option it proposed is what got built |
| [`README.md`](../../../README.md), [`AGENTS.md`](../../../AGENTS.md) | Unmodified `create-next-app` boilerplate | Neither has project-specific content |

## External systems referenced by code (no dashboards/URLs provided in-repo)

- **Anthropic API** — model `claude-sonnet-4-6`, via `@anthropic-ai/sdk`. See [`../integrations/ai-llm.md`](../integrations/ai-llm.md).
- **Supabase project** — Postgres + Auth + RLS for all persistence. Project URL/keys are environment-specific (see [`../architecture/configuration.md`](../architecture/configuration.md)); no dashboard link is committed to this repository.
- **GitHub repository** (`GITHUB_REPO` env var) — the target for contributor "assemble" commits. Which repo/branch this points to is environment-specific.
- **Vercel project** (`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`) — the live deploy target.
- **Google Sheet** (`GOOGLE_SHEET_ID`) — the conversation-logging destination. Sheet ID is environment-specific.

> **Note:** This repository does not commit any dashboard URLs, ticket-tracker project keys, or Slack channel references. The Product Charter (see above) describes requirements/feedback tracking as living in "additional tabs within this document" (a Requirements tab and a Feedback tab inside the same `.docx`), not in a separate ticket tracker — so there is no external issue-tracker link to record here as things stand.

## Framework source document

The "AI Diffusion Pathway Framework" is transcribed in full into [`content/framework.md`](../../../content/framework.md) — this is the canonical, prompt-injected version; editing it changes model behavior with no code change. `lib/dimensions.ts` mirrors only its structural shape (dimension/sub-category codes, weights) for the app's own JSON state and UI.

## Source files

All documents listed above.
