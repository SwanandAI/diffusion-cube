# AI Context — Diffusion Cube

> Single most information-dense document in this wiki. Read this first. Every claim below traces to a file in this repository. Last refreshed **2026-11-06** on branch `Swanand_DC` (HEAD `0a1ca00` plus the uncommitted adopter-feedback prompt-rule change in `lib/system-prompts.ts` / `lib/explorer-intents.ts` / `lib/retrieval.ts`). This refresh absorbs pathway storage in Supabase + hybrid retrieval (`docs/features/pathway-storage/`, migration `0042`), the Vitest suite, default adopter role (`0039`), pathway RLS tightening (`0040`), per-user chat rate limits, toolkit assets (`0034`), and the 2026-10-22 audit fixes.

## Service Summary

**Diffusion Cube** (package name `ai-diffusion-cube-app`, product-facing name "Diffusion Cube | 100 Pathways") is a Next.js 16 / React 19 web app that is the conversational companion to the public site **100pathways.com**. It ships these products behind one app shell and one chat API route:

- **`/explore`** — the public, no-login **Diffusion Library**: browse published pathways and chat with one (or across all of them).
- **`/analyse`** — the **Explorer** flow (needs the `adopter` role, which every account now gets at signup): a signed-in user analyses their own AI adoption against the published pathways.
- **`/contribute`** — the **Contributor** flow (needs `pathway_contributor` + an approved registration): a signed-in user turns their own deployment write-up into a new pathway, sends it for review, and an admin publishes it.
- **`/admin`** — role assignment, contributor-registration approval, pathway review/publish/delete (with status filter); plus **`/admin/usage`** and **`/admin/errors`**.

## Business Purpose

100 Pathways exists to help people **adopt AI well** by grounding advice in real, documented deployments (not generic AI/ML best practice). The app operationalizes a 4-dimension × 4-stage "AI Diffusion Pathway Framework" so that a user's own situation can be compared, cell by cell, against prior deployments' lived experience.

## Major Capabilities

1. Public pathway library (`/explore`): per-pathway chat grounded in that pathway's published document (plus passages from its original source documents for seeded pathways), and a library-wide chat grounded in lessons retrieved across all published pathways.
2. Explorer flow: conversation that tracks a 4×4 grid of the user's deployment, grounds each message on the pathways and lessons its question needs (retrieval, not the whole corpus), and can generate an **Analysis Document** and an **Executive Summary**, both versioned in `design_documents`.
3. Contributor flow: document-first pipeline that auto-drafts a full pathway document (Sections 0–6 + Source Trace appendix), lets the contributor revise it conversationally, and collects toolkit asset files with consent.
4. Two-step publish, all inside Supabase: contributor **"Send for review"** (`/api/pathways/assemble`) saves the draft as the next `pathway_versions` row (status `in_review`); an **admin publish** (`/api/admin/pathways/publish` → `publishVersion`) makes that version live, parses its units into `pathway_units` and embeds them for search. No GitHub commit, no redeploy.
5. Seeding: `npm run seed:pathways` (`scripts/seed-pathways.ts`, `lib/seed.ts`) loads seed pathways and their original documents (stored in the private `pathway-sources` bucket, chunked and embedded).
6. Auth: Supabase email+password with 6-digit OTP signup/reset via a custom SMTP hook.
7. In-app monitoring: server errors → `sys_errors` (users only see `System encountered an error. Please try sometime later.`), every Claude call's tokens → `ai_usage`; admin pages show both (errors grouped by IST day since `0041`).

## Architecture Summary

Next.js App Router monolith on Supabase (Postgres + Auth + RLS + Storage + one Edge Function). `proxy.ts` gates every route except a public allow-list. `app/api/chat/route.ts` serves **7 modes** with `claude-sonnet-4-6`; before any mode runs it rate-limits (per account when signed in, per IP otherwise), caps body/message/text size (413), validates JSON (400) and enforces the mode's role via `requiredRole(mode, flow)` (403). Grounding is **retrieval-based** (`lib/retrieval.ts`): a **Claude Haiku** classifier (`claude-haiku-5-5`, forced tool use) picks a query kind (`specific | situation | broad | patterns`) and filters → `lib/embeddings.ts` embeds the question via the **`embed` Edge Function** (`supabase/functions/embed`, open-source `gte-small`, 384 dims) → SQL `match_pathway_units` hybrid search (vector + full text + labels, reciprocal-rank fusion) → per-kind grounding text. All pathway content lives in Supabase (`lib/pathway-store.ts`); `published_pathways` is now a **view**. Every API route is wrapped by `withErrorHandling` (`lib/errors.ts`). See [`architecture/architecture-overview.md`](architecture/architecture-overview.md).

