# AI / LLM Integration

## Model, Parameters & API-Key Management

- **Model**: exactly one model ID used everywhere Claude is called: **`claude-sonnet-4-6`**. Call sites: `app/api/chat/route.ts` (×3 — the `library` stream, the main stream for the other streamed modes, and the non-streamed `asset-reuse` call) and `app/api/pathways/check-similar/route.ts`.
- **SDK**: `@anthropic-ai/sdk` `^0.106.0` (`package.json`).
- **API key**: `process.env.ANTHROPIC_API_KEY`, read once at module scope in both files that construct an `Anthropic` client. Not rotated or validated at startup — a missing/invalid key surfaces as a runtime error on first use.
- **Generation parameters per call site**:

| Call site | Mode(s) | Method | max_tokens | temperature | tool use |
|---|---|---|---|---|---|
| `app/api/chat/route.ts` | `library` | `messages.stream` | 1024 | SDK default | none |
| `app/api/chat/route.ts` | `companion` | `messages.stream` | 8192 | SDK default | none |
| `app/api/chat/route.ts` | `extract-insights` | `messages.stream` | 1024 | SDK default | none |
| `app/api/chat/route.ts` | `pathway-draft` | `messages.stream` | 9000 | SDK default | none |
| `app/api/chat/route.ts` | `analysis-doc`, `executive-summary` | `messages.stream` | 4096 | SDK default | none |
| `app/api/chat/route.ts` | `asset-reuse` (contributor asset card) | `messages.create` (non-streaming) | 400 | SDK default | none |
| `app/api/pathways/check-similar/route.ts` | n/a | `messages.create` (non-streaming) | 512 | SDK default | **forced**: `tool_choice: {type:'tool', name:'report_match'}` |

> **Note:** `CLAUDE.md` states `pathway-draft` uses `max_tokens: 6144`; the code (`app/api/chat/route.ts`) actually sets 9000. No temperature override is set at any call site.

- **Key rotation / storage**: a single environment variable, no secret-manager integration visible in the repo, no key rotation mechanism. Deployment-specific (Vercel project env vars for the live path; Docker build/runtime env for the AWS path — see [`third-party-integrations.md`](third-party-integrations.md)).
- **Required vs optional**: `ANTHROPIC_API_KEY` is required for the entire chat and pathway-creation surface — without it, `/api/chat` and `/api/pathways/check-similar` fail on every call.

## Response Handling

