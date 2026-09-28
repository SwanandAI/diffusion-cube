# AI Context — Diffusion Cube

> Single most information-dense document in this wiki. Read this first. Every claim below traces to a file in this repository (branch `Swanand_DC` at the time of writing).

## Service Summary

**Diffusion Cube** (package name `ai-diffusion-cube-app`, product-facing name "Diffusion Cube | 100 Pathways") is a Next.js 16 / React 19 web app that is the conversational companion to the public site **100pathways.com**. It ships three distinct products behind one app shell and one chat API route:

- **`/explore`** — the public, no-login **Diffusion Library**: browse and chat with individual AI-deployment pathway write-ups.
- **`/analyse`** — the **Explorer** flow (needs the `adopter` role): a signed-in user analyses their own AI adoption against the corpus of real deployments.
- **`/contribute`** — the **Contributor** flow (needs `pathway_contributor` + an approved registration): a signed-in user turns their own deployment write-up into a new corpus pathway and, with an admin's final publish step, pushes it live.
- **`/admin`** — role assignment, contributor-registration approval, and pathway publishing oversight.

## Business Purpose

100 Pathways exists to help people **adopt AI well** by grounding advice in real, documented deployments (not generic AI/ML best practice). The app operationalizes a 4-dimension × 4-stage "AI Diffusion Pathway Framework" so that a user's own situation can be compared, cell by cell, against a corpus of prior deployments' lived experience — turning "what should I do next" into a question answerable from precedent rather than intuition.

## Major Capabilities

1. Public pathway library with per-pathway chat, grounded in one document at a time (`/explore`).
2. Explorer flow: free-text/document-driven conversation that tracks a 4×4 "grid" of what's known about the user's deployment, compares against the whole pathway corpus, and can generate an **Analysis Document** and a smaller **Executive Summary**, both versioned in Supabase.
3. Contributor flow: document-first pipeline that infers a deployment stage, auto-drafts a full pathway document (Sections 0–6 + Source Trace appendix) once enough is known, and lets the contributor revise it conversationally before publishing.
4. Two-step publish: contributor "assemble" commits the draft to GitHub (`content/wiki/pathways/<slug>.md`); a separate **admin** publish step copies it into the `published_pathways` table, which is what actually goes live in the corpus — no redeploy needed.
5. Role-gated admin console: role grants/revokes, contributor-registration approve/reject, pathway publish/delete.
6. Auth: Supabase email+password with 6-digit OTP signup/reset, delivered via a custom SMTP hook (no Supabase-hosted email).

## Architecture Summary

Next.js App Router monolith. `proxy.ts` (Next middleware) gates every route except a public allow-list. One route handler, `app/api/chat/route.ts`, serves **8 modes**, all streamed from a single Anthropic model (`claude-sonnet-4-6`). Corpus content is dual: static markdown files committed in `content/` (two **separate, overlapping** corpora — see [`integrations/ai-llm.md`](integrations/ai-llm.md)) merged at read time with two Supabase tables (`published_pathways` for live corpus content, `pathways`/`design_documents` for in-progress contributor work). See [`architecture/architecture-overview.md`](architecture/architecture-overview.md) for the full picture, and the repo's own [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) (current and accurate as of HEAD, with one caveat noted there and in this wiki).

## Repository Structure

See [`repository-map.md`](repository-map.md) for full detail. Top level: `app/` (pages + `app/api/*` route handlers), `components/` (20 React components), `lib/` (24 modules — prompts, Supabase access, corpus loaders), `content/` (framework doc + two pathway corpora), `supabase/migrations/` (32 SQL files), `proxy.ts` (auth middleware), `Dockerfile` + `.github/workflows/deploy.yml` (two independent, non-overlapping deploy paths — see [`operations/deployment.md`](operations/deployment.md)).

## Technology Stack

- Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS v4
- `@anthropic-ai/sdk` ^0.106.0 → Anthropic API, model **`claude-sonnet-4-6`** everywhere it's called
- Supabase (`@supabase/supabase-js`, `@supabase/ssr`) — Postgres + Auth + RLS for all persistence
- Client-side document extraction: `pdfjs-dist`, `mammoth`, `xlsx` (SheetJS CDN build), `jszip` (manual PPTX text pull)
- `jspdf` (PDF export), `diff` (declared, no confirmed caller found), `nodemailer` (SMTP email), `googleapis` (Sheets logging)
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
| `app/api/chat/route.ts` | POST | mode-dependent (see below) | 8 modes, all streamed from Claude |
| `app/api/pathways/route.ts` | GET/POST | any role / `pathway_contributor` | list pathways / create one |
| `app/api/pathways/assemble/route.ts` | POST | `pathway_contributor` + membership | contributor publish → commits to GitHub |
| `app/api/admin/pathways/publish/route.ts` | POST | admin | copies `content_cache` → `published_pathways` (goes live) |
| `app/api/admin/contributor-registrations/approve/route.ts` | POST | admin | approves registration **and** grants `pathway_contributor` role in one step |
| `app/api/wiki-pathways/route.ts` | GET | none (public) | pathway metadata for source-attribution chips and `/explore` cards |

`/api/chat`'s 8 modes: `companion`, `library` (public, no auth), `extract-insights`, `analysis-doc`, `executive-summary`, `plan-document`, `pathway-draft`, `pathway-exec-summary`.

## Important Database Tables

