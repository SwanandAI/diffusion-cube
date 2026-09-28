# AI / LLM Integration

## Model, Parameters & API-Key Management

- **Model**: exactly one model ID used everywhere Claude is called: **`claude-sonnet-4-6`**. Call sites: `app/api/chat/route.ts` (×2 — `library` mode and all other modes) and `app/api/pathways/check-similar/route.ts`.
- **SDK**: `@anthropic-ai/sdk` `^0.106.0` (`package.json`).
- **API key**: `process.env.ANTHROPIC_API_KEY`, read once at module scope in both files that construct an `Anthropic` client. Not rotated or validated at startup — a missing/invalid key surfaces as a runtime error on first use.
- **Generation parameters per call site**:

| Call site | Mode(s) | Method | max_tokens | temperature | tool use |
|---|---|---|---|---|---|
| `app/api/chat/route.ts` | `library` | `messages.stream` | 1024 | SDK default | none |
| `app/api/chat/route.ts` | `companion` | `messages.stream` | 8192 | SDK default | none |
| `app/api/chat/route.ts` | `extract-insights` | `messages.stream` | 1024 | SDK default | none |
| `app/api/chat/route.ts` | `pathway-draft` | `messages.stream` | 9000 | SDK default | none |
| `app/api/chat/route.ts` | `analysis-doc`, `executive-summary`, `plan-document`, `pathway-exec-summary` | `messages.stream` | 4096 | SDK default | none |
| `app/api/pathways/check-similar/route.ts` | n/a | `messages.create` (non-streaming) | 512 | SDK default | **forced**: `tool_choice: {type:'tool', name:'report_match'}` |

> **Note:** `CLAUDE.md` states `pathway-draft` uses `max_tokens: 6144`; the code (`app/api/chat/route.ts`) actually sets 9000. No temperature override is set at any call site.

- **Key rotation / storage**: a single environment variable, no secret-manager integration visible in the repo, no key rotation mechanism. Deployment-specific (Vercel project env vars for the live path; Docker build/runtime env for the AWS path — see [`third-party-integrations.md`](third-party-integrations.md)).
- **Required vs optional**: `ANTHROPIC_API_KEY` is required for the entire chat and pathway-creation surface — without it, `/api/chat` and `/api/pathways/check-similar` fail on every call.

## Response Handling