## Repository Structure

See [`repository-map.md`](repository-map.md). Top level: `app/` (pages + `app/api/*`), `components/` (37 files), `lib/` (41 modules + `lib/supabase/`), `content/` (`framework.md`, `pathway-generation-prompt.md`, `resources.md`, `legal/` — **no pathway files any more**), `supabase/migrations/` (42 files), `supabase/functions/embed/` (Deno Edge Function), `scripts/` (seed script, SMTP check), `tests/` (Vitest, 105 test files), `proxy.ts`, `instrumentation.ts`, `Dockerfile` + `.github/workflows/deploy.yml`.

## Technology Stack

- Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS v4
- `@anthropic-ai/sdk` ^0.106.0 — `claude-sonnet-4-6` (chat modes, check-similar, seed generation) and `claude-haiku-5-5` (retrieval classifier)
- Supabase — Postgres (+ `pgvector`, HNSW indexes) + Auth + RLS + Storage + Edge Functions
- Client-side document extraction: `pdfjs-dist`, `mammoth`, `xlsx`, `jszip`; `jspdf` (PDF export); `nodemailer` (SMTP)
- Vitest 3 + Testing Library + jsdom; `vite-node` for the seed script
- GitHub Contents API integration **removed** (`lib/github.ts` deleted)

## Critical Business Rules

1. **Matching discipline**: "relevant" = same sector *and* same use-case category.
2. **Answer shape (adopter feedback, 2026-11; Analyse and Library only — the Contributor prompt is unchanged)**: give the **single best-matching pathway**; if none matches directly, say so plainly first and offer one closest match only if genuinely related; more than one only when the user asks to compare or for common patterns. Describe every pathway in a few plain words on first mention. Short answers that open with the answer. Neutral, non-judgemental wording (never "flopped"). No insider jargon (corpus, micro-innovation, condition tag, unit…). Shared constants `BEST_MATCH_RULE`, `PATHWAY_CONTEXT_RULE`, `NEUTRAL_LANGUAGE_RULE`, `PLAIN_WORDS_RULE` in `lib/system-prompts.ts`.
3. **Micro-innovations are suggestions, never recommendations.**
4. **Absence is stated plainly**, never backfilled with general knowledge.
5. **Source Trace appendix is contributor-only** — stripped (`lib/provenance.ts`) from every adopter-facing surface.
6. **`stage` in `designs.meta` is only set from the user's own statement.**
7. **Publishing is two independently-gated steps**: "Send for review" does not make anything live; only admin publish does. Deleting a pathway also unpublishes it. See [`business/workflows.md`](business/workflows.md).
8. **Every account is an `adopter` from signup** (DB trigger, `0039`) — there is no pending state.

## Important APIs

Full reference: [`application/api-specification.md`](application/api-specification.md).

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `app/api/chat/route.ts` | POST | `library` public; others role per `requiredRole` | 7 modes; rate limit → size caps → role → validation |
| `app/api/pathways/route.ts` | GET/POST | contributor | list (service role, columns only) / create |
| `app/api/pathways/assemble/route.ts` | POST | `pathway_contributor` + membership | "Send for review" → `saveVersion` |
| `app/api/admin/pathways/publish/route.ts` | POST | admin | `publishVersion` (goes live, units + embeddings) |
| `app/api/admin/pathways/document/route.ts` | GET | admin | assembled document for the admin review card |
| `app/api/admin/pathways/delete/route.ts` | POST | admin | delete + unpublish + remove storage objects |
| `app/api/wiki-pathways/route.ts` | GET | public | pathway metadata for source-attribution chips (`/explore` cards load server-side) |
| `app/api/errors/client/route.ts` | POST | public, rate-limited | browser error reports → `sys_errors` |

