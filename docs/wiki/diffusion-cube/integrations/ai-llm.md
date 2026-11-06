# AI / LLM Integration

*Last verified against code: 2026-11-06 (HEAD `0a1ca00` plus the uncommitted answer-shape prompt rules in `lib/system-prompts.ts`, `lib/explorer-intents.ts` and `lib/retrieval.ts`).*

## Model, Parameters & API-Key Management

- **Models**: two model IDs, both hard-coded string literals (no env var selects a model):
  - **`claude-sonnet-4-6`** for every user-facing generation: `app/api/chat/route.ts` (×3 — the `library` stream, the main stream for the other streamed modes, and the non-streamed `asset-reuse` call), `app/api/pathways/check-similar/route.ts`, and the offline seed script `scripts/seed-pathways.ts` (`GENERATION_MODEL`).
  - **`claude-haiku-5-5`** (`CLASSIFIER_MODEL` in `lib/retrieval.ts`) for the per-message retrieval classifier that decides what to ground a reply on (see [Retrieval-based grounding](#retrieval-based-grounding)).
- **SDK**: `@anthropic-ai/sdk` `^0.106.0` (`package.json`).
- **Embeddings are not an Anthropic call.** Vectors come from the self-hosted `gte-small` model in the `embed` Supabase Edge Function — no embedding vendor and no extra key. See [`third-party-integrations.md`](third-party-integrations.md#supabase-edge-function-embed).
- **API key**: `process.env.ANTHROPIC_API_KEY`, read at module scope in the three files that construct a long-lived `Anthropic` client (`app/api/chat/route.ts`, `app/api/pathways/check-similar/route.ts`, `lib/retrieval.ts`); the seed script constructs its own client per run. Not rotated or validated at startup — a missing/invalid key surfaces as a runtime error on first use.
- **Generation parameters per call site**:

| Call site | Mode(s) | Model | Method | max_tokens | temperature / thinking | tool use |
|---|---|---|---|---|---|---|
| `app/api/chat/route.ts` | `library` | Sonnet 4.6 | `messages.stream` | 1024 | SDK default | none |
| `app/api/chat/route.ts` | `companion` | Sonnet 4.6 | `messages.stream` | 8192 | SDK default | none |
| `app/api/chat/route.ts` | `extract-insights` | Sonnet 4.6 | `messages.stream` | 1024 | SDK default | none |
| `app/api/chat/route.ts` | `pathway-draft` | Sonnet 4.6 | `messages.stream` | 9000 | SDK default | none |
| `app/api/chat/route.ts` | `analysis-doc`, `executive-summary` | Sonnet 4.6 | `messages.stream` | 4096 | SDK default | none |
| `app/api/chat/route.ts` | `asset-reuse` (contributor asset card) | Sonnet 4.6 | `messages.create` (non-streaming) | 400 | SDK default | none |
| `lib/retrieval.ts` `classifyQuery` | usage mode `retrieval-classify` (Analyse companion, library overview) | **Haiku** | `messages.create` (non-streaming) | 300 | `thinking: {type:'disabled'}`, `output_config: {effort:'low'}` | **forced**: `tool_choice: {type:'tool', name:'route_question'}` |
| `app/api/pathways/check-similar/route.ts` | usage mode `check-similar` | Sonnet 4.6 | `messages.create` (non-streaming) | 512 | SDK default | **forced**: `tool_choice: {type:'tool', name:'report_match'}` |
| `scripts/seed-pathways.ts` (offline, `npm run seed:pathways`) | usage mode `seed-pathway` | Sonnet 4.6 | `messages.stream(...).finalMessage()` | 32000 | SDK default | none |

> **Note:** `CLAUDE.md` once stated `pathway-draft` uses `max_tokens: 6144`; the code (`app/api/chat/route.ts`) sets 9000. No temperature override is set at any call site.

- **Key rotation / storage**: a single environment variable, no secret-manager integration visible in the repo, no key rotation mechanism. Deployment-specific (Vercel project env vars for the live path; Docker build/runtime env for the AWS path — see [`../architecture/configuration.md`](../architecture/configuration.md)).
- **Required vs optional**: `ANTHROPIC_API_KEY` is required for the entire chat and pathway-creation surface — without it, `/api/chat` and `/api/pathways/check-similar` fail on every call. (The classifier alone failing is survivable — it falls back to a default classification — but the main Sonnet call that follows would fail on the same missing key.)

## Response Handling

- **Parse strategy**: all streamed `/api/chat` modes pipe `content_block_delta`/`text_delta` chunks directly to the client as `text/plain` via a `ReadableStream`. The client (`lib/adoption-conversation.ts`) live-parses the streamed text for a trailing `<grid_update>{...}</grid_update>` JSON block using `lib/grid-update.ts`'s `parseGridUpdate`, merges the parsed fields into local state, and strips the block before rendering/storing the message.
- **Return shape**: the server returns raw streamed text, not a JSON envelope — there is no `{success, data}` wrapper. `asset-reuse` returns its (JSON-shaped) text as `text/plain` in one piece. `check-similar` returns `{matchId: string | null}` as JSON directly (and only accepts an id it actually offered). The classifier's tool input is consumed server-side only and never reaches the client: unknown kinds, slugs, dimensions, stages or unit types in it are dropped, and `kind: 'specific'` with no known pathway is downgraded to `broad`.
- **Batch-level behavior**: no batching of model calls — each user action is one main Anthropic call, preceded (for Analyse companion turns and the library overview chat) by one Haiku classifier call. The two-call pattern (companion turn → automatic follow-up `analysis-doc`/`pathway-draft`/`executive-summary` call) is sequential, not batched, and is triggered client-side by `explorerAction`/`pathwayAction` in the parsed `<grid_update>`. (Embedding requests *are* batched, 4 texts per Edge Function call — see [`third-party-integrations.md`](third-party-integrations.md#supabase-edge-function-embed).)
- **"Translate response shape"**: not applicable — there is no multi-provider abstraction layer; the Anthropic SDK's stream/response shape is consumed directly by route handlers.
- **Error handling**: no explicit retry policy on any in-app Anthropic call (TD-05) — no client sets `maxRetries`, so only the SDK's implicit default applies (2 retries on connection errors / 408 / 409 / 429 / 5xx before a response starts; nothing once a stream is under way). A failure before streaming starts is caught by `withErrorHandling` (500 + generic message, recorded in `sys_errors`). A failure **mid-stream** is caught inside both stream loops by `streamFailed()`, which records it (with `mode`/`flow`/`design_id`/`pathway_slug`), writes an `ok:false` `ai_usage` row and errors the stream; the client then shows the partial reply plus `System encountered an error. Please try sometime later.` and saves nothing. `check-similar` still answers any failure with `{matchId: null}`, recorded via `logError` + `ok:false` usage. The classifier never throws: on failure it records `ok:false` usage, logs to `sys_errors` (`lib/retrieval`, `step: classify`) and returns the surface's default classification. The only **explicit** Anthropic retry in the repo is in the offline seed script, which retries a long generation up to twice when the connection drops (`terminated` / `fetch failed` / `ECONNRESET` / `socket hang up`). See [`../knowledge/technical-debt.md#td-05`](../knowledge/technical-debt.md#td-05).

## Modes (7)

`companion`, `analysis-doc`, `executive-summary`, `extract-insights`, `pathway-draft`, `library`, `asset-reuse` (the `MODES` array in `app/api/chat/route.ts`). `plan-document` and `pathway-exec-summary` and their prompt builders were removed (MLC-13) — they now get 400 `Unknown mode.`. The `<deliverable>` tag handling was also removed (MLC-14); no prompt emits it.

Before any model call, `/api/chat` now also enforces (in this order): a per-account (`chat-user`) or per-IP (`explore`) rate limit, a 32 MB body cap (413), a JSON-object body (400), a known mode (400), the library input caps, and — for every non-library mode — a role check via `requiredRole(mode, flow)` (Contributor work — `pathway-draft`, `asset-reuse`, contributor-flow `companion`/`extract-insights` — needs `pathway_contributor`; everything else `adopter`), a message-shape check (≤500 messages, 400) and an ~800K-character text cap (413). Detail: [`../application/api-specification.md`](../application/api-specification.md).

## Retrieval-based grounding

*New since 2026-10-20 (pathway-storage feature, `docs/features/pathway-storage/`). The whole corpus is **no longer** sent in every prompt.*

Pathways live in Supabase (`pathways` + `pathway_versions`, with each published document split into `pathway_units` rows carrying a full-text `tsvector` and a 384-dim `gte-small` embedding). Per message, `lib/retrieval.ts` `buildGrounding()` assembles only what that question needs:

1. **List published** pathways (`lib/pathway-store.ts` `listPublished`). If none are published, the grounding is a single line telling the model to say so.
2. **Classify** (`classifyQuery`): the Haiku classifier reads the last 6 turns (each capped at 2,000 chars) plus the published-pathway list and calls the `route_question` tool with a `kind` — `specific` (one or two named pathways), `situation` (the user's own adoption), `broad` (what several deployments did about a topic), `patterns` (what usually happens) — any named slugs, optional dimension / stage / unit-type filters, and a self-contained `search_text`. **The classifier is skipped** (no Haiku call) where the kind is already known: an open library pathway (`explore-pathway` → `specific`), documents (`document` → `situation`), and the contributor chat (`contribute` → `situation`, the corpus being only a style reference there). Default when skipped or failed: `specific` on the open pathway, `broad` for the library overview, otherwise `situation`.
3. **Search** (`hybridSearch` → SQL function `match_pathway_units`, service-role only): full-text (OR-ed words, `ts_rank_cd`) and vector (`<=>` cosine) rankings over published units, each taking `match_count × 2` candidates, combined by reciprocal-rank fusion (`rrf_k` default 50), with optional slug / dimension / stage (incl. `also_relevant_at`) / unit-type filters. The query vector comes from the `embed` Edge Function; if embedding fails the search runs on full text + labels alone. A database error does throw (answered by `withErrorHandling`).
4. **Shape per kind** (limits are the exported `LIMITS` constant):

| Kind | Limits | What the prompt receives |
|---|---|---|
| `specific` | `documents: 2`, `passages: 5` | Up to 2 full adopter documents (Source Trace stripped by `adopterDocument`), each with contributor and dated line. For a single pathway, up to 5 public source-document passages (`match_source_chunks`, re-checked `is_public`) as a labelled fallback. |
| `situation` | `pathways: 3`, `documents: 2`, `units: 30` | Search narrowed to the user's sector when any published pathway's sector matches; top 3 pathways by unit rank, the first 2 as full documents, remaining units of those pathways as "Further relevant lessons". A header says whether the matches are same-sector or only adjacent. |
| `broad` | `pathways: 8`, `units: 30` | Units from up to 8 pathways, headed "Use only the lessons that directly answer the question — not all of them" (uncommitted wording), credit each point, name gaps. |
| `patterns` | `units: 40` | Units grouped by dimension × sub-category × stage × unit type (`groupPatterns`); the pathway count per group is computed in code and stated as exact — "common pattern" only for 2+ pathways. |

No match for any kind → the fixed `NOTHING` line ("No published pathway documents anything that matches this question. Say so plainly…").

**Who gets which surface** (`app/api/chat/route.ts`):

| Mode / context | Grounding |
|---|---|
| `companion`, Explorer flow | `buildGrounding({surface:'analyse'})` — classifier runs |
| `companion`, Contributor flow | `buildGrounding({surface:'contribute'})` — no classifier, `situation` search on the adoption's own summary |
| `analysis-doc`, `executive-summary` | `buildGrounding({surface:'document', situationText})` — searches on sector + name + summary + hypothesis from `meta` |
| `extract-insights`, `pathway-draft`, `asset-reuse` | No pathway grounding |
| `library` with a pathway open | That pathway's published document (`getPublishedDocument`, Source Trace stripped) + its published toolkit assets + `pathwayPassages()` for the latest question (no classifier) |
| `library` overview (no pathway open) | `buildOverview()` (one line per published pathway, plus the exact count) + `buildGrounding({surface:'explore-overview'})` for the latest question |

Everything comes from the database on every request — an admin publish is visible on the next message. The `/wiki` browsing pages (`lib/wiki-content.ts`) read the same store.

## Prompt caching

- `lib/system-prompts.ts` exports a sentinel `PROMPT_CACHE_BREAK`, inserted at the stable/per-turn boundary in the explorer, contributor, analysis-doc, executive-summary, pathway-draft and document-insight builders, and (when grounding/passages are present) in both Library builders. Everything before it (framework, resources, toolkit assets, the library overview or open pathway document, the existing-published doc) is stable; everything after (the per-message pathway grounding, `currentProgressBlock` / `standingContext` / grid) changes per turn. The text Claude receives is unchanged.
- Since retrieval landed, the pathway grounding sits **after** the break in the Analyse/Contribute/document prompts (it changes per message), so only the framework/resources prefix is cached there.
- `lib/prompt-cache.ts`: `systemForMode()` sends cached modes as `[stable block with cache_control: ephemeral, per-turn block]` (a prompt with no marker is cached whole) and strips the marker for uncached modes; `messagesForMode()` adds a breakpoint on the last message so the history is reused too.
- **Cached modes: `companion` and `library` only** (`CACHED_MODES`; multi-turn; 5-minute ephemeral TTL). One-shot modes (documents, drafts, extraction, `asset-reuse`) stay uncached since a cache write costs 1.25×. The classifier and `check-similar` are not cached.

## Usage recording

Every Claude call writes one `ai_usage` row via `lib/ai-usage.ts` `recordAiUsage()` (inside `after()`, never throws, counts only — no text): `area` from `areaFor(mode, flow)` (`library`→explore; `retrieval-classify` by `flow` — `explore`→explore, `contributor`→contribute, else analyse; `companion`/`extract-insights` by `flow`; `pathway-draft`/`asset-reuse`/`check-similar`→contribute; else — including `seed-pathway` — analyse), model, input/output and cache read/creation tokens, `ok`. Streams record from `stream.finalMessage().usage` after closing; failures write `ok:false`. So a typical Analyse turn now writes **two** rows (Haiku classifier + Sonnet reply). Shown on `/admin/usage` — see [`../operations/monitoring.md`](../operations/monitoring.md).

## Prompt assembly

All prompt-building logic lives in [`lib/system-prompts.ts`](../../../../lib/system-prompts.ts) (~940 lines). Exported builders:

| Function | Governs |
|---|---|
| `explorerSystemPrompt(...)` | The Analyse/companion-explorer conversation — framework + resources + toolkit assets, then the per-message pathway grounding and current progress block, ending in the `<grid_update>` contract with `cubeAssessment`/`persona`/`explorerAction` fields. The step-by-step flow text comes from `lib/explorer-intents.ts` |
| `contributorSystemPrompt(...)` | The 4-step Contributor pipeline (wait for docs → settle stage → auto-generate → revise/publish/talk loop); related pathways are a style reference only; contract includes `pathwayAction` only |
| `documentInsightSystemPrompt(...)` | Silent one-shot `extract-insights` pass; returns only a `<grid_update>` block, never lowers existing density |
| `pathwayDraftSystemPrompt(...)` | Drafts/revises the Sections 0–6 + Source Trace appendix pathway document; merges into an existing published doc rather than overwriting when one is supplied |
| `analysisDocSystemPrompt` | The Explorer's Analysis Document (no Source Trace appendix — never shown to adopters) |
| `executiveSummarySystemPrompt` | The Guidance flow's smaller, explicitly-distinct second document |
| `assetReuseSystemPrompt()` | The contributor's asset card: purpose + Section 4 reuse condition as JSON (`asset-reuse` mode) |
| `libraryPathwaySystemPrompt(document, toolkitAssets, sourcePassages)` / `libraryOverviewSystemPrompt(overview, count, grounding)` | The separate, conversational-tone Library voice — no grid, no numbered flow, no `<grid_update>` at all |
| `LIBRARY_KICKOFF_PROMPT` | Fixed invisible first-turn text for a freshly opened Library pathway chat |

Static content injected at runtime (via [`lib/wiki-loader.ts`](../../../../lib/wiki-loader.ts)'s `readSource()`, which reads through `lib/static-content.ts` `readStaticFile()` — memoised per server instance **in production only**): `content/framework.md` (question bank + weights; always loaded), `content/pathway-generation-prompt.md` (`pathway-draft` and the seed script), `content/resources.md` (external-citation rules, Explorer `companion` only). These three files (plus `content/legal/`) are now the **only** files under `content/` — `content/wiki/` and `content/library-wiki/` no longer exist; every pathway lives in the database. `lib/wiki-loader.ts` also exports `datedLine()`, which puts "Documented as of" (frontmatter `timestamp`) or "First published" beside each grounded document for the dates rule.

## Guardrails

Content rules are enforced at the prompt level (no code-level content filtering or PII screening beyond what the Anthropic API itself applies). Code-level guards: the per-account / per-IP rate limits and request caps listed under [Modes](#modes-7), the library input caps (≤20 messages, visitor messages ≤1,000 chars, total ≤20,000 chars — `lib/explore-guard.ts`), the Source Trace appendix being stripped in code (`adopterDocument`) before any adopter-facing prompt, contributor-only source passages being filtered out twice (SQL + `is_public` re-check), and pattern counts computed in code rather than left to the model.

### Answer-shape rules (uncommitted working-tree change, 2026-11-06)

Four shared string constants in `lib/system-prompts.ts`, added from adopter feedback (answers were pulling in loosely related pathways, naming pathways without saying what they are, running long, and using loaded or insider words):

| Constant | Rule |
|---|---|
| `BEST_MATCH_RULE` | Answer with the **single** best-matching pathway. If nothing matches directly, say so first; only then offer one genuinely related pathway as the closest and say how it differs. Never stretch a pathway to fit; bring in more than one only when the user asks to compare or asks what is common. |
| `PATHWAY_CONTEXT_RULE` | Never assume the user knows a pathway by name — on first mention add a few plain words on what was built, for whom, and where. |
| `NEUTRAL_LANGUAGE_RULE` | Neutral, factual words about what happened — never "flopped", "failed miserably", "a disaster", "botched", "got it wrong". |
| `PLAIN_WORDS_RULE` | No insider terms: "the documented pathways", not "the corpus"; not "micro-innovation", "condition tag", "unit", "adjacent match", "failure-and-fix", "use-case category". |

Where they are interpolated:

- **Analyse conversation only** — `groundingRules(explorer)` and `speakingRules(explorer)` take a flag: `explorerSystemPrompt` passes `true` and gets `PATHWAY_CONTEXT_RULE` and `BEST_MATCH_RULE` (multi-pathway crediting only when the user asks to compare); `contributorSystemPrompt` passes `false` and keeps its original wording — the Contributor prompt is byte-identical to before this change. With `true`, `speakingRules` carries `NEUTRAL_LANGUAGE_RULE` (applied to other adopters) and `PLAIN_WORDS_RULE`, plus "open with the answer — no preamble". `evidenceHandlingRules()` (Explorer only) now defaults to the single best match; for **conflicting evidence**, `BEST_MATCH_RULE`'s one exception applies — answer from the best match, flag the pathway that got a different result in one clause and offer to show it; both are shown in full only when the user asks. The Explorer length rule now allows "up to three bullets" (was four) and only when the user asked for a comparison. `lib/explorer-intents.ts` step 2 now picks the single best match and says "no direct match" before offering one closest pathway.
- **Documents** — `analysisDocSystemPrompt` and `executiveSummarySystemPrompt` each gain a core rule 7 = `NEUTRAL_LANGUAGE_RULE` + `PATHWAY_CONTEXT_RULE`.
- **Library** — `libraryOverviewSystemPrompt` uses `BEST_MATCH_RULE`, `PATHWAY_CONTEXT_RULE`, `NEUTRAL_LANGUAGE_RULE`, `PLAIN_WORDS_RULE`, and its grounding header now says to answer from the one best-fitting lesson set unless the user asks to compare. `libraryPathwaySystemPrompt` uses `NEUTRAL_LANGUAGE_RULE` and `PLAIN_WORDS_RULE` plus an inline "say what any other pathway mentioned is" sentence (not `BEST_MATCH_RULE` — it is grounded on one document). Both Library prompts are shorter ("one short paragraph is the normal reply", "open with the answer"), drop the "bit of personality" tone line, stop at "the library doesn't have it yet" instead of always redirecting, and end with a plain-language follow-up question about the same pathway (or the user's own question), never one that brings in a second pathway. A "not covered" reply ends plainly, with no closing question. The `broad` grounding header in `lib/retrieval.ts` says to answer from the one best-fitting pathway unless the user asks to compare (the contributor chat never receives it — its surface is always classified `situation`).
- **Retrieval** — the `broad` grounding header adds "Use only the lessons that directly answer the question — not all of them."

- **Refinements after live testing (2026-11-06)** — the constants and Explorer-only rules now also set:
  - word caps: Analyse about 120 words, bullets included (at most three one-sentence bullets, at most one sentence after them), about 180 for a requested comparison; Library about 100;
  - every point from the one best pathway, with no second pathway as supporting evidence and no announced match counts;
  - "If you'd have to call it a stretch, don't mention it", and when nothing matches, don't describe the library's other contents;
  - never write "corpus", and explain technical acronyms in everyday words;
  - never repeat a judgemental word the user used;
  - "common patterns" only from lessons the search marks as seen in 2+ pathways (`evidenceHandlingRules`).

  Test set and results: [`scripts/test-harness/answer-shape-eval/answer-shape-feedback/test_set_answer_shape.md`](../../../../scripts/test-harness/answer-shape-eval/answer-shape-feedback/test_set_answer_shape.md). Known remaining gaps: Library answers still run about 2× their cap, and on voice-agriculture questions a second pathway still appears in some runs.

> **Note:** The Library prompts are **no longer verbatim** ports of the standalone Diffusion Library app's `PATHWAY_SYSTEM_TEMPLATE` / `LIBRARY_SYSTEM_TEMPLATE`. The in-code comment records the shared answer-shape rules as the one deliberate later change; they also gained retrieval-specific blocks (source passages, overview grounding, exact pathway count) with the pathway-storage feature.

Other standing prompt rules:

- Never fabricate; always trace a claim to a named pathway, attributed to its contributor, with the conditions it held under. When nothing matches, say so plainly.
- Call something a common pattern only when the grounding says 2+ pathways show it (counts are exact).
- A source-document passage is a fallback, used only when the write-up doesn't answer, and cited by file name.
- Cite dates for costs, vendors, policies and measured results; flag anything older than 12 months.
- Provenance/Source Trace appendix is contributor-only, never surfaced to an adopter.
- Framework jargon (sub-category codes, densities, unit-type labels) never appears in user-facing prose.
- `designs.meta.stage` is only ever set from the user's own statement.

## Retry / resilience

No explicit retry policy on in-app Anthropic calls (only the SDK's implicit 2 pre-response retries; nothing mid-stream). Failures are recorded and shown to the user as the generic message (see "Response Handling" above); the classifier and embeddings degrade instead of failing. The embed client (`lib/embeddings.ts`) is the first in-app call with explicit retry logic (2 retries on 503/504/546 and dropped connections) — see [`third-party-integrations.md`](third-party-integrations.md#fallback-behavior) and [`../architecture/architecture-overview.md`](../architecture/architecture-overview.md) alternative-approaches row **N**.

## Source files

`lib/system-prompts.ts`, `lib/explorer-intents.ts`, `lib/retrieval.ts`, `lib/embeddings.ts`, `lib/pathway-store.ts`, `lib/prompt-cache.ts`, `lib/ai-usage.ts`, `lib/static-content.ts`, `lib/wiki-loader.ts`, `lib/wiki-content.ts`, `lib/explore-guard.ts`, `lib/rate-limit.ts`, `lib/grid-update.ts`, `lib/toolkit-assets-server.ts`, `app/api/chat/route.ts`, `app/api/pathways/check-similar/route.ts`, `scripts/seed-pathways.ts`, `supabase/migrations/0042_pathway_storage.sql`, `supabase/functions/embed/index.ts`, `content/framework.md`, `content/pathway-generation-prompt.md`, `content/resources.md`.
