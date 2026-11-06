# Async Processing

*Last verified against code: 2026-11-06 (HEAD `0a1ca00`).*

There is no job queue, worker process, or background-task framework (no BullMQ, no Celery-equivalent, no cron, no `pg_cron`) anywhere in this application. "Async processing" here means the fire-and-forget patterns used within request handlers, plus one operator-run offline script (seeding).

## Fire-and-forget writes (not awaited on the critical path)

| Operation | Triggered by | Where | Failure handling |
|---|---|---|---|
| `adoption_queries` insert | Every `companion`-mode `/api/chat` call | `app/api/chat/route.ts` | Caught, `console.error` only — never retried, never surfaced |
| `sys_errors` insert (+ hourly opportunistic purge) | Every recorded error | `lib/errors.ts` via Next's `after()` | Caught, `console.error` only — never affects the response |
| `ai_usage` insert | Every Claude call (including the Haiku retrieval classifier) | `lib/ai-usage.ts` via `after()` | Caught, `console.error` only |
| Contributor "pathway is live" email | Admin publish | `app/api/admin/pathways/publish/route.ts` (`notifyContributor`) | Awaited, but best-effort — a failure is logged and never returned |
| `extractInsightsForAttachment` | Every file upload, before any chat turn | `lib/adoption-conversation.ts` | Explicitly documented in-code as "best-effort enhancement — silently give up" on failure |

These are genuinely fire-and-forget: the HTTP response to the user is not delayed by, nor does it depend on, any of these completing or succeeding.

## Sequential (not batched) two-call pattern

The one multi-step "async-feeling" flow in the app is not true background processing — it's a client-orchestrated sequential pair of requests:

1. A `companion` (or `contributorSystemPrompt`-driven) turn completes and its `<grid_update>` signals `explorerAction`/`pathwayAction`.
2. The client (`lib/adoption-conversation.ts`) then makes a **second**, separate `/api/chat` call (`analysis-doc`/`executive-summary`/`pathway-draft`) and awaits its full streamed result before persisting and displaying it.

Both calls are within the same user session and both block on their own response — there is no queued job the user walks away from and later checks on.

## Synchronous embedding (not a background job)

Retrieval-based grounding introduced embeddings, but **without** an async indexing job — every embedding call happens inline:

- **On admin publish** (`lib/pathway-store.ts` `publishVersion`): the published document is parsed into units (`lib/pathway-units.ts` `parseUnits`) and embedded through the `embed` Edge Function **inside the publish request**, in batches of 4. If embedding fails, units are stored without vectors (still searchable by full text) and the response says `embedded: false`; there is no retry queue — the next publish of that pathway embeds them.
- **Per question** (`lib/retrieval.ts`): the search text is embedded inline before `match_pathway_units`; a failure falls back to full-text search.
- The Haiku classifier call also runs inline, before the main reply starts streaming, adding its latency to every Analyse companion turn and library overview message.

See [`third-party-integrations.md`](third-party-integrations.md#supabase-edge-function-embed).

## Offline seeding script

`npm run seed:pathways -- --manifest <file.json> [--dry-run] [--only slugs] [--regenerate]` (`scripts/seed-pathways.ts`, run with `vite-node` via `scripts/vite-node.config.mts`; pure helpers in `lib/seed.ts`; example manifest `scripts/seed-manifest.example.json`) is a one-time, operator-run batch per Supabase project — not a scheduled job. Per pathway it extracts source text, generates the document with Sonnet (cached in `.seed-cache/`), uploads originals to the private `pathway-sources` bucket, chunks (1,600 chars, 200 overlap) and embeds source passages, then saves and publishes a version with no admin review. Re-running a slug adds a new version and replaces its sources.

## Write-only research log

`adoption_queries` (migrations `0010`/`0011`) is inserted into on every companion turn but **nothing in the current codebase reads it back** — it exists purely as recorded material for a future cross-user insight feature. This is explicitly called out as out-of-scope in the product's own framing (see [`../business/business-overview.md`](../business/business-overview.md#non-scope)).

> **Note:** Background job processing (scheduled digests, retry queues, batch re-indexing, etc.) is still not part of this service. Retrieval-augmented grounding has now landed (see [`ai-llm.md`](ai-llm.md#retrieval-based-grounding)) but embeds synchronously, so units left without vectors after a failed embed are only repaired by a later publish — a re-embed job would be the natural first background task if that becomes a problem.

## Source files

`app/api/chat/route.ts`, `app/api/admin/pathways/publish/route.ts`, `lib/errors.ts`, `lib/ai-usage.ts`, `lib/adoption-conversation.ts`, `lib/pathway-store.ts`, `lib/retrieval.ts`, `lib/embeddings.ts`, `lib/seed.ts`, `scripts/seed-pathways.ts`, `supabase/migrations/0010_adoption_queries.sql`.
