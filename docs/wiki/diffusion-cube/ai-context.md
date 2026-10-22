# AI Context — Diffusion Cube

> Single most information-dense document in this wiki. Read this first. Every claim below traces to a file in this repository (branch `Swanand_DC` at the time of writing; targeted refresh 2026-10-20 on branch `monitoring-logging-cleanup` for the error-handling / usage-monitoring / cleanup work, `specs/MONITORING_LOGGING_CLEANUP_SPEC.md`).

## Service Summary

**Diffusion Cube** (package name `ai-diffusion-cube-app`, product-facing name "Diffusion Cube | 100 Pathways") is a Next.js 16 / React 19 web app that is the conversational companion to the public site **100pathways.com**. It ships three distinct products behind one app shell and one chat API route:

- **`/explore`** — the public, no-login **Diffusion Library**: browse and chat with individual AI-deployment pathway write-ups.
- **`/analyse`** — the **Explorer** flow (needs the `adopter` role): a signed-in user analyses their own AI adoption against the corpus of real deployments.
- **`/contribute`** — the **Contributor** flow (needs `pathway_contributor` + an approved registration): a signed-in user turns their own deployment write-up into a new corpus pathway and, with an admin's final publish step, pushes it live.
- **`/admin`** — role assignment, contributor-registration approval, and pathway publishing oversight; plus **`/admin/usage`** (users, conversations, AI calls/tokens, errors) and **`/admin/errors`** (latest 50 system errors).

## Business Purpose

100 Pathways exists to help people **adopt AI well** by grounding advice in real, documented deployments (not generic AI/ML best practice). The app operationalizes a 4-dimension × 4-stage "AI Diffusion Pathway Framework" so that a user's own situation can be compared, cell by cell, against a corpus of prior deployments' lived experience — turning "what should I do next" into a question answerable from precedent rather than intuition.

## Major Capabilities

1. Public pathway library with per-pathway chat, grounded in one document at a time (`/explore`).
2. Explorer flow: free-text/document-driven conversation that tracks a 4×4 "grid" of what's known about the user's deployment, compares against the whole pathway corpus, and can generate an **Analysis Document** and a smaller **Executive Summary**, both versioned in Supabase.
3. Contributor flow: document-first pipeline that infers a deployment stage, auto-drafts a full pathway document (Sections 0–6 + Source Trace appendix) once enough is known, and lets the contributor revise it conversationally before publishing.
4. Two-step publish: contributor "assemble" commits the draft to GitHub (`content/wiki/pathways/<slug>.md`); a separate **admin** publish step copies it into the `published_pathways` table, which is what actually goes live in the corpus — no redeploy needed.
5. Role-gated admin console: role grants/revokes, contributor-registration approve/reject, pathway publish/delete.
6. Auth: Supabase email+password with 6-digit OTP signup/reset, delivered via a custom SMTP hook (no Supabase-hosted email).
7. In-app monitoring: every server error recorded in `sys_errors` (users only ever see the generic message `System encountered an error. Please try sometime later.`), every Claude call's token counts in `ai_usage`, both surfaced on admin pages. See [`operations/monitoring.md`](operations/monitoring.md).

## Architecture Summary

Next.js App Router monolith. `proxy.ts` (Next middleware) gates every route except a public allow-list. One route handler, `app/api/chat/route.ts`, serves **7 modes** from a single Anthropic model (`claude-sonnet-4-6`) — all streamed except the short `asset-reuse` call. Every API route is wrapped by `withErrorHandling` (`lib/errors.ts`); the public `library` mode is rate-limited per IP and input-capped; `companion` and `library` use Anthropic prompt caching. Corpus content is dual: static markdown files committed in `content/` (two **separate, overlapping** corpora — see [`integrations/ai-llm.md`](integrations/ai-llm.md)) merged at read time with two Supabase tables (`published_pathways` for live corpus content, `pathways`/`design_documents` for in-progress contributor work). See [`architecture/architecture-overview.md`](architecture/architecture-overview.md) for the full picture, and the repo's own [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) (current and accurate as of HEAD, with one caveat noted there and in this wiki).

## Repository Structure

See [`repository-map.md`](repository-map.md) for full detail. Top level: `app/` (pages + `app/api/*` route handlers), `components/` (35 React components), `lib/` (37 modules + `lib/supabase/` — prompts, Supabase access, corpus loaders, error/usage/rate-limit helpers), `content/` (framework doc + two pathway corpora), `supabase/migrations/` (38 SQL files), `proxy.ts` (auth middleware), `instrumentation.ts` (server render-error recording), `Dockerfile` + `.github/workflows/deploy.yml` (two independent, non-overlapping deploy paths — see [`operations/deployment.md`](operations/deployment.md)).

