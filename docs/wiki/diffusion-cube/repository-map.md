# Repository Map

> Ownership is inferred from application structure — no `CODEOWNERS` file exists in this repository. Last refreshed 2026-11-06 (HEAD `0a1ca00` + uncommitted prompt-rule change).

## Folder hierarchy

```
diffusion-cube/
├── app/                     Next.js App Router: pages + API route handlers
│   ├── (app)/                 route group: /adoptions, /wiki, /wiki/[slug], /admin-gate layout
│   ├── account/                /account — account settings, contact sharing, deletion
│   ├── admin/                  /admin (+ /admin/usage, /admin/errors) — roles, registrations, pathways
│   ├── analyse/                /analyse — Explorer entry point
│   ├── api/                    route.ts handlers: account, admin, auth, chat, contributions, errors,
│   │                           organisations, pathways, toolkit-assets, wiki-pathways, wiki-stats
│   ├── contribute/             /contribute — Contributor entry point
│   ├── explore/                /explore — public Diffusion Library (reads the pathway store)
│   ├── login/                  /login — sign-in/signup/reset
│   ├── navigate/               /navigate — redirect stub → /analyse
│   ├── privacy/, terms/        legal pages (content/legal/)
│   ├── error.tsx, global-error.tsx, not-found.tsx   error screens
│   └── layout.tsx, globals.css  root layout + theme tokens
├── components/              37 React components (chat UI, admin panels, grid, gates, toolkit assets, Select)
├── content/                 framework.md, pathway-generation-prompt.md, resources.md, legal/
│                            (no pathway files — pathways live in Supabase)
├── lib/                     41 modules + lib/supabase/{client,server,admin}.ts
├── proxy.ts                 Next.js middleware — session gate, public-route allow-list
├── instrumentation.ts       server render-error recording
├── supabase/
│   ├── migrations/          42 SQL migrations, apply in order
│   └── functions/embed/     Deno Edge Function: text → 384-dim gte-small embeddings
├── scripts/                 seed-pathways.ts (+ seed-manifest.example.json, vite-node.config.mts), test-harness/answer-shape-eval/, smtp-test.mjs
├── tests/                   Vitest suite (105 test files): unit, api, client, db, features, pages, proxy, helpers
├── vitest.config.mts        test runner config (node env; jsdom per file)
├── .env.example             env var template
├── .github/workflows/deploy.yml   Vercel deploy on push to main (no test step)
├── Dockerfile, .dockerignore      AWS/ARM64-targeted container build (separate from CI)
├── docs/                    wiki/ (this wiki), features/ (per-feature requirement/plan/task docs),
│                            audits/2026-10-22/, raw_documents/
├── specs/                   feature specs (SIGNUP_OTP, ACCOUNT_DELETION, MONITORING_LOGGING_CLEANUP,
│                            TOOLKIT_ASSETS; SIGNUP_APPROVAL_OPTIONS superseded)
├── CLAUDE.md                AI-agent pointer into this wiki (mostly current)
└── ARCHITECTURE.md, README.md, AGENTS.md, conversation_design.md   stale relative to code
```