`/api/chat` modes: `companion`, `analysis-doc`, `executive-summary`, `extract-insights`, `pathway-draft`, `library`, `asset-reuse`. Removed routes: `/api/auth/grant-default-role`, `/api/admin/reject`.

## Important Database Tables

Full reference: [`application/database.md`](application/database.md). Core: `user_roles`, `designs`, `design_documents`, `pathways` (now with `status` draft/in_review/published/retired, `published_version_id`, `is_seed`, card fields), `pathway_contributors`, `organisations`, `contributor_registrations`, `contribution_units` (toolkit assets), `library_conversations`, `adoption_queries`. **Pathway storage (`0042`)**: `pathway_versions`, `pathway_units` (fts + `vector(384)`), `pathway_sources`, `pathway_source_chunks`; functions `match_pathway_units`, `match_source_chunks` (service role only); view `published_pathways` (owner rights by design, readable by anon). **Server-only**: `sys_errors`, `ai_usage`, `rate_limits`.

## Core Domain Models

- **Grid** (`designs.grid_state`) — 16 cells `"<dimension>:<stage>"`, `{density: 0-3, note}`; shape in [`lib/dimensions.ts`](../../../lib/dimensions.ts).
- **`designs.meta`** — re-injected every turn (`currentProgressBlock`) because `<grid_update>` is stripped before storage.
- **`<grid_update>` contract** — `cells`, `meta`, `pathwaysReferenced`, `flowStep`, plus `explorerAction` / `pathwayAction` and toolkit-asset fields. See [`integrations/ai-llm.md`](integrations/ai-llm.md).
- **Pathway version / unit** — a pathway's reviewed documents are `pathway_versions`; the published version's micro-innovations are parsed (`lib/pathway-units.ts` `parseUnits`) into searchable `pathway_units`.

## Core Services

- `lib/system-prompts.ts` — every prompt builder; source of runtime behavior. `PROMPT_CACHE_BREAK` marks the cacheable boundary.
- `lib/retrieval.ts` — classifier, `hybridSearch`, `buildGrounding`, `pathwayPassages`, `LIMITS`.
- `lib/pathway-store.ts` — `saveVersion`, `publishVersion`, `listPublished`, `getPublishedDocument(s)`, `buildOverview`, `adopterDocument`.
- `lib/embeddings.ts` — `embedTexts` (batches of 4, 20 s timeout, 2 retries on 503/504/546; throws so callers degrade).
- `lib/adoption-conversation.ts` — the `useAdoptionConversation` client hook (streaming, grid merge, client-side persistence).
- `lib/errors.ts`, `lib/ai-usage.ts`, `lib/rate-limit.ts`, `lib/explore-guard.ts` — error capture, usage, rate limits.
- `lib/roles.ts` — `Role`, `hasRole`, `hasAnyRole`, `currentRoles`, `isAdmin`.
- `lib/toolkit-assets.ts` / `lib/toolkit-assets-server.ts` — toolkit asset files.

## AI/LLM Components

Sonnet (`claude-sonnet-4-6`) for all `/api/chat` modes (streamed except `asset-reuse`), `/api/pathways/check-similar` (forced tool use) and the offline seed script's document generation (`scripts/seed-pathways.ts`, retries a dropped connection). Haiku (`claude-haiku-5-5`) for the per-message retrieval classifier. Embeddings via the self-hosted `embed` Edge Function (no vendor key). Failures degrade: classifier → default kind for the surface; embedding → full-text + label search. No explicit retry policy on in-app Anthropic calls — only the SDK's implicit 2 pre-response retries, nothing mid-stream (embeddings and the seed script retry explicitly). Prompt caching for `companion` and `library`. Full detail: [`integrations/ai-llm.md`](integrations/ai-llm.md).

## Environment Variables

