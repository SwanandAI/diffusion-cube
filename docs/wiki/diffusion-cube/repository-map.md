# Repository Map

> Ownership is inferred from application structure — no `CODEOWNERS` file exists in this repository.

## Folder hierarchy

```
diffusion-cube/
├── app/                     Next.js App Router: pages + API route handlers
│   ├── (app)/                 route group: /adoptions, /wiki, /wiki/[slug], /admin-gate layout
│   ├── admin/                  /admin — role & registration management
│   ├── analyse/                 /analyse — Explorer entry point
│   ├── api/                      all route.ts handlers (chat, pathways, admin, auth, ...)
│   ├── contribute/                /contribute — Contributor entry point
│   ├── explore/                    /explore — public Diffusion Library
│   ├── login/                        /login — sign-in/signup/reset
│   ├── navigate/                      /navigate — dead redirect stub → /analyse
│   ├── layout.tsx, globals.css          root layout + theme tokens
├── components/               20 React components (chat UI, admin panels, grid, gates)
├── content/                   corpus + framework (see below)
├── lib/                        24 modules: prompts, Supabase access, corpus loaders, utilities
├── proxy.ts                     Next.js middleware — session gate, public-route allow-list
├── supabase/migrations/           32 SQL migrations, apply in order
├── scripts/smtp-test.mjs           manual SMTP diagnostic (not wired into npm scripts)
├── .github/workflows/deploy.yml    Vercel deploy on push to main
├── Dockerfile, .dockerignore        AWS/ARM64-targeted container build (separate from CI)
├── ARCHITECTURE.md                  current, accurate architecture doc (see note below)
├── CLAUDE.md                         AI agent instructions — describes an earlier app state
├── conversation_design.md             early companion-tone design doc, ~126 commits stale
├── SIGNUP_OTP_SPEC.md / SIGNUP_APPROVAL_OPTIONS.md   auth design docs (former current, latter superseded)
└── README.md, AGENTS.md               unmodified create-next-app boilerplate
```