> **Note:** `docs/raw_documents/` holds two source documents (`Pathway Framework.pdf`, `AI DIffusion Cube - Product Charter.docx`) reconciled against code in [`architecture/architecture-overview.md`](architecture/architecture-overview.md) and [`business/business-overview.md`](business/business-overview.md). Root-level docs are treated as secondary reference material. See the inventory in [`wiki-index.md`](wiki-index.md#source--raw-documents).

## Key entry points

| Entry point | File | Purpose |
|---|---|---|
| Root layout | [`app/layout.tsx`](../../../app/layout.tsx) | fonts, metadata, `<body>` shell |
| Auth middleware | [`proxy.ts`](../../../proxy.ts) | session gate for every route except a public allow-list |
| Chat API | [`app/api/chat/route.ts`](../../../app/api/chat/route.ts) | single entry point for all 7 model-backed modes |
| Public library | [`app/explore/page.tsx`](../../../app/explore/page.tsx) | no-login pathway browsing + chat (`listPublished`) |
| Explorer flow | [`app/analyse/page.tsx`](../../../app/analyse/page.tsx) + [`StrengthenWorkspace.tsx`](../../../app/analyse/StrengthenWorkspace.tsx) | signed-in adopter workspace |
| Contributor flow | [`app/contribute/page.tsx`](../../../app/contribute/page.tsx) | contributor pathway-authoring workspace |
| Admin console | [`app/admin/page.tsx`](../../../app/admin/page.tsx) | role/registration/pathway management |
| Seed script | [`scripts/seed-pathways.ts`](../../../scripts/seed-pathways.ts) | `npm run seed:pathways -- --manifest …` |
| Answer eval | [`scripts/test-harness/answer-shape-eval/run.ts`](../../../scripts/test-harness/answer-shape-eval/run.ts) | `npm run eval:answers -- [--baseline <ref>]`: live, paid test of Analyse/Library answers |
| Embed function | [`supabase/functions/embed/index.ts`](../../../supabase/functions/embed/index.ts) | embeddings for units, passages and questions |

## Configuration locations

- Env vars: read via `process.env.*` across `lib/` and `app/api/`; template in [`.env.example`](../../../.env.example). Full table: [`architecture/configuration.md`](architecture/configuration.md).
- Framework question bank / behavior: [`content/framework.md`](../../../content/framework.md) — editing this changes model behavior with **no code change**.
- Retrieval tuning: `LIMITS` and `CLASSIFIER_MODEL` constants in [`lib/retrieval.ts`](../../../lib/retrieval.ts); embedding batch/retry constants in [`lib/embeddings.ts`](../../../lib/embeddings.ts).
- Brand theme tokens: [`app/globals.css`](../../../app/globals.css) `@theme inline` block.
- Build/deploy/test config: [`next.config.ts`](../../../next.config.ts), [`Dockerfile`](../../../Dockerfile), [`.github/workflows/deploy.yml`](../../../.github/workflows/deploy.yml), [`vitest.config.mts`](../../../vitest.config.mts).

## Prompt locations

All prompt assembly lives in [`lib/system-prompts.ts`](../../../lib/system-prompts.ts) (~940 lines). Shared answer-shape rule constants near the top (`BEST_MATCH_RULE`, `PATHWAY_CONTEXT_RULE`, `NEUTRAL_LANGUAGE_RULE`, `PLAIN_WORDS_RULE`) feed the Analyse, document and Library prompts. It injects, at runtime:
- [`content/framework.md`](../../../content/framework.md) — question bank, weights, unit types
- [`content/pathway-generation-prompt.md`](../../../content/pathway-generation-prompt.md) — pathway-draft generation rules
- [`content/resources.md`](../../../content/resources.md) — external-resource citation rules (Explorer only)
- [`lib/explorer-intents.ts`](../../../lib/explorer-intents.ts) — the single `ANALYSE_FLOW` numbered script
- per-message grounding text from [`lib/retrieval.ts`](../../../lib/retrieval.ts) `buildGrounding` (which also holds the classifier prompt/tool)

## API locations

`app/api/**/route.ts` — one file per route, no shared router config. Full endpoint table: [`application/api-specification.md`](application/api-specification.md).

## Database models

No ORM — raw Supabase client calls throughout `lib/` and `app/api/`. Schema of record is [`supabase/migrations/`](../../../supabase/migrations/) (42 files). Pathway content is in tables (`pathway_versions`, `pathway_units`, …) and the private `pathway-sources` storage bucket. Full schema and ERD: [`application/database.md`](application/database.md).

## Infrastructure files

[`Dockerfile`](../../../Dockerfile), [`.dockerignore`](../../../.dockerignore), [`.github/workflows/deploy.yml`](../../../.github/workflows/deploy.yml), [`next.config.ts`](../../../next.config.ts), [`supabase/functions/embed/`](../../../supabase/functions/embed/). No docker-compose, Kubernetes, or Terraform files exist in this repository.

## Folder-by-folder detail

### `app/`

- **Purpose**: every route (page or API) in the application.
- **Dependencies**: `lib/`, `components/`, `@supabase/ssr`/`@supabase/supabase-js`, `@anthropic-ai/sdk`.
- **Important files**: `app/api/chat/route.ts` (the whole model-facing surface: rate limit, size caps, `requiredRole`, retrieval, prompt assembly, streaming); `app/api/pathways/assemble` and `app/api/admin/pathways/{publish,delete,document}` (pathway lifecycle).
- **Typical modifications**: new chat mode (edit `MODES` + `requiredRole` + a new `lib/system-prompts.ts` builder); new route (wrap with `withErrorHandling`); new gated page (`proxy.ts` allow-list decision + page role check + API role check).

### `components/`

- **Purpose**: all React UI. Tailwind utility classes only; three hand-rolled markdown renderers (`ChatPanel.tsx`, `WikiMarkdown.tsx`, `lib/adoption-plan-markdown.ts`) — see [`architecture/coding-patterns.md`](architecture/coding-patterns.md).
- **Dependencies**: `lib/dimensions.ts`, `lib/grid-update.ts`, `lib/adoption-conversation.ts`, `lib/toolkit-assets.ts`.
- **Important files**: `AdoptionWorkspace.tsx` (shared chat workspace), `ChatPanel.tsx`, `AppShell.tsx`, `HeatmapGrid.tsx`, `AdminPathwaysPanel.tsx` / `AdminPathwayRowCard.tsx` (status filter, draft badges), `Select.tsx`, toolkit asset components (`ToolkitAsset*`, `ResourceReviewCard`, `AssetShareCard`, `ReusableAssetsPanel`).
- **Typical modifications**: new admin panel (server page loads rows, client component owns actions); each component has a matching test under `tests/features/`.

### `lib/`

- **Purpose**: everything that isn't UI — prompts, retrieval, pathway store, Supabase access, parsing, roles, errors, rate limits.
- **Important files**: `system-prompts.ts`, `retrieval.ts`, `pathway-store.ts`, `pathway-units.ts`, `embeddings.ts`, `seed.ts`, `adoption-conversation.ts`, `dimensions.ts`, `roles.ts`, `errors.ts`, `rate-limit.ts`, `toolkit-assets*.ts`, `wiki-content.ts` (`/wiki` pages over the store), `wiki-loader.ts` (framework/prompt/resources files + `datedLine`), `provenance.ts` (Source Trace stripping).
- **Removed since the last refresh**: `github.ts`, `library-documents.ts`, `library-pathways.ts`.
- **Typical modifications**: answer style → the shared rule constants in `system-prompts.ts`; retrieval breadth → `LIMITS` in `retrieval.ts`; framework behavior → `content/framework.md`.

### `content/`

- **Purpose**: framework definition and prompt-injected instruction files, plus legal page content.
- **Structure**: `framework.md`, `pathway-generation-prompt.md`, `resources.md`, `legal/`. Pathway documents are **not** stored here any more (the former `content/wiki/` and `content/library-wiki/` corpora were removed by the pathway-storage feature).
- **Typical modifications**: add a pathway via the seed script or the contributor → admin publish flow, never as a file here.

### `supabase/`

- **`migrations/`**: schema of record, 42 sequential SQL files, normally additive. Destructive exceptions: `0008`, `0018`, and `0042` (drops the old `published_pathways` table and recreates it as a view). `0040` requires its code to be deployed first (see its header).
- **`functions/embed/`**: Deno Edge Function, deploy per project with `supabase functions deploy embed --project-ref <ref>`; service-role callers only; excluded from the Next.js tsconfig and ESLint.

### `scripts/`

`seed-pathways.ts` (seeds pathways + original documents from a manifest; `--dry-run`, `--only`), `seed-manifest.example.json`, `vite-node.config.mts`, `test-harness/answer-shape-eval/` (`npm run eval:answers`; its test set, results and write-up are in its `answer-shape-feedback/` folder: a 10-question live answer test; its own vite-node config swaps the usage and error loggers for console stubs, so it never writes to Supabase; results are gitignored), and `smtp-test.mjs` (manual SMTP diagnostic, not an npm script).

### `tests/`

Vitest suite — `unit/` (lib + server modules), `api/` (route handlers), `client/` (conversation hook), `db/` (migrations), `features/` (components), `pages/`, `proxy/`, with shared mocks in `helpers/` and env setup in `setup.ts`. See [`architecture/testing.md`](architecture/testing.md).

### Root-level files

`proxy.ts`, `instrumentation.ts`, `Dockerfile`/`.dockerignore`, `next.config.ts`/`tsconfig.json`/`eslint.config.mjs`/`postcss.config.mjs`/`vitest.config.mts`, `.env.example`, and the reference docs listed in [`wiki-index.md`](wiki-index.md#source--raw-documents).