## Technology Stack

- Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS v4
- `@anthropic-ai/sdk` ^0.106.0 → Anthropic API, model **`claude-sonnet-4-6`** everywhere it's called
- Supabase (`@supabase/supabase-js`, `@supabase/ssr`) — Postgres + Auth + RLS for all persistence
- Client-side document extraction: `pdfjs-dist`, `mammoth`, `xlsx` (SheetJS CDN build), `jszip` (manual PPTX text pull)
- `jspdf` (PDF export), `nodemailer` (SMTP email). (`googleapis`/Google Sheets logging and the unused `diff` dependency were removed.)
- GitHub Contents API via a hand-rolled `lib/github.ts` (real commits, not a stub)
- No test framework, no CI test job — see [`architecture/testing.md`](architecture/testing.md)

## Critical Business Rules

1. **Matching discipline**: "relevant" = same sector *and* same use-case category — the same test everywhere a pathway is surfaced.
2. **Micro-innovations are suggestions, never recommendations** — the user judges fit.
3. **Absence is stated plainly, never softened or backfilled with general AI/ML knowledge.** Pathway absence and micro-innovation absence are reported separately.
4. **Provenance / Source Trace appendix is contributor-only** — never shown in any adopter-facing response or on `/wiki`.
5. **The framework is never named as a process** in user-facing prose (no sub-category codes, densities, unit-type labels) — but the four dimension names and four stage names are public vocabulary.
6. **`stage` in `designs.meta` is only ever set from the user's own statement**, never assigned by the model.
7. Publishing a pathway is **two separate, independently-gated steps**: contributor "assemble" (→ GitHub) does not make it live; only admin "publish" (→ `published_pathways`) does. See [`business/workflows.md`](business/workflows.md#w-contributor-publish).

## Important APIs

Full reference: [`application/api-specification.md`](application/api-specification.md). Highlights:

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `app/api/chat/route.ts` | POST | mode-dependent (see below) | 7 modes; `library` is rate-limited (429) then input-checked (400) before anything else |
| `app/api/pathways/route.ts` | GET/POST | any role / `pathway_contributor` | list pathways / create one |
| `app/api/pathways/assemble/route.ts` | POST | `pathway_contributor` + membership | contributor publish → commits to GitHub |
| `app/api/admin/pathways/publish/route.ts` | POST | admin | copies `content_cache` → `published_pathways` (goes live) |
| `app/api/admin/contributor-registrations/approve/route.ts` | POST | admin | approves registration **and** grants `pathway_contributor` role in one step |
| `app/api/wiki-pathways/route.ts` | GET | none (public) | pathway metadata for source-attribution chips and `/explore` cards |
| `app/api/errors/client/route.ts` | POST | none (public, rate-limited, 16 KB cap) | browser error reports from the error pages → `sys_errors` |

`/api/chat`'s 7 modes: `companion`, `analysis-doc`, `executive-summary`, `extract-insights`, `pathway-draft`, `library` (public, no auth), `asset-reuse`. (`plan-document` and `pathway-exec-summary` were removed; they now get 400.) Any 5xx from any route has its body replaced with the generic message; the real error goes to `sys_errors`.

## Important Database Tables

Full reference: [`application/database.md`](application/database.md). Live tables: `user_roles`, `designs`, `design_documents`, `pathways`, `pathway_contributors`, `organisations`, `contributor_registrations`, `published_pathways`, `adoption_queries` (write-only, nothing reads it yet), `library_conversations`. **Server-only** (RLS on with no policies; service role only): `sys_errors` (30-day retention, opportunistic purge), `ai_usage`, `rate_limits`, plus service-role-only functions `purge_old_sys_errors`, `check_rate_limit`, `admin_usage_stats`. **Inert** (created, never read/written by current code): `pathway_cache`, `wiki_cache`, `pending_signups` (`contribution_units` is now used by toolkit assets since `0034`). **Dropped** (migration `0018`; the dead code that referenced them was deleted): `pathway_submissions`, `pathway_submission_versions`, `pathway_submission_exec_summaries`.

## Core Domain Models

- **Grid** (`designs.grid_state`) — 16 cells keyed `"<dimension>:<stage>"`, each `{density: 0-3, note: string}`. Structural shape in [`lib/dimensions.ts`](../../../lib/dimensions.ts): dimensions `persona`(4 sub-cats)/`solution`(5)/`institution`(7)/`ecosystem`(6); stages `Explore→Define→Pilot→Scale`.
- **`designs.meta`** — jsonb carrying everything the model needs to re-orient every turn (`flow`, `intent`, `flowStep`, `hypothesis`, `biggestRisk`, `confidence`, `persona`, `cubeAssessment`, …) — re-injected every turn because the `<grid_update>` block is stripped before storage.
- **`<grid_update>` JSON contract** — every companion-mode reply ends with one; fields `cells`, `meta`, `pathwaysReferenced`, `flowStep`, plus one of `explorerAction` (Explorer only) or `pathwayAction` (Contributor only). See [`integrations/ai-llm.md`](integrations/ai-llm.md).

## Core Services

- `lib/system-prompts.ts` (~890 lines) — every prompt builder; the true source of runtime behavior for both flows. `PROMPT_CACHE_BREAK` marks each builder's stable/per-turn boundary for prompt caching (`lib/prompt-cache.ts`).
- `lib/adoption-conversation.ts` (~2,500 lines) — the `useAdoptionConversation` client hook: lazy row creation, streaming, grid merge, dispatching the second API call when `explorerAction`/`pathwayAction` fires, and failure notices (`Message.notice`, never sent back or saved).
- `lib/errors.ts` — `withErrorHandling`, `logError`, `recordServerError`, secret scrubbing → `sys_errors`. `lib/ai-usage.ts` → `ai_usage`. `lib/rate-limit.ts` + `lib/explore-guard.ts` — Explore protection. `lib/static-content.ts` — production memoisation of `content/` files.
- `lib/wiki-loader.ts` / `lib/library-documents.ts` / `lib/wiki-content.ts` — three readers over the one static corpus `content/wiki/pathways/` (Analyse grounding, Library chat one-document-at-a-time with Source Trace stripped, on-demand `/wiki` browsing) — see [`integrations/ai-llm.md`](integrations/ai-llm.md#two-corpora).
- `lib/roles.ts` — the entire access-control primitive (`Role`, `hasRole`, `hasAnyRole`, `isAdmin`).
- `lib/github.ts` — real GitHub Contents API commit for contributor "assemble" publish.

## AI/LLM Components

Single model everywhere: **`claude-sonnet-4-6`**, via `@anthropic-ai/sdk`, key in `ANTHROPIC_API_KEY`. All `/api/chat` calls stream except `asset-reuse`; `/api/pathways/check-similar` is a non-streaming, forced-tool-use call (duplicate-pathway detection). No retries anywhere on any Anthropic call, but mid-stream failures are caught, recorded and shown as the generic message. Prompt caching (5-min ephemeral) for `companion` and `library` only. Per-mode corpus loading; the `library` mode reads one document at a time from `content/wiki/pathways/` or `published_pathways`, Source Trace stripped (MLC-16, 2026-10-20). Full detail: [`integrations/ai-llm.md`](integrations/ai-llm.md).

## Environment Variables

Full table: [`architecture/configuration.md`](architecture/configuration.md). Required at minimum: `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Notable and **not documented in CLAUDE.md**: `GITHUB_TOKEN` / `GITHUB_REPO` / `GITHUB_BRANCH` (used by `lib/github.ts` for contributor publish commits). New: `RATE_LIMIT_SALT`, `APP_ENV`, `EXPLORE_RATE_LIMIT_PER_MIN` (20) / `_PER_DAY` (200). Removed: `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID`. Pitfall: `WIKI_PATH=` set to an empty string disables the static grounding corpus (the code uses `??`) — leave it unset.

## Build Commands

```bash
npm install
npm run dev     # next dev
npm run build   # next build (output: "standalone")
npm run start   # next start
npm run lint    # eslint (flat config, next/core-web-vitals + typescript)
```

## Test Commands

> **Note:** No automated test suite exists in this repository today — no test files, no test runner config, and no `test` script in `package.json`. See [`architecture/testing.md`](architecture/testing.md) for what verification does exist (manual SMTP check script) and recommended setup.

## Deployment Commands

Two independent paths — see [`operations/deployment.md`](operations/deployment.md):
- **Vercel** (the live path): `.github/workflows/deploy.yml` runs `vercel deploy --prod` on push to `main`.
- **Docker/AWS** (built, not currently wired to any CI job): `docker build --build-arg IMAGE_PLATFORM=linux/arm64 ...` per the Dockerfile's own header comment.

## ⚠ Time-sensitive operational dependency (from the Product Charter)

Per `docs/raw_documents/AI DIffusion Cube - Product Charter.docx`: the **Anthropic/Claude API access this app depends on is a free account expiring 28-Oct-2026** — under a month away as of this page's last update (2026-09-28) — and the **AWS account is a free account expiring December 2026** (plan a replacement by Nov-2026). Neither is tracked anywhere in code; this note exists only because the charter recorded it. See [`operations/deployment.md#operational-dependency-risk-from-the-product-charter`](operations/deployment.md#operational-dependency-risk-from-the-product-charter) and re-verify both dates directly before relying on this note past its own currency.

## Product Roadmap (not yet implemented — see [`business/business-overview.md#roadmap-planned-not-yet-implemented`](business/business-overview.md#roadmap-planned-not-yet-implemented))

Per the Product Charter, milestones run through 15-Mar-27: a Claude-native chat channel, contributor reuse/incentive visibility, cross-pathway usage analytics, and channel expansion are all planned but not built. Several gaps are named in the charter's own non-functional requirements backlog: no tests and no retry/concurrency policy remain open; error logging/usage monitoring and an Explore rate limit now exist in code (monitoring/cleanup work); PII screening remains open.

## Troubleshooting Quick Guide

| Symptom | Likely cause | Where to look |
|---|---|---|
| A contributor's "assemble" publish appears to do nothing locally | It commits to the **remote** GitHub repo/branch, not the local working copy — `git pull` needed to see it | [`business/workflows.md`](business/workflows.md#w-contributor-publish) |
| A contributor's pathway never shows up for other users | Assemble ≠ live. A **separate admin publish** (`/api/admin/pathways/publish`) is required | same |
| A user sees "System encountered an error. Please try sometime later." | Any unexpected failure (5xx, broken stream, page crash) — the real cause is never shown to users | `/admin/errors` / `sys_errors`; see [`operations/troubleshooting.md`](operations/troubleshooting.md) |
| `/explore` chat says "Too many requests" or "Invalid request." | Per-IP rate limit, or Explore input caps | [`operations/troubleshooting.md`](operations/troubleshooting.md) |
| A new signup can't reach `/analyse` | `grant-default-role` failed after signup (rare) — check `user_roles` for a zero-row state | [`business/users-and-personas.md`](business/users-and-personas.md) |
| Auth emails aren't arriving | `SEND_EMAIL_HOOK_SECRET` mismatch, or SMTP creds wrong — test with `scripts/smtp-test.mjs` | [`operations/troubleshooting.md`](operations/troubleshooting.md) |

## Technical Debt Summary

Full register: [`knowledge/technical-debt.md`](knowledge/technical-debt.md). Headlines: **TD-16, urgent** — the Anthropic API account backing this entire app expires 28-Oct-2026 (see the callout above); no automated tests exist (P1); the duplicate library corpus is gone (TD-02 resolved 2026-10-20); no retry logic on Anthropic calls (P2 — failures now show the generic message and are recorded); several root docs (`CLAUDE.md`, `conversation_design.md`, `SIGNUP_APPROVAL_OPTIONS.md`, `README.md`, `AGENTS.md`) are stale (P2/P3); TD-15 partially resolved (Explore rate limit + input caps; no PII screening). **Resolved** in the monitoring/cleanup work: TD-01 (dead `pathway_submissions` code deleted), TD-10 (duplicate `parseFrontmatter`), TD-12 (dead prompt function).

## AI Agent Working Instructions

1. **Trust the code over `CLAUDE.md`.** `CLAUDE.md` describes an earlier "revamp-100pathways" state (four-intent Explorer menu, `/explore` as the Explorer entry point, `pathway_submissions` as the contributor draft table) that has been substantially superseded. `ARCHITECTURE.md` (repo root) is current and reliable, with one exception: its grid/table-vs-chips paragraph is itself stale (see [`architecture/architecture-overview.md`](architecture/architecture-overview.md#reconciliation)).
2. **`content/framework.md` is the single source of truth for framework behavior** — edit it, not code, to change what the model asks about.
3. **Before touching the Contributor publish path**, read the two-step publish rule above — it is easy to assume "assemble" makes content live; it does not.
4. **One static pathway corpus** (`content/wiki/pathways/`) serves both Analyse (only `index.md`-linked files) and the Library chat (any file by slug, Source Trace stripped). The separate `content/library-wiki/` copy was removed on 2026-10-20 (TD-02 resolved). Library cards are still hard-coded in `lib/library-pathways.ts`, merged with `published_pathways`.
5. **New API routes must be exported through `withErrorHandling('api/<path>', handle<METHOD>)`** (`lib/errors.ts`) — never send raw error text to the browser; throw `ValidationError`/`AuthError`/`NotFoundError` for expected failures. The `pathway_submissions`-era code has been deleted; don't recreate it.
6. This skill (`llm-wiki`) produces documentation only — it does not modify application source code.
