# Coding Patterns

Patterns actually observed in this codebase (not prescriptive advice) — useful for a new contributor or an AI agent about to modify code here. *Re-verified 2026-11-06 against HEAD `0a1ca00` plus the uncommitted prompt-rule changes in `lib/system-prompts.ts`.*

## Prompt assembly as pure functions

All model behavior is defined by functions in [`lib/system-prompts.ts`](../../../../lib/system-prompts.ts) that take structured state (`grid`, `meta`, the grounding text, framework/resources strings) and return a prompt string — no class hierarchy, no template engine. Shared pieces (`groundingRules()`, `speakingRules()`, `evidenceHandlingRules()`, `gridUpdateContract()`, `currentProgressBlock()`) are composed by calling one function from inside another. To change what a mode does, edit the matching builder function; to change *what the model knows about the framework*, edit `content/framework.md`/`content/pathway-generation-prompt.md`/`content/resources.md` instead of code. Pathway knowledge is no longer a file at all — it is whatever `lib/retrieval.ts` returns for the current message (see [Grounding is retrieved, not injected](#grounding-is-retrieved-not-injected)).

## Shared prompt-rule constants for cross-surface answer shape

*(Working tree, not yet committed at the time of writing.)* Four module-level string constants in `lib/system-prompts.ts` hold the answer-shape rules for the adopter-facing surfaces (Analyse and the Library — not the Contributor prompt), from adopter feedback:

| Constant | Rule |
|---|---|
| `BEST_MATCH_RULE` | Answer with the single best-matching pathway; say plainly when none matches directly; bring in more than one only when the user asks to compare or for common patterns |
| `PATHWAY_CONTEXT_RULE` | On first mention, describe a pathway in a few plain words (what, for whom, where) |
| `NEUTRAL_LANGUAGE_RULE` | Neutral, factual wording about what other adopters did — no "flopped", "a disaster" |
| `PLAIN_WORDS_RULE` | No insider terms ("corpus", "micro-innovation", "condition tag", "unit", "adjacent match", …) |

They are interpolated (`${...}`) into `groundingRules(true)` / `speakingRules(true)` (the flag keeps the Contributor prompt, which calls them with `false`, on its original wording), the Explorer prompt, the analysis-document and executive-summary `CORE RULES`, and both Library prompts (`libraryPathwaySystemPrompt`, `libraryOverviewSystemPrompt`). The pattern: when a rule must read identically on several surfaces, define it once as a constant and interpolate it — don't paste the sentence into each builder. `lib/explorer-intents.ts` (step 2 picks the single best match) and the `broad` header in `lib/retrieval.ts` were aligned with the same rules. As a consequence, the Library prompts are no longer verbatim copies of the old standalone Diffusion Library backend.

## Grounding is retrieved, not injected

The chat route no longer pastes the whole corpus into every prompt. For every mode that needs pathway evidence, it calls `buildGrounding()` in [`lib/retrieval.ts`](../../../../lib/retrieval.ts) with a `Surface` (`analyse`, `contribute`, `document`, `explore-overview`, `explore-pathway`), and passes the returned text to the prompt builder where the corpus used to go. Conventions inside retrieval:

- **A cheap classifier routes, the main model answers.** A forced-tool-use call to `CLASSIFIER_MODEL` (`claude-haiku-5-5`, `thinking: disabled`, `effort: low`) picks the query kind and filters — only on `analyse` and `explore-overview`. Other surfaces use a fixed default kind with no extra call.
- **Every failure has a defined degradation.** Classifier failure → the surface's default kind; embedding failure → full-text + label search only; a publish whose embedding fails still stores the units without vectors. Only a database error throws.
- **Numbers are computed in code, never by the model.** Pattern counts (`groupPatterns`) and the library pathway count (`buildOverview().count`) are stated in the prompt as exact.
- **Tunable limits live in one constant** (`LIMITS`), tuned against `docs/features/pathway-storage/test_set_pathway_storage.md`.
- **Source Trace never reaches an adopter.** Every adopter-facing document goes through `adopterDocument()` → `stripProvenanceAppendix()` (`lib/provenance.ts`); source passages are filtered to `is_public === true` in SQL *and* again in code.

## The model never writes to the database

Still true. Every chat mode's output is streamed prose plus (for most modes) a trailing `<grid_update>` JSON block. Persistence of conversation state always happens client-side, in [`lib/adoption-conversation.ts`](../../../../lib/adoption-conversation.ts), after the stream completes. Route handlers perform the *reads* needed to ground a prompt; the chat route's only writes are telemetry (`adoption_queries`, `ai_usage`, `sys_errors`). The new pathway-store writes (`saveVersion`, `publishVersion`, unit indexing) are triggered by explicit human actions — a contributor's Send for Review, an admin's Publish, an operator running the seed script — never by a model turn. The retrieval classifier's tool call only returns routing data; it has no write tool. Adding a new mode that needs to persist something should follow the same shape (signal in the JSON contract → client dispatches the write).

## Client-constructed messages, never model-authored, for generated documents

When a document is generated (`<analysis_doc/>`, `<exec_summary/>`, `<pathway_doc/>` cards), the chat message carrying that card is built by the client, not returned by the model. The model only signals intent (`explorerAction`/`pathwayAction`); the actual document content lives in `design_documents` and is read back, never duplicated into chat history. Follow this pattern for any new generated-artifact type.

## Marker constants, not string literals, for cross-file contracts

[`lib/grid-update.ts`](../../../../lib/grid-update.ts) exports `DELIVERABLE_START`/`DELIVERABLE_END`, `PATHWAY_DOC_MARKER`, `ANALYSIS_DOC_MARKER`, `EXEC_SUMMARY_MARKER` — both the prompt text (in `lib/system-prompts.ts`) and the client parsing code (in `components/ChatPanel.tsx`, `lib/adoption-conversation.ts`) import these constants rather than hardcoding the strings twice. `PROMPT_CACHE_BREAK` (exported from `lib/system-prompts.ts`, consumed by `lib/prompt-cache.ts`) follows the same idea. This is deliberately split out of `lib/adoption-conversation.ts` so the server-side route can import the parsing logic without pulling in React hooks.

## Server-side request validation in the chat route

`app/api/chat/route.ts` validates in a fixed order, cheapest first, so a refused request never costs a database read or a Claude call:

1. **Rate limit before parsing** — signed-in callers per account (`chat-user`, defaults 30/min, 300/day, `CHAT_USER_RATE_LIMIT_PER_MIN`/`_PER_DAY`), anonymous per IP (`explore`, 20/200). A 429 is not logged to `sys_errors`.
2. **Body size** — raw body over `MAX_BODY_CHARS` (32 MiB, Anthropic's own request limit) → 413.
3. **JSON shape** — not a JSON object → 400; unknown `mode` → 400; `library` input checked by `isValidExploreConversation` → 400.
4. **Role** — `requiredRole(mode, flow)`: `pathway-draft`, `asset-reuse`, and `companion`/`extract-insights` with `flow === 'contributor'` need `pathway_contributor`; everything else (a missing flow included) needs `adopter`. Missing role → 403.
5. **Messages and objects** — 1–500 `user`/`assistant` turns (`MAX_MESSAGES`), `grid`/`meta` plain objects → else 400.
6. **Text size** — messages + grid + meta + published doc over `MAX_TEXT_CHARS` (800,000 ≈ the model's context window) → 413.

New model-calling routes should follow the same order and use named constants with a comment explaining where each cap comes from.

## Role checks: UX at the page, enforcement at the API, RLS underneath

Every gated page (`app/analyse/page.tsx`, `app/contribute/page.tsx`, `app/admin/page.tsx`) performs its own role check for what to *render* — but the corresponding API route re-checks the role independently using the caller's actual session, never trusting what the client sent. In the chat route this is `requiredRole(mode, flow)` over `currentRoles()` (one query, throws on a read error so a DB failure is a 500, not "no roles"); other routes use `hasRole()`/`isAdmin()` (`ADMIN_EMAILS` or an `admin` row). Postgres RLS is the last layer — e.g. migration `0040` limits `pathways` reads to their contributors and admins, which is why admin-only reads that must honour `ADMIN_EMAILS` go through a service-role route (`app/api/admin/pathways/document`). When adding a new gated surface, both the page and the API check are required; the page-level one alone is not security.

## Service-role modules state who may call them

`lib/pathway-store.ts` and `lib/retrieval.ts` use `createAdminClient()` (service role, bypasses RLS); `pathway-store.ts`'s header states the rule outright — "Callers check who may call." Its functions take an optional `admin` client parameter so a route can pass the one it already created and tests can inject a mock. The SQL functions they call (`match_pathway_units`, `match_source_chunks`) are `revoke`d from `anon`/`authenticated` and granted only to `service_role`.

## Retry with backoff — only at the embedding boundary

[`lib/embeddings.ts`](../../../../lib/embeddings.ts) is the first explicit retry logic in the app: each batch (4 texts, 20 s `AbortSignal.timeout`) is retried up to 2 times with linear backoff (1 s, 2 s) on HTTP 503/504/546 or a dropped connection; any other status fails at once. It throws on any failure and never returns partial or zero vectors, so each caller chooses its own degradation. Anthropic calls (`messages.stream`/`messages.create` in the chat route, `check-similar`, the classifier, the seed script) have **no explicit** retry policy — only the SDK's implicit default of 2 retries before a response starts, since no client sets `maxRetries`; the seed script additionally retries dropped connections — see [`knowledge/technical-debt.md#td-05`](../knowledge/technical-debt.md#td-05).

## Deliberately independent markdown renderers

Three separate hand-rolled markdown-subset parsers exist by design, not oversight: [`components/ChatPanel.tsx`](../../../../components/ChatPanel.tsx) (chat bubbles — headings, bullets, bold, nested-italic-bold, links, bare URLs), [`components/WikiMarkdown.tsx`](../../../../components/WikiMarkdown.tsx) (adds pipe-table support, since pathway documents lean on tables), and [`lib/adoption-plan-markdown.ts`](../../../../lib/adoption-plan-markdown.ts) (shared between the on-screen document modal and the PDF exporter, specifically *without* table support, plus a `parseStatusBullet` helper for `[green]/[amber]/[red]/[dark]` tags jsPDF can't render as emoji). `app/explore/ExploreLibrary.tsx` has a **fourth**, independent inline-bold renderer for the Library chat — a genuine duplication (the Library was ported from a separate standalone app) rather than an intentional split; see [`knowledge/technical-debt.md`](../knowledge/technical-debt.md).

## Two caching mechanisms, no cache layer

- **Content-hash dedup for documents.** [`lib/design-documents.ts`](../../../../lib/design-documents.ts)'s `hashConversationState` (a non-cryptographic djb2 hash over the conversation + grid) means regenerating an Analysis Document or Executive Summary with an unchanged conversation is served from the stored `design_documents` row. `draft` documents opt out — `insertDraftVersion` uses `String(Date.now())` as the hash.
- **Anthropic prompt caching for multi-turn modes.** [`lib/prompt-cache.ts`](../../../../lib/prompt-cache.ts) splits each system prompt at `PROMPT_CACHE_BREAK` and marks the stable prefix (and the last message) with an ephemeral 5-minute breakpoint, for `companion` and `library` only.

There is no Redis or in-process cache for model output. See [`integrations/caching.md`](../integrations/caching.md).

## Fire-and-forget side effects, swallowed errors

Non-critical-path writes — the `adoption_queries` insert, the `sys_errors`/`ai_usage` inserts (scheduled with Next's `after()`), `extractInsightsForAttachment`'s best-effort grid seeding, the contributor's "your pathway is published" email, storage clean-up on delete (`removeSourceObjects`, `removeAssetObjects`) — either run unawaited (`adoption_queries`, `after()` telemetry) or are awaited inside their own `try`/`catch` (email, storage clean-up) — in both cases their failures are logged only, never surfaced to the user or allowed to fail the main action. Treat any new "nice to have but not required for the response" write the same way; if its failure matters, also call `logError()` (`lib/errors.ts`) so it lands in `sys_errors`.

## Route handlers go through `withErrorHandling`

Every `app/api/**/route.ts` defines `async function handle<METHOD>(...)` and exports `export const <METHOD> = withErrorHandling('api/<path>', handle<METHOD>)`. Return 4xx responses or throw `ValidationError`/`AuthError`/`NotFoundError` for expected failures; let anything else throw. Never put raw error text in a response meant for the browser — the wrapper replaces every 5xx body with `GENERIC_ERROR_MESSAGE` (`lib/error-messages.ts`, the client-safe import) and records the real text in `sys_errors`. Streaming responses must catch their own mid-stream failures (see `streamFailed()` in `app/api/chat/route.ts`).

## One `readStaticFile()` for committed `content/` reads

`lib/wiki-loader.ts` funnels its filesystem reads (framework, generation prompt, resources) through `lib/static-content.ts`'s `readStaticFile()` (memoised per instance in production, re-read in development). Pathways are no longer read from disk anywhere — `lib/wiki-content.ts` (the `/wiki` pages and stats) now reads from `lib/pathway-store.ts`. Never route database content through the static-file cache.

## Tests mock every external client

Tests (Vitest, `tests/`) never touch a real service: `tests/setup.ts` sets fake env vars, `tests/helpers/supabase-mock.ts` fakes the query builder and records each chain as a `QueryOp` for assertions, and `tests/helpers/anthropic-mock.ts` fakes `messages.stream`/`messages.create` (including a mid-stream failure). Route handlers are tested by calling the exported `POST`/`GET` directly with a built `Request`. Component tests opt into jsdom with a `// @vitest-environment jsdom` first line. Follow these helpers rather than adding a new mocking style. See [`testing.md`](testing.md).
