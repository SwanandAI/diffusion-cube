# Coding Patterns

Patterns actually observed in this codebase (not prescriptive advice) — useful for a new contributor or an AI agent about to modify code here.

## Prompt assembly as pure functions

All model behavior is defined by functions in [`lib/system-prompts.ts`](../../../lib/system-prompts.ts) that take structured state (`grid`, `meta`, loaded corpus strings) and return a prompt string — no class hierarchy, no template engine. Shared pieces (`groundingRules()`, `speakingRules()`, `gridUpdateContract()`, `currentProgressBlock()`) are composed by calling one function from inside another. To change what a mode does, edit the matching builder function; to change *what the model knows*, edit `content/framework.md`/`content/pathway-generation-prompt.md`/`content/resources.md` instead of code.

## The model never writes to the database

Every mode's output is streamed prose plus (for most modes) a trailing `<grid_update>` JSON block. Persistence always happens client-side, in [`lib/adoption-conversation.ts`](../../../lib/adoption-conversation.ts), after the stream completes. Route handlers (`app/api/*/route.ts`) perform the *reads* needed to ground a prompt, but writes triggered by a model turn happen only from the client hook. Treat this as load-bearing: adding a new mode that needs to persist something should follow the same shape (signal in the JSON contract → client dispatches the write), not write from the route handler directly.

## Client-constructed messages, never model-authored, for generated documents

When a document is generated (`<analysis_doc/>`, `<exec_summary/>`, `<pathway_doc/>` cards), the chat message carrying that card is built by the client, not returned by the model. The model only signals intent (`explorerAction`/`pathwayAction`); the actual document content lives in `design_documents` and is read back, never duplicated into chat history. Follow this pattern for any new generated-artifact type.

## Marker constants, not string literals, for cross-file contracts

[`lib/grid-update.ts`](../../../lib/grid-update.ts) exports `DELIVERABLE_START`/`DELIVERABLE_END`, `PATHWAY_DOC_MARKER`, `ANALYSIS_DOC_MARKER`, `EXEC_SUMMARY_MARKER` — both the prompt text (in `lib/system-prompts.ts`) and the client parsing code (in `components/ChatPanel.tsx`, `lib/adoption-conversation.ts`) import these constants rather than hardcoding the strings twice. This is deliberately split out of `lib/adoption-conversation.ts` so the server-side route can import the parsing logic without pulling in React hooks.

## Deliberately independent markdown renderers

Three separate hand-rolled markdown-subset parsers exist by design, not oversight: [`components/ChatPanel.tsx`](../../../components/ChatPanel.tsx) (chat bubbles — headings, bullets, bold, nested-italic-bold, links, bare URLs), [`components/WikiMarkdown.tsx`](../../../components/WikiMarkdown.tsx) (adds pipe-table support, since pathway documents lean on tables), and [`lib/adoption-plan-markdown.ts`](../../../lib/adoption-plan-markdown.ts) (shared between the on-screen document modal and the PDF exporter, specifically *without* table support, plus a `parseStatusBullet` helper for `[green]/[amber]/[red]/[dark]` tags jsPDF can't render as emoji). `app/explore/ExploreLibrary.tsx` has a **fourth**, independent inline-bold renderer for the Library chat — this one is a genuine duplication (the Library was ported verbatim from a separate standalone app) rather than an intentional three-way split; see [`knowledge/technical-debt.md`](../knowledge/technical-debt.md).

## Content-hash caching instead of a cache layer

[`lib/design-documents.ts`](../../../lib/design-documents.ts)'s `hashConversationState` (a non-cryptographic djb2 hash over the conversation + grid) is the only caching mechanism in the app: regenerating an Analysis Document or Executive Summary with an unchanged conversation is served from the stored `design_documents` row instead of making a new model call. `draft` documents (pathway drafts) explicitly opt out of this — `insertDraftVersion` always uses `String(Date.now())` as the hash, so every draft generation/revision is treated as new. See [`integrations/caching.md`](../integrations/caching.md).

## Fire-and-forget side effects, swallowed errors

Non-critical-path writes — the `adoption_queries` insert, Google Sheets logging (`lib/logger.ts`), `extractInsightsForAttachment`'s best-effort grid seeding — are dispatched without awaiting their result on the critical path, and their failures are caught and `console.error`'d only, never surfaced to the user or retried. This is a consistent, repeated pattern across the codebase, not isolated to one call site — treat any new "nice to have but not required for the response" write the same way, but be aware it means these paths have no failure visibility beyond server logs.

## One `readSource()` for all static-file corpus reads

`lib/wiki-loader.ts`, `lib/library-wiki-loader.ts`, and `lib/wiki-content.ts` all funnel filesystem reads through one shared low-level read function so that a future move to object storage (S3 or similar) is a single-point change rather than a repo-wide one.

## Role checks: UX at the page, enforcement at the API

Every gated page (`app/analyse/page.tsx`, `app/contribute/page.tsx`, `app/admin/page.tsx`) performs its own role check for what to *render* — but the corresponding API route (`app/api/chat/route.ts`, `app/api/pathways/*`, `app/api/admin/*`) re-checks the same role independently using the caller's actual session, never trusting what the client sent. When adding a new gated surface, both checks are required; the page-level one alone is not security.