> **Note:** `docs/raw_documents/` holds two source documents (`Pathway Framework.pdf`, `AI DIffusion Cube - Product Charter.docx`) reconciled against code in [`architecture/architecture-overview.md`](architecture/architecture-overview.md) and [`business/business-overview.md`](business/business-overview.md). The root-level docs (`CLAUDE.md`, `ARCHITECTURE.md`, `conversation_design.md`, `SIGNUP_OTP_SPEC.md`, `SIGNUP_APPROVAL_OPTIONS.md`, `README.md`, `AGENTS.md`) are treated the same way, as secondary reference material. See the raw-document inventory in [`wiki-index.md`](wiki-index.md#source--raw-documents).

## Key entry points

| Entry point | File | Purpose |
|---|---|---|
| Root layout | [`app/layout.tsx`](../../../app/layout.tsx) | fonts, metadata, `<body>` shell |
| Auth middleware | [`proxy.ts`](../../../proxy.ts) | session gate for every route except a public allow-list |
| Chat API | [`app/api/chat/route.ts`](../../../app/api/chat/route.ts) | single entry point for all 8 model-backed modes |
| Public library | [`app/explore/page.tsx`](../../../app/explore/page.tsx) | no-login pathway browsing + chat |
| Explorer flow | [`app/analyse/page.tsx`](../../../app/analyse/page.tsx) + [`StrengthenWorkspace.tsx`](../../../app/analyse/StrengthenWorkspace.tsx) | signed-in adopter analysis workspace |
| Contributor flow | [`app/contribute/page.tsx`](../../../app/contribute/page.tsx) | signed-in contributor pathway-authoring workspace |
| Admin console | [`app/admin/page.tsx`](../../../app/admin/page.tsx) | role/registration/pathway management |

## Configuration locations

- Env vars: read directly via `process.env.*` across `lib/` and `app/api/` — no central config module. Full table: [`architecture/configuration.md`](architecture/configuration.md).
- Framework question bank / behavior: [`content/framework.md`](../../../content/framework.md) — editing this changes model behavior with **no code change**.
- Brand theme tokens: [`app/globals.css`](../../../app/globals.css) `@theme inline` block.
- Build/deploy config: [`next.config.ts`](../../../next.config.ts), [`Dockerfile`](../../../Dockerfile), [`.github/workflows/deploy.yml`](../../../.github/workflows/deploy.yml).

## Prompt locations

All prompt assembly lives in [`lib/system-prompts.ts`](../../../lib/system-prompts.ts) (877 lines) — the single file that defines every mode's behavior. It injects, at runtime:
- [`content/framework.md`](../../../content/framework.md) — question bank, weights, unit types
- [`content/pathway-generation-prompt.md`](../../../content/pathway-generation-prompt.md) — pathway-draft generation rules (its own header comment claiming "not used at runtime" is stale — it *is* injected by `pathway-draft` mode)
- [`content/resources.md`](../../../content/resources.md) — external-resource citation rules (Explorer only)
- [`lib/explorer-intents.ts`](../../../lib/explorer-intents.ts) — the single `ANALYSE_FLOW` numbered script
- [`lib/dimensions.ts`](../../../lib/dimensions.ts)'s `frameworkStructureLegend()` — compact dimension/sub-category/weight legend

## API locations

`app/api/**/route.ts` — one file per route, no shared router config. Full endpoint table: [`application/api-specification.md`](application/api-specification.md).

## Database models

No ORM — raw Supabase client calls (`.from('table')...`) throughout `lib/` and `app/api/`. Schema of record is [`supabase/migrations/`](../../../supabase/migrations/) (32 files, apply in numeric order). Full current-schema table and ERD: [`application/database.md`](application/database.md).

## Infrastructure files

[`Dockerfile`](../../../Dockerfile), [`.dockerignore`](../../../.dockerignore), [`.github/workflows/deploy.yml`](../../../.github/workflows/deploy.yml), [`next.config.ts`](../../../next.config.ts). No docker-compose, Kubernetes, or Terraform files exist in this repository.

## Folder-by-folder detail

### `app/`

- **Purpose**: every route (page or API) in the application.
- **Dependencies**: `lib/` (data access, prompts), `components/` (UI), `@supabase/ssr`/`@supabase/supabase-js`, `@anthropic-ai/sdk`.
- **Important files**: `app/api/chat/route.ts` (the whole model-facing surface), `proxy.ts` is a sibling at repo root, not under `app/`.
- **Typical modifications**: adding a new chat mode (edit `MODES` array + a new branch + a new `lib/system-prompts.ts` builder); adding a new gated page (add to `proxy.ts`'s `PUBLIC_PATHS` decision, then the page's own role check).

### `components/`

- **Purpose**: all React UI. No component library beyond Tailwind utility classes; three independent hand-rolled markdown renderers exist across this folder and `lib/` (`ChatPanel.tsx`, `WikiMarkdown.tsx`, `lib/adoption-plan-markdown.ts`) — see [`architecture/coding-patterns.md`](architecture/coding-patterns.md).
- **Dependencies**: `lib/dimensions.ts` (grid shape), `lib/grid-update.ts` (marker constants), `lib/adoption-conversation.ts` (the conversation hook).
- **Important files**: `AdoptionWorkspace.tsx` (~1020 lines, the shared chat workspace for all three flows), `ChatPanel.tsx` (~700 lines), `AppShell.tsx` (shared nav shell), `HeatmapGrid.tsx` (renders the 4×4 grid as a literal table — see reconciliation note in [`architecture/architecture-overview.md`](architecture/architecture-overview.md)).
- **Typical modifications**: new admin panel (mirror `AdminPathwaysPanel.tsx`'s pattern: server page loads rows, client component owns actions).

### `lib/`

- **Purpose**: everything that isn't UI — prompt assembly, Supabase access, corpus loading, PDF/markdown parsing, roles.
- **Dependencies**: `content/` (corpus + framework files), Supabase clients (`lib/supabase/*`), `@anthropic-ai/sdk` types.
- **Important files**: `system-prompts.ts`, `adoption-conversation.ts`, `dimensions.ts`, `roles.ts`, `wiki-loader.ts` / `library-wiki-loader.ts` / `wiki-content.ts` (three distinct corpus readers — do not conflate), `github.ts` (real GitHub commit for contributor publish).
- **Typical modifications**: changing model behavior for a mode → edit the matching function in `system-prompts.ts`; changing what counts as "relevant corpus" → edit `content/framework.md`, not code.

### `content/`

- **Purpose**: the framework definition and the two pathway corpora.
- **Structure**: `framework.md` (question bank + weights, prompt-injected), `pathway-generation-prompt.md` (contributor-draft generation rules, prompt-injected), `resources.md` (external-citation rules), `wiki/pathways/` (12 files + `index.md` — the grounding corpus for `/analyse` and `/contribute`), `library-wiki/pathways/` (8 files, no index — the separate `/explore` corpus).
- **Typical modifications**: adding a pathway to the grounding corpus requires **both** dropping the `.md` file *and* linking it from `content/wiki/pathways/index.md` — six existing files are on-disk but unlinked from the index and therefore excluded from both prompt-grounding and the `/wiki` browse listing (see [`knowledge/technical-debt.md`](knowledge/technical-debt.md)).

### `supabase/migrations/`

- **Purpose**: the schema of record, 32 sequential SQL files.
- **Typical modifications**: always additive, numbered one higher than the current max; migration `0008` and `0018` are the two destructive/table-dropping exceptions in this repo's history. See [`application/database.md`](application/database.md) for the full current-schema synthesis.

### Root-level files

`proxy.ts` (auth middleware — despite the filename, this is a standard Next.js middleware file), `Dockerfile`/`.dockerignore` (AWS-targeted container build), `next.config.ts`/`tsconfig.json`/`eslint.config.mjs`/`postcss.config.mjs` (framework/tooling config), and the reconciled reference docs listed in [`wiki-index.md`](wiki-index.md#source--raw-documents).