Full table: [`architecture/configuration.md`](architecture/configuration.md); template at repo-root `.env.example`. Required: `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (also used to call the `embed` function). Rate limiting: `RATE_LIMIT_SALT`, `EXPLORE_RATE_LIMIT_PER_MIN/_PER_DAY` (20/200), `CHAT_USER_RATE_LIMIT_PER_MIN/_PER_DAY` (30/300). Removed: `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH`, `WIKI_PATH`.

## Build Commands

```bash
npm install
npm run dev            # next dev
npm run build          # next build (output: "standalone")
npm run start
npm run lint           # eslint
npm run seed:pathways -- --manifest path/to/manifest.json [--dry-run] [--only slug1,slug2]
                       # seed pathways (see scripts/seed-manifest.example.json)
```

## Test Commands

```bash
npm test               # vitest run — 105 test files under tests/
npm run test:watch
npm run test:coverage  # v8 → tests/coverage
```

All external clients (Supabase, Anthropic, SMTP, embeddings) are mocked; `tests/setup.ts` sets fake env vars. Run `npm install` first (dev dependencies are required). Last run 2026-11-06: 2,230 passed, 1 failed — `AdminPathwaysPanel.test.tsx` still expects the pre-`7d7eac6` delete-dialog wording. CI (`.github/workflows/deploy.yml`) does **not** run the tests. See [`architecture/testing.md`](architecture/testing.md).

## Deployment Commands

See [`operations/deployment.md`](operations/deployment.md):
- **Vercel** (live): `.github/workflows/deploy.yml` → `vercel deploy --prod` on push to `main`.
- **Docker/AWS**: built, not wired to CI.
- **Supabase**: apply migrations in order (`0040` needs its code deployed first; `0042` is destructive — drops the old `published_pathways` table), deploy `supabase functions deploy embed --project-ref <ref>` per project, then seed.

## ⚠ Time-sensitive operational dependency (from the Product Charter)

The Product Charter records the Anthropic API access as a free account expiring **28-Oct-2026** (now past — the code cannot show whether it was renewed; confirm the account status directly) and the AWS account expiring December 2026. See [`knowledge/technical-debt.md`](knowledge/technical-debt.md).

## Troubleshooting Quick Guide

| Symptom | Likely cause | Where to look |
|---|---|---|
| Library / Analyse has no pathways after a fresh environment | Migration `0042` dropped the old table; pathways must be seeded and/or published | [`operations/troubleshooting.md`](operations/troubleshooting.md) |
| Answers feel less precise; logs show embed errors | `embed` function not deployed or over its limits (546) — search falls back to full text | same |
| A contributor's pathway never shows up | "Send for review" ≠ live; an admin must publish | [`business/workflows.md`](business/workflows.md) |
| User sees the generic error message | Any 5xx — real cause in `sys_errors` | `/admin/errors` |
| Chat returns 429 / 413 / 403 | Per-account or per-IP rate limit / request too large / wrong role for the mode | [`operations/troubleshooting.md`](operations/troubleshooting.md) |
| Auth emails aren't arriving | `SEND_EMAIL_HOOK_SECRET` or SMTP creds — test with `scripts/smtp-test.mjs` | same |

## Technical Debt Summary

Full register: [`knowledge/technical-debt.md`](knowledge/technical-debt.md) — re-verified in this refresh. Headlines: Anthropic account expiry date has passed (confirm status); tests exist but don't run in CI; no explicit retry policy on Anthropic calls; no copy of pathway content outside Supabase (TD-17); PII screening still absent; several root docs (`ARCHITECTURE.md`, `README.md`, `AGENTS.md`, …) are stale.

## AI Agent Working Instructions

1. **Trust the code over root docs.** `CLAUDE.md` is a pointer into this wiki (its "no tests" cell and the GitHub/Sheets services entry are stale); `ARCHITECTURE.md`, `README.md`, `AGENTS.md`, `conversation_design.md` are stale.
2. **`content/framework.md` is the source of truth for framework behavior.**
3. **Pathways live only in Supabase** — never add pathway markdown under `content/`; use the seed script or the contributor → admin publish flow.
4. **Change answer style via the shared rule constants in `lib/system-prompts.ts`**, not per-prompt one-offs.
5. **New API routes go through `withErrorHandling('api/<path>', handle<METHOD>)`**; throw `ValidationError`/`AuthError`/`NotFoundError` for expected failures.
6. **Run `npm test`** after changes — the suite exists now; add tests under `tests/` matching the existing layout.
7. This skill (`llm-wiki`) produces documentation only.
