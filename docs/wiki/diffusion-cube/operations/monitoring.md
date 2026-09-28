# Monitoring

> **Note:** Integration with an external monitoring/observability platform (such as Prometheus, Datadog, Sentry, or Vercel's own Analytics/Speed Insights add-ons) is not documented in this wiki — no such SDK or config was found anywhere in the repository. Platform health today is observed through application server logs (`console.error` calls) and, informally, through the Google Sheets conversation log described below.

## What does exist

- **`lib/logger.ts`** — fire-and-forget append of every `/api/chat` call (mode, pathway slug, last user message, model response, full history JSON) to a Google Sheet, keyed by `timestamp`. This is closer to a usage/conversation log than an operational monitoring tool, but it is the only place a human can currently see what the model is actually saying across users. See [`../integrations/async-processing.md`](../integrations/async-processing.md).
- **`console.error` calls** at every swallowed-failure point (Anthropic call failures in `check-similar`, Sheets logging failures, `adoption_queries` insert failures, `extractInsightsForAttachment` failures) — visible only in whatever platform's log viewer is attached to the running process (Vercel's function logs, or `docker logs`/CloudWatch for the AWS path). No structured logging format, no log aggregation service configured in-repo.
- **`adoption_queries`** — records every companion user message tagged with the pathways it drew on, but nothing reads it back yet; not a monitoring tool today, a potential analytics source later. See [`../business/business-rules.md`](../business/business-rules.md#monitoring-rule).

## What is not present

- No health-check endpoint (no `/api/health` or equivalent route found).
- No uptime/synthetic monitoring configuration.
- No error-tracking SDK (e.g. Sentry) instrumented anywhere.
- No dashboards, alerts, or SLO definitions in-repo.

## Roadmap context

The Product Charter (`docs/raw_documents/AI DIffusion Cube - Product Charter.docx`) independently names "structured logging: latency, errors, per-user/per-pathway usage" in its non-functional requirements backlog, status **Not started** — confirming this page's finding is a known, already-sequenced gap rather than a surprise. See [`../knowledge/technical-debt.md#roadmap-acknowledged-gaps`](../knowledge/technical-debt.md#roadmap-acknowledged-gaps).

## Recommended (not yet implemented)

If observability needs grow beyond `console.error` and the Sheets log, the natural next additions given this stack would be: a `/api/health` route for the two deploy targets' respective health checks, Vercel's built-in Analytics/Speed Insights (zero extra infra, since Vercel is already the live deploy target), and a structured-logging wrapper around the existing `console.error` call sites so failures in `app/api/chat/route.ts`, `lib/logger.ts`, and `lib/adoption-conversation.ts` become queryable rather than only visible in raw log streams.

## Source files

`lib/logger.ts`, every `catch`/`console.error` site listed in [`../knowledge/technical-debt.md`](../knowledge/technical-debt.md).
