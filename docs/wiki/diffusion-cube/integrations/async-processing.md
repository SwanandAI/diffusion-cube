# Async Processing

There is no job queue, worker process, or background-task framework (no BullMQ, no Celery-equivalent, no cron) anywhere in this application. "Async processing" here means the fire-and-forget patterns used within request handlers.

## Fire-and-forget writes (not awaited on the critical path)

| Operation | Triggered by | Where | Failure handling |
|---|---|---|---|
| `adoption_queries` insert | Every `companion`-mode `/api/chat` call | `app/api/chat/route.ts` | Caught, `console.error` only — never retried, never surfaced |
| Google Sheets conversation log | Every `/api/chat` call (all modes) | `app/api/chat/route.ts` → `lib/logger.ts` | Caught, `console.error` only |
| `extractInsightsForAttachment` | Every file upload, before any chat turn | `lib/adoption-conversation.ts` | Explicitly documented in-code as "best-effort enhancement — silently give up" on failure |

These are genuinely fire-and-forget: the HTTP response to the user is not delayed by, nor does it depend on, any of these completing or succeeding.

## Sequential (not batched) two-call pattern

The one multi-step "async-feeling" flow in the app is not true background processing — it's a client-orchestrated sequential pair of requests:

1. A `companion` (or `contributorSystemPrompt`-driven) turn completes and its `<grid_update>` signals `explorerAction`/`pathwayAction`.
2. The client (`lib/adoption-conversation.ts`) then makes a **second**, separate `/api/chat` call (`analysis-doc`/`executive-summary`/`pathway-draft`) and awaits its full streamed result before persisting and displaying it.

Both calls are within the same user session and both block on their own response — there is no queued job the user walks away from and later checks on.

## Write-only research log

`adoption_queries` (migrations `0010`/`0011`) is inserted into on every companion turn but **nothing in the current codebase reads it back** — it exists purely as recorded material for a future cross-user insight feature. This is explicitly called out as out-of-scope in the product's own framing (see [`../business/business-overview.md`](../business/business-overview.md#non-scope)).

> **Note:** Background job processing (scheduled digests, retry queues, batch corpus re-indexing, etc.) is not part of this service today. Any future move toward retrieval-augmented grounding (see [`../architecture/architecture-overview.md`](../architecture/architecture-overview.md) alternative-approaches row **J**) would likely introduce the first real async-processing need — an embeddings/indexing job — that doesn't exist yet.

## Source files

`app/api/chat/route.ts`, `lib/logger.ts`, `lib/adoption-conversation.ts`, `supabase/migrations/0010_adoption_queries.sql`.