Full reference: [`application/database.md`](application/database.md). Live tables: `user_roles`, `designs`, `design_documents`, `pathways`, `pathway_contributors`, `organisations`, `contributor_registrations`, `published_pathways`, `adoption_queries` (write-only, nothing reads it yet), `library_conversations`. **Inert** (created, never read/written by current code): `pathway_cache`, `wiki_cache`, `pending_signups`, `contribution_units`. **Dropped** (migration `0018`, but three route files and one lib file still reference them — dead/broken code, see [`knowledge/technical-debt.md`](knowledge/technical-debt.md#td-01)): `pathway_submissions`, `pathway_submission_versions`, `pathway_submission_exec_summaries`.

## Core Domain Models

- **Grid** (`designs.grid_state`) — 16 cells keyed `"<dimension>:<stage>"`, each `{density: 0-3, note: string}`. Structural shape in [`lib/dimensions.ts`](../../../lib/dimensions.ts): dimensions `persona`(4 sub-cats)/`solution`(5)/`institution`(7)/`ecosystem`(6); stages `Explore→Define→Pilot→Scale`.
- **`designs.meta`** — jsonb carrying everything the model needs to re-orient every turn (`flow`, `intent`, `flowStep`, `hypothesis`, `biggestRisk`, `confidence`, `persona`, `cubeAssessment`, …) — re-injected every turn because the `<grid_update>` block is stripped before storage.
- **`<grid_update>` JSON contract** — every companion-mode reply ends with one; fields `cells`, `meta`, `pathwaysReferenced`, `flowStep`, plus one of `explorerAction` (Explorer only) or `pathwayAction` (Contributor only). See [`integrations/ai-llm.md`](integrations/ai-llm.md).

## Core Services

- `lib/system-prompts.ts` (877 lines) — every prompt builder; the true source of runtime behavior for both flows.
- `lib/adoption-conversation.ts` (1145 lines) — the `useAdoptionConversation` client hook: lazy row creation, streaming, grid merge, and dispatching the second API call when `explorerAction`/`pathwayAction` fires.
- `lib/wiki-loader.ts` / `lib/library-wiki-loader.ts` / `lib/wiki-content.ts` — three distinct corpus readers (grounding corpus, Library corpus, on-demand `/wiki` browsing) — see [`integrations/ai-llm.md`](integrations/ai-llm.md#two-corpora).
- `lib/roles.ts` — the entire access-control primitive (`Role`, `hasRole`, `hasAnyRole`, `isAdmin`).
- `lib/github.ts` — real GitHub Contents API commit for contributor "assemble" publish.

## AI/LLM Components

Single model everywhere: **`claude-sonnet-4-6`**, via `@anthropic-ai/sdk`, key in `ANTHROPIC_API_KEY`. All `/api/chat` calls stream; `/api/pathways/check-similar` is the one non-streaming, forced-tool-use call (duplicate-pathway detection). No retries anywhere on any Anthropic call. Full detail: [`integrations/ai-llm.md`](integrations/ai-llm.md).

## Environment Variables

Full table: [`architecture/configuration.md`](architecture/configuration.md). Required at minimum: `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Notable and **not documented in CLAUDE.md**: `GITHUB_TOKEN` / `GITHUB_REPO` / `GITHUB_BRANCH` (used by `lib/github.ts` for contributor publish commits).

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

Per the Product Charter, milestones run through 15-Mar-27: a Claude-native chat channel, contributor reuse/incentive visibility, cross-pathway usage analytics, and channel expansion are all planned but not built. Several already-documented gaps in this wiki (no tests, no retry/concurrency policy, no structured logging, no rate limiting/PII screening) are explicitly named in the charter's own non-functional requirements backlog as "Not started" — they are roadmapped work, not just organically-discovered debt.

## Troubleshooting Quick Guide

| Symptom | Likely cause | Where to look |
|---|---|---|
| A contributor's "assemble" publish appears to do nothing locally | It commits to the **remote** GitHub repo/branch, not the local working copy — `git pull` needed to see it | [`business/workflows.md`](business/workflows.md#w-contributor-publish) |
| A contributor's pathway never shows up for other users | Assemble ≠ live. A **separate admin publish** (`/api/admin/pathways/publish`) is required | same |
| `/api/pathway-submissions/push` (or either `admin/pathway-submissions/*` route) errors | These reference `pathway_submissions`, dropped in migration `0018` — genuinely broken, not a bug in your test | [`knowledge/technical-debt.md#td-01`](knowledge/technical-debt.md#td-01) |
| A new signup can't reach `/analyse` | `grant-default-role` failed after signup (rare) — check `user_roles` for a zero-row state | [`business/users-and-personas.md`](business/users-and-personas.md) |
| Auth emails aren't arriving | `SEND_EMAIL_HOOK_SECRET` mismatch, or SMTP creds wrong — test with `scripts/smtp-test.mjs` | [`operations/troubleshooting.md`](operations/troubleshooting.md) |

## Technical Debt Summary

Full register: [`knowledge/technical-debt.md`](knowledge/technical-debt.md). Headlines: **TD-16, urgent** — the Anthropic API account backing this entire app expires 28-Oct-2026 (see the callout above); three route files + one lib file + one component reference a table dropped two migrations ago (P1); `contribution_units` is a fully-built, RLS-correct table nothing writes (P2); two overlapping-but-separate pathway corpora exist with real content duplication risk (P2); several root docs (`CLAUDE.md`, `conversation_design.md`, `SIGNUP_APPROVAL_OPTIONS.md`, `README.md`, `AGENTS.md`) are stale relative to current code (P2/P3); no automated tests exist (P1); no rate limiting/PII screening/security hardening exists (P3, but explicitly roadmapped per the Product Charter).

## AI Agent Working Instructions

1. **Trust the code over `CLAUDE.md`.** `CLAUDE.md` describes an earlier "revamp-100pathways" state (four-intent Explorer menu, `/explore` as the Explorer entry point, `pathway_submissions` as the contributor draft table) that has been substantially superseded. `ARCHITECTURE.md` (repo root) is current and reliable, with one exception: its grid/table-vs-chips paragraph is itself stale (see [`architecture/architecture-overview.md`](architecture/architecture-overview.md#reconciliation)).
2. **`content/framework.md` is the single source of truth for framework behavior** — edit it, not code, to change what the model asks about.
3. **Before touching the Contributor publish path**, read the two-step publish rule above — it is easy to assume "assemble" makes content live; it does not.
4. **Two pathway corpora exist** (`content/wiki/pathways/` vs `content/library-wiki/pathways/`) — know which one a change is meant to affect before editing either.
5. **Do not wire up `pathway_submissions`-era code** (`lib/pathway-submission-versions.ts`, `PathwaySubmissionsPanel.tsx`, the three `pathway-submissions` routes) — the table is gone; delete-or-replace, don't extend.
6. This skill (`llm-wiki`) produces documentation only — it does not modify application source code.