- **Parse strategy**: all `/api/chat` modes stream via `ReadableStream`, piping `content_block_delta`/`text_delta` chunks directly to the client as `text/plain`. The client (`lib/adoption-conversation.ts`) live-parses the streamed text for a trailing `<grid_update>{...}</grid_update>`-style JSON block using `lib/grid-update.ts`'s `parseGridUpdate`, merges the parsed fields into local state, and strips the block before rendering/storing the message.
- **Return shape**: the server returns raw streamed text, not a JSON envelope — there is no `{success, data}` wrapper. The one exception is `check-similar`, which returns `{matchId: string | null}` as JSON directly, since it's a single forced-tool-use, non-streaming call.
- **Batch-level behavior**: N/A — there is no batching; every mode is a single independent Anthropic call per user action. The two-call pattern (companion turn → automatic follow-up `analysis-doc`/`pathway-draft`/`executive-summary` call) is sequential, not batched, and is triggered client-side by `explorerAction`/`pathwayAction` in the parsed `<grid_update>`.
- **"Translate response shape"**: not applicable — there is no multi-provider abstraction layer; the Anthropic SDK's stream/response shape is consumed directly by route handlers with no intermediate normalization layer.
- **Error handling**: no retries anywhere. Streaming calls in `/api/chat` have no try/catch around `anthropic.messages.stream` itself — a failure surfaces as an unhandled Next.js 500. `check-similar` wraps its call in try/catch and swallows any failure to `{matchId: null}` (`console.error` only, not surfaced to the user). See [`../knowledge/technical-debt.md#td-05`](../knowledge/technical-debt.md#td-05).

## Prompt assembly

All prompt-building logic lives in [`lib/system-prompts.ts`](../../../lib/system-prompts.ts) (877 lines). Exported builders:

| Function | Governs |
|---|---|
| `explorerSystemPrompt(...)` | The Analyse/companion-explorer conversation — full corpus + framework + resources + current progress block, ending in the `<grid_update>` contract with `cubeAssessment`/`persona`/`explorerAction` fields |
| `contributorSystemPrompt(...)` | The 4-step Contributor pipeline (wait for docs → settle stage → auto-generate → revise/publish/talk loop); contract includes `pathwayAction` only |
| `documentInsightSystemPrompt(...)` | Silent one-shot `extract-insights` pass; returns only a `<grid_update>` block, never lowers existing density |
| `pathwayDraftSystemPrompt(...)` | Drafts/revises the Sections 0–6 + Source Trace appendix pathway document; merges into an existing published doc rather than overwriting when one is supplied |
| `analysisDocSystemPrompt` | The Explorer's Analysis Document (no Source Trace appendix — never shown to adopters) |
| `planDocumentSystemPrompt` | 4-section executive Plan Document |
| `executiveSummarySystemPrompt` | The Guidance flow's smaller, explicitly-distinct second document |
| `pathwaySubmissionExecutiveSummarySystemPrompt(...)` | **Dead code** — no caller found anywhere in the repository (see [`../knowledge/technical-debt.md`](../knowledge/technical-debt.md)) |
| `libraryPathwaySystemPrompt(...)` / `libraryOverviewSystemPrompt(...)` | The separate, conversational-tone Library voice — no grid, no numbered flow, no `<grid_update>` at all |
| `LIBRARY_KICKOFF_PROMPT` | Fixed invisible first-turn text for a freshly opened Library pathway chat |

Content injected at runtime (via [`lib/wiki-loader.ts`](../../../lib/wiki-loader.ts)'s `readSource()`): `content/framework.md` (question bank + weights), `content/pathway-generation-prompt.md` (pathway-draft generation rules — its own file header claims "not used at runtime," which is stale; it is injected), `content/resources.md` (external-citation rules, Explorer only).

## Two corpora

Two genuinely separate, non-overlapping-in-purpose (though overlapping-in-subject-matter) corpora exist, loaded by different modules:

| | Library corpus | Grounding corpus |
|---|---|---|
| Files | `content/library-wiki/pathways/` (8 files, no index) | `content/wiki/pathways/` (12 files + `index.md`) |
| Loader | `lib/library-wiki-loader.ts` | `lib/wiki-loader.ts` |
| Used by | `/explore` chat + cards | `companion`, `analysis-doc`, and every other doc-generating mode |
| DB merge | `published_pathways` (by slug, DB wins) | `published_pathways` (by slug, DB wins) |
| Grounded on | One document at a time | The whole corpus (~22K tokens with framework) |
| Voice | Conversational, contractions, no grid | Advisory, framework-tagged, drives `<grid_update>` |

`/wiki` browsing (`lib/wiki-content.ts`) is a third read path over the **grounding** corpus, stripping the Provenance/Source Trace appendix and frontmatter before display. Several pathway names appear in **both** corpora (e.g. `mahavistaar`, `blue-dots`, `bhili-language-enablement`) as independently-maintained documents with different structure and tone — a real content-duplication risk, not a shared source of truth. See [`../knowledge/technical-debt.md#td-02`](../knowledge/technical-debt.md#td-02).

## Guardrails

Enforced entirely at the prompt level (no code-level content filtering beyond what the Anthropic API itself applies):

- Never fabricate; always trace a claim to a named pathway with its condition tag.
- Provenance/Source Trace appendix is contributor-only, never surfaced to an adopter.
- Framework jargon (sub-category codes, densities, unit-type labels) never appears in user-facing prose.
- `designs.meta.stage` is only ever set from the user's own statement.

## Retry / resilience

None. See "Response Handling" above and [`../architecture/architecture-overview.md`](../architecture/architecture-overview.md) alternative-approaches row **N**.

## Source files

`lib/system-prompts.ts`, `app/api/chat/route.ts`, `app/api/pathways/check-similar/route.ts`, `lib/wiki-loader.ts`, `lib/library-wiki-loader.ts`, `lib/wiki-content.ts`, `lib/grid-update.ts`, `content/framework.md`, `content/pathway-generation-prompt.md`, `content/resources.md`.