- **Parse strategy**: all `/api/chat` modes stream via `ReadableStream`, piping `content_block_delta`/`text_delta` chunks directly to the client as `text/plain`. The client (`lib/adoption-conversation.ts`) live-parses the streamed text for a trailing `<grid_update>{...}</grid_update>`-style JSON block using `lib/grid-update.ts`'s `parseGridUpdate`, merges the parsed fields into local state, and strips the block before rendering/storing the message.
- **Return shape**: the server returns raw streamed text, not a JSON envelope — there is no `{success, data}` wrapper. The one exception is `check-similar`, which returns `{matchId: string | null}` as JSON directly, since it's a single forced-tool-use, non-streaming call.
- **Batch-level behavior**: N/A — there is no batching; every mode is a single independent Anthropic call per user action. The two-call pattern (companion turn → automatic follow-up `analysis-doc`/`pathway-draft`/`executive-summary` call) is sequential, not batched, and is triggered client-side by `explorerAction`/`pathwayAction` in the parsed `<grid_update>`.
- **"Translate response shape"**: not applicable — there is no multi-provider abstraction layer; the Anthropic SDK's stream/response shape is consumed directly by route handlers with no intermediate normalization layer.
- **Error handling**: still no retries anywhere (TD-05). A failure before streaming starts is caught by `withErrorHandling` (500 + generic message, recorded in `sys_errors`). A failure **mid-stream** is caught inside both stream loops by `streamFailed()`, which records it (with `mode`/`flow`/`design_id`/`pathway_slug`), writes an `ok:false` `ai_usage` row and errors the stream; the client then shows the partial reply plus `System encountered an error. Please try sometime later.` and saves nothing. `check-similar` still answers any failure with `{matchId: null}`, but now records it (`logError` + `ok:false` usage). See [`../knowledge/technical-debt.md#td-05`](../knowledge/technical-debt.md#td-05).

## Modes (7)

`companion`, `analysis-doc`, `executive-summary`, `extract-insights`, `pathway-draft`, `library`, `asset-reuse` (the `MODES` array in `app/api/chat/route.ts`). `plan-document` and `pathway-exec-summary` and their prompt builders were removed (MLC-13) — they now get 400 `Unknown mode.`. The `<deliverable>` tag handling was also removed (MLC-14); no prompt emits it.

## Prompt caching

- `lib/system-prompts.ts` exports a sentinel `PROMPT_CACHE_BREAK`, inserted at the existing stable/per-turn boundary in 6 builders (explorer, contributor, analysis-doc, executive-summary, pathway-draft, document-insight). Everything before it (corpus, framework, resources, toolkit assets, the existing-published doc) is stable; everything after (`currentProgressBlock` / `standingContext` / grid) changes per turn. The text Claude receives is unchanged.
- `lib/prompt-cache.ts`: `systemForMode()` sends cached modes as `[stable block with cache_control: ephemeral, per-turn block]` (a prompt with no marker, e.g. library, is cached whole) and strips the marker for uncached modes; `messagesForMode()` adds a breakpoint on the last message so the history is reused too.
- **Cached modes: `companion` and `library` only** (multi-turn; 5-minute ephemeral TTL). One-shot modes (documents, drafts, extraction, `asset-reuse`) stay uncached since a cache write costs 1.25× — whether to cache them is an open owner decision. `check-similar` is unchanged.

## Usage recording

Every Claude call writes one `ai_usage` row via `lib/ai-usage.ts` `recordAiUsage()` (inside `after()`, never throws, counts only — no text): `area` from `areaFor(mode, flow)` (`library`→explore; `companion`/`extract-insights` by `flow`; `pathway-draft`/`asset-reuse`/`check-similar`→contribute; else analyse), model, input/output and cache read/creation tokens, `ok`. Streams record from `stream.finalMessage().usage` after closing; failures write `ok:false`. The client sends `flow` on `extract-insights` so contributor uploads count as Contribute. Shown on `/admin/usage` — see [`../operations/monitoring.md`](../operations/monitoring.md).

## Prompt assembly

All prompt-building logic lives in [`lib/system-prompts.ts`](../../../lib/system-prompts.ts) (~890 lines). Exported builders:

| Function | Governs |
|---|---|
| `explorerSystemPrompt(...)` | The Analyse/companion-explorer conversation — full corpus + framework + resources + current progress block, ending in the `<grid_update>` contract with `cubeAssessment`/`persona`/`explorerAction` fields |
| `contributorSystemPrompt(...)` | The 4-step Contributor pipeline (wait for docs → settle stage → auto-generate → revise/publish/talk loop); contract includes `pathwayAction` only |
| `documentInsightSystemPrompt(...)` | Silent one-shot `extract-insights` pass; returns only a `<grid_update>` block, never lowers existing density |
| `pathwayDraftSystemPrompt(...)` | Drafts/revises the Sections 0–6 + Source Trace appendix pathway document; merges into an existing published doc rather than overwriting when one is supplied |
| `analysisDocSystemPrompt` | The Explorer's Analysis Document (no Source Trace appendix — never shown to adopters) |
| `executiveSummarySystemPrompt` | The Guidance flow's smaller, explicitly-distinct second document |
| `assetReuseSystemPrompt()` | The contributor's asset card: purpose + Section 4 reuse condition as JSON (`asset-reuse` mode) |
| `libraryPathwaySystemPrompt(...)` / `libraryOverviewSystemPrompt(...)` | The separate, conversational-tone Library voice — no grid, no numbered flow, no `<grid_update>` at all |
| `LIBRARY_KICKOFF_PROMPT` | Fixed invisible first-turn text for a freshly opened Library pathway chat |

Content injected at runtime (via [`lib/wiki-loader.ts`](../../../lib/wiki-loader.ts)'s `readSource()`, which reads through `lib/static-content.ts` `readStaticFile()` — memoised per server instance **in production only**): `content/framework.md` (question bank + weights), `content/pathway-generation-prompt.md` (pathway-draft generation rules — its own file header claims "not used at runtime," which is stale; it is injected), `content/resources.md` (external-citation rules, Explorer only).

**Per-mode loading** (`app/api/chat/route.ts`): the grounding corpus (`loadWikiContext()`) is skipped for `extract-insights` and `pathway-draft`; resources are loaded only for the Explorer `companion`; the framework is always loaded. `loadWikiContext()` still queries `published_pathways` on every call, so an admin publish shows up on the next request.

## One pathway corpus, two ways of reading it

*Updated 2026-10-20 (MLC-16/20): the Library's separate `content/library-wiki/` copy was removed (TD-02 resolved). There is now one static corpus.*

| | Library (`/explore` chat) | Analyse / Contribute |
|---|---|---|
| Static files | `content/wiki/pathways/<slug>.md` — any file by slug | `content/wiki/pathways/` — only files linked from `index.md` |
| Loader | `lib/library-documents.ts` (`readLibraryPathwayDocument`, `buildLibraryOverview`) | `lib/wiki-loader.ts` (`loadWikiContext`) |
| Reads via | `readStaticFile` (memoised in production) | `readStaticFile` (memoised in production) |
| DB merge | `published_pathways` (static first, DB fallback for the document; DB wins for cards) | `published_pathways` appended to the corpus |
| Grounded on | One document at a time | The whole indexed corpus (with framework) |
| Source Trace appendix | **Stripped** before the prompt (static and published) | Included; prompts forbid surfacing it to adopters |
| Voice | Conversational, contractions, no grid | Advisory, framework-tagged, drives `<grid_update>` |

- **Library cards** still come from `lib/library-pathways.ts` (8 hard-coded cards) merged with `published_pathways` (DB wins by slug). Every card's `id` has a matching `content/wiki/pathways/<id>.md`.
- **The general library chat overview** (`buildLibraryOverview`) covers exactly the card set, so it never mentions a corpus file that has no card.
- **Moved files.** `data-dhara` and `ceew-climate-intelligence` (previously library-only) were moved into `content/wiki/pathways/` and linked from `index.md` (new "Data Infrastructure" and "Climate & Public Health" categories), so they now ground Analyse too.
- **Version choice.** For the six pathways that existed in both folders, the grounding-corpus version is the one kept.
- **Document size.** Grounding documents are longer than the old library copies (e.g. `mahavistaar` is about 10K tokens), so a library chat call carries more input. Prompt caching (below) offsets repeat turns.
- **`/wiki` browsing** (`lib/wiki-content.ts`) reads the same corpus and strips the appendix and frontmatter before display.

## Guardrails

Content rules are enforced entirely at the prompt level (no code-level content filtering or PII screening beyond what the Anthropic API itself applies). The one code-level guard is on the public `library` mode: a per-IP rate limit (default 20/min, 200/day) and input caps (≤20 messages, visitor messages ≤1,000 chars, total ≤20,000 chars) — see [`../application/api-specification.md`](../application/api-specification.md#response-conventions). Prompt rules:

- Never fabricate; always trace a claim to a named pathway with its condition tag.
- Provenance/Source Trace appendix is contributor-only, never surfaced to an adopter.
- Framework jargon (sub-category codes, densities, unit-type labels) never appears in user-facing prose.
- `designs.meta.stage` is only ever set from the user's own statement.

## Retry / resilience

No retries. Failures are now recorded and shown to the user as the generic message (see "Response Handling" above); see also [`../architecture/architecture-overview.md`](../architecture/architecture-overview.md) alternative-approaches row **N**.

## Source files

`lib/system-prompts.ts`, `lib/prompt-cache.ts`, `lib/ai-usage.ts`, `lib/static-content.ts`, `lib/explore-guard.ts`, `lib/rate-limit.ts`, `app/api/chat/route.ts`, `app/api/pathways/check-similar/route.ts`, `lib/wiki-loader.ts`, `lib/library-documents.ts`, `lib/wiki-content.ts`, `lib/grid-update.ts`, `content/framework.md`, `content/pathway-generation-prompt.md`, `content/resources.md`.
