# Infrastructure

## Two independent, non-overlapping infrastructure paths

This repository contains infrastructure for **two separate deployment targets that do not connect to each other** — confirmed by reading every relevant file. There is no CI job that builds and pushes the Docker image anywhere, and Vercel deploys never touch the Dockerfile. See [`deployment.md`](deployment.md) for the full deploy mechanics of each.

## Docker / AWS path

**`Dockerfile`** (58 lines) — multi-stage build (`deps` → `builder` → `runner`):

- Base image `node:22-alpine`, targeting **`linux/arm64`** by default via a pinned `FROM --platform` on every stage (`IMAGE_PLATFORM` build-arg to override) — intended for AWS App Runner / ECS Fargate / EC2 Graviton, per the file's own header comment.
- A plain `docker build` on an x86 laptop still emits an arm64 image via QEMU emulation; the build stage sets `NODE_OPTIONS=--max-old-space-size=4096` because emulated-architecture builds are more memory-hungry.
- **`NEXT_PUBLIC_*` environment variables must be passed as Docker build arguments**, not just runtime env vars — they are baked into the client bundle at build time. Passing them only at `docker run` time will silently ship the wrong (or empty) value to the browser.
- `content/` is explicitly `COPY`'d into the final image, because `lib/wiki-loader.ts` reads the corpus off the filesystem via `process.cwd()` at runtime — omitting this copy would break corpus grounding in production.
- Final stage drops to a non-root `nextjs` user; copies `.next/standalone` + `.next/static` + `public/` + `content/`; `CMD ["node", "server.js"]`.

**`.dockerignore`** — excludes `node_modules`, `.next`, `.git`, `.github`, `.claude`, `.env*`, `npm-debug.log*`, `*.tsbuildinfo`.

**`next.config.ts`** — sets `output: "standalone"` specifically for this Docker/AWS path (the comment notes it is harmless on Vercel, which ignores it) and `devIndicators: false`.

> **Note:** No docker-compose file, Kubernetes manifest, or Terraform configuration exists anywhere in this repository. Whatever AWS/EC2 environment this image actually runs on (referenced by a past commit message, "add Docker support and AWS EC2") is provisioned and deployed manually, outside this repository's automation — this wiki cannot describe that environment's topology because it isn't defined in code here.

## Vercel path (the one with live CI)

See [`deployment.md`](deployment.md) for the full workflow. In short: `.github/workflows/deploy.yml` runs `vercel deploy --prod` on every push to `main`, using project-scoped `VERCEL_TOKEN`/`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` secrets — no Docker image is involved in this path at all.

## Tooling/config files

| File | Purpose |
|---|---|
| `next.config.ts` | `output: "standalone"`, `devIndicators: false` |
| `tsconfig.json` | Next 16 standard config, `target: ES2017`, `strict: true`, `moduleResolution: "bundler"`, path alias `@/*` |
| `eslint.config.mjs` | Flat config, `eslint-config-next` (`core-web-vitals` + `typescript`), re-declares default ignores |
| `postcss.config.mjs` | Single plugin: `@tailwindcss/postcss` |

## Source files

`Dockerfile`, `.dockerignore`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`.
