# Infrastructure

## The pieces, at a glance

| Piece | What it is | Defined in this repo by |
|---|---|---|
| Web app | Next.js 16 server — Vercel (live CI path) or a Docker image (AWS path) | `.github/workflows/deploy.yml`, `Dockerfile`, `next.config.ts` |
| Database + Auth | Supabase Postgres (with `pgvector`, enabled by migration `0042`) and Supabase Auth | `supabase/migrations/0001`–`0042` |
| Embedding service | **`embed` Supabase Edge Function** (Deno, `gte-small`, 384-dim vectors) — runs inside each Supabase project, no external vendor or API key | `supabase/functions/embed/index.ts` |
| File storage | Two Supabase Storage buckets: **`toolkit-assets`** (migration `0034`) and the private **`pathway-sources`** (migration `0042`, 50 MB per file, no `storage.objects` policies — service role only) | the two migrations above |
| LLM | Anthropic API (Sonnet for chat/generation, Haiku for the retrieval classifier — see [`../integrations/ai-llm.md`](../integrations/ai-llm.md)) | `ANTHROPIC_API_KEY` |

Pathway content **no longer lives in Git or in files shipped with the app** — since migration `0042` every pathway is rows in Supabase (`pathways`, `pathway_versions`, `pathway_units`, `pathway_sources`, `pathway_source_chunks`) plus, for seeded pathways, original files in the `pathway-sources` bucket. GitHub is no longer a runtime dependency (`lib/github.ts` and the `GITHUB_*` env vars are gone). See [`../application/database.md`](../application/database.md).

## Two independent, non-overlapping web-app paths

This repository contains infrastructure for **two separate deployment targets for the Next.js app that do not connect to each other**. There is no CI job that builds and pushes the Docker image anywhere, and Vercel deploys never touch the Dockerfile. Both paths talk to the same kind of Supabase project (database, Auth, Storage and the `embed` Edge Function), which is set up separately — see [`deployment.md`](deployment.md#supabase-project-setup-per-environment).

## Docker / AWS path

**`Dockerfile`** (58 lines) — multi-stage build (`deps` → `builder` → `runner`):

- Base image `node:22-alpine`, targeting **`linux/arm64`** by default via a pinned `FROM --platform` on every stage (`IMAGE_PLATFORM` build-arg to override) — intended for AWS App Runner / ECS Fargate / EC2 Graviton, per the file's own header comment.
- A plain `docker build` on an x86 laptop still emits an arm64 image via QEMU emulation; the build stage sets `NODE_OPTIONS=--max-old-space-size=4096` because emulated-architecture builds are more memory-hungry.
- **`NEXT_PUBLIC_*` environment variables must be passed as Docker build arguments**, not just runtime env vars — they are baked into the client bundle at build time. Passing them only at `docker run` time will silently ship the wrong (or empty) value to the browser. (`NEXT_PUBLIC_SUPABASE_URL` is also read server-side at runtime, e.g. by `lib/embeddings.ts` to reach the `embed` function.)
- `content/` is explicitly `COPY`'d into the final image, because `lib/wiki-loader.ts` reads it off the filesystem via `process.cwd()` at runtime. `content/` now holds only the app's own operating content — `framework.md`, `pathway-generation-prompt.md`, `resources.md` and `legal/` — not pathways.
- Final stage drops to a non-root `nextjs` user; copies `.next/standalone` + `.next/static` + `public/` + `content/`; `CMD ["node", "server.js"]`.

**`.dockerignore`** — excludes `node_modules`, `.next`, `.git`, `.github`, `.claude`, `.env*`, `npm-debug.log*`, `*.tsbuildinfo`.

**`next.config.ts`** — sets `output: "standalone"` specifically for this Docker/AWS path (the comment notes it is harmless on Vercel, which ignores it) and `devIndicators: false`.

> **Note:** No docker-compose file, Kubernetes manifest, or Terraform configuration exists anywhere in this repository. Whatever AWS/EC2 environment this image actually runs on (referenced by a past commit message, "add Docker support and AWS EC2") is provisioned and deployed manually, outside this repository's automation — this wiki cannot describe that environment's topology because it isn't defined in code here.

## Vercel path (the one with live CI)

See [`deployment.md`](deployment.md) for the full workflow. In short: `.github/workflows/deploy.yml` runs `vercel deploy --prod` on every push to `main`, using project-scoped `VERCEL_TOKEN`/`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` secrets — no Docker image is involved in this path at all. The workflow runs **no tests, lint or typecheck** before deploying (see [`../architecture/testing.md`](../architecture/testing.md)).

## Supabase Edge Function — `embed`

- **What:** turns text into 384-dimension `gte-small` vectors using Supabase's built-in AI runtime (`Supabase.ai.Session('gte-small')`). Accepts at most 32 texts × 8,000 characters per call.
- **Who calls it:** only the app server (`lib/embeddings.ts`) and the seed script, with the project's service-role key. The function checks the caller is `service_role` and relies on Supabase's default JWT verification at the gateway — its own comment warns **never deploy it with `--no-verify-jwt`**.
- **Runtime limits:** the app sends batches of 4 texts (≈1,600 chars each), 20 s timeout. A batch of 8 was measured failing with `546 WORKER_RESOURCE_LIMIT` on dev (2026-11-04). See [`troubleshooting.md`](troubleshooting.md#search--retrieval).
- **Per project:** dev and prod Supabase projects each need their own deploy — it is not part of the Vercel or Docker build. It runs on Deno and is excluded from the Next.js `tsconfig` and ESLint.

## Tooling/config files

| File | Purpose |
|---|---|
| `next.config.ts` | `output: "standalone"`, `devIndicators: false` |
| `tsconfig.json` | Next 16 standard config, `target: ES2017`, `strict: true`, `moduleResolution: "bundler"`, path alias `@/*` |
| `eslint.config.mjs` | Flat config, `eslint-config-next` (`core-web-vitals` + `typescript`), re-declares default ignores |
| `postcss.config.mjs` | Single plugin: `@tailwindcss/postcss` |
| `vitest.config.mts` | Vitest 3 test runner (`npm test`); v8 coverage to `tests/coverage` — see [`../architecture/testing.md`](../architecture/testing.md) |
| `scripts/vite-node.config.mts` | Config for `npm run seed:pathways` (runs the TypeScript seed script with the app's `@/` imports) |
| `.env.example` | Every env var the app reads, with defaults and comments — see [`../architecture/configuration.md`](../architecture/configuration.md) |

## Source files

`Dockerfile`, `.dockerignore`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `vitest.config.mts`, `.env.example`, `supabase/functions/embed/index.ts`, `lib/embeddings.ts`, `supabase/migrations/0034_contribution_units_toolkit_assets.sql`, `supabase/migrations/0042_pathway_storage.sql`.
