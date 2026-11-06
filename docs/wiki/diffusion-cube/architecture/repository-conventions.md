# Repository Conventions

*Re-verified 2026-11-06 against HEAD `0a1ca00`.*

## Naming and history

Several features carry **multiple historical names simultaneously** in live code and comments — a real, verified pattern worth knowing before searching for something by name:

- The Explorer flow has been called, in order: "Explore" → "Strengthen" → "Navigate" → "Analyse." `proxy.ts`'s own comments and `app/analyse/StrengthenWorkspace.tsx`'s filename still say "Strengthen"; `app/navigate/page.tsx` is a pure redirect stub kept alive only so old bookmarks resolve. When grepping for this flow, search all four terms.
- `designs` is the database table name for what the UI calls an "adoption" or "conversation" — a legacy name from before the multi-role rework, kept because renaming a live table is higher-risk than living with the mismatch.
- `cube_state` was renamed to `grid_state` in migration `0008`; `CoverageGrid`/`DimensionChips` (chip-based grid UI) were replaced by `HeatmapGrid` (a literal table) — the visual UI has swung back and forth on chips-vs-table across the project's history, and the current state is table (see [`architecture-overview.md`](architecture-overview.md#reconciliation-with-raw-architecture-documents)).
- "Wiki" survives in module and route names after the thing it named moved: `lib/wiki-loader.ts` now loads only the framework, generation prompt and resources; `lib/wiki-content.ts`, `/wiki` pages and `/api/wiki-pathways` / `/api/wiki-stats` all read published pathways from the database via `lib/pathway-store.ts`. There is no `content/wiki/` folder any more.
- "Assemble" (`app/api/pathways/assemble`) is the route behind the UI's **Send for Review** button; it no longer assembles a commit — it saves a `pathway_versions` row.
- `published_pathways` is still the name readers query, but since migration `0042` it is a **view** over `pathways` + `pathway_versions`, not a table. Never insert into it.

## File organization

- One `route.ts` per API endpoint under `app/api/**/`, named by resource/action folder path (e.g. `app/api/pathways/[id]/join/route.ts`, `app/api/admin/pathways/document/route.ts`), not by HTTP verb.
- `lib/` is flat (no subfolders except `lib/supabase/` with `admin.ts`/`client.ts`/`server.ts`) — 41 files, each owning one concern (prompts, retrieval, embeddings, the pathway store, unit parsing, roles, rate limiting, email, logging, PDF export, markdown parsing). Pure helpers are split from I/O where a script or test needs them alone — e.g. `lib/seed.ts` (no I/O) vs `scripts/seed-pathways.ts`, `lib/toolkit-assets.ts` vs `lib/toolkit-assets-server.ts`, `lib/contributor-registration.ts` vs `-server.ts`.
- `components/` is also flat, one file per component, PascalCase filenames matching the exported component name (37 files).
- Server components (data-loading pages) and their client-side interactive counterpart are split into two files in the same folder, e.g. `app/analyse/page.tsx` (server) + `app/analyse/StrengthenWorkspace.tsx` (client); `app/contribute/page.tsx` + `ContributeAccessGate.tsx` + `ContributeGrid.tsx` follows the same split.
- `content/` holds only the app's own operating text: `framework.md`, `pathway-generation-prompt.md`, `resources.md`, and `legal/{terms,privacy}.md`. Pathway documents are not committed to the repo.

### `tests/`

All tests live outside the source tree in `tests/`, mirroring what they cover rather than sitting next to it: `unit/lib` (pure modules), `unit/server` (server modules with mocked I/O), `api/<route path>`, `client` (the conversation hook), `features/<feature>` (components), `pages/{server,client}`, `proxy`, `db` (migration text checks), and shared fakes in `helpers/`. Files are named `<module-or-component>.test.ts(x)`; component tests start with `// @vitest-environment jsdom`. Coverage output goes to `tests/coverage/` (git-ignored). See [`testing.md`](testing.md).

### `scripts/`

| File | Purpose | How it runs |
|---|---|---|
| `seed-pathways.ts` | One-time seed of published pathways from a document manifest (per Supabase project, after migration `0042` and the `embed` function are deployed) | `npm run seed:pathways -- --manifest <file> [--dry-run] [--only a,b] [--regenerate]` |
| `vite-node.config.mts` | Gives scripts the same `@/` alias as the app and tests | used by the `seed:pathways` npm script |
| `seed-manifest.example.json` | Manifest shape: slug, title, sector, organisation, files with optional `"public": true` | copy and edit; paths are relative to the manifest |
| `smtp-test.mjs` | SMTP connectivity/send diagnostic | `node --env-file=.env.local scripts/smtp-test.mjs <to>` |

The seed script caches each generated document in `.seed-cache/<slug>.md` next to the manifest. `vite-node` is not a direct devDependency — it arrives transitively with `vitest` 3.

### `supabase/`

- `supabase/migrations/` — numbered SQL migrations (see below).
- `supabase/functions/embed/index.ts` — a **Deno** Edge Function (gte-small text → 384-dim vectors, service-role callers only). It is excluded from `tsconfig.json` and ESLint, and is deployed separately per project with `supabase functions deploy embed --project-ref <ref>` — never with `--no-verify-jwt`.

### `docs/`

`docs/wiki/` (this wiki), `docs/raw_documents/` (framework spec, product charter), `docs/features/<feature-slug>/` (per-feature business clarifications, requirement, architecture clarifications, plan, task list and sometimes a test set — currently `pathway-storage`, `toolkit-asset-files`, `monitoring-logging-cleanup`), and `docs/audits/<date>/` (audit summary, code-review and QA reports). Code comments cite these by path and by task ID (e.g. "docs/features/pathway-storage/, PS-07").

### Environment

`.env.example` at the repo root lists the variables the app reads (see [`configuration.md`](configuration.md)). Real values live in `.env.local`, which tests never load.

## Comment style

No `TODO`/`FIXME`/`HACK`/`XXX` markers exist anywhere in `app/`, `lib/`, or `components/` (verified by repo-wide grep — zero matches). The team's documentation style is instead long prose comments explaining **why** a non-obvious decision was made, placed at the point of the decision — e.g. the Dockerfile's header comment explains the AWS/ARM64 targeting rationale; `lib/embeddings.ts` records the measured batch-size limit ("8 fail with 546 WORKER_RESOURCE_LIMIT"); migration `0042` warns "Do not 'fix' it" about its intentionally non-`security_invoker` view. The one exception in tone is a comment in `app/api/chat/route.ts` marked `TEMPORARY dev-only diagnostic … Remove after testing` (it logs the contributor `<grid_update>` outside production). New comments should follow the same pattern: explain a hidden constraint or non-obvious trade-off, not restate what the code does.

## Migration conventions

Migrations in `supabase/migrations/` are numbered sequentially, `0001` through `0042` (42 files). Each states its purpose in a leading SQL comment. Most are additive; the destructive exceptions are documented in their own headers:

- `0008_grid_revamp.sql` — deletes pre-revamp test rows.
- `0018_drop_retired_tables.sql` — drops three superseded tables in FK-safe order.
- `0039_default_adopter_role.sql` — deletes `general_user` role rows and tightens the role check constraint (and backfills `adopter` for every account).
- `0042_pathway_storage.sql` — **drops the `published_pathways` table and all its rows** and recreates it as a view; existing pathways lose their published state (the library is rebuilt by the seed script).

(`0035` and `0037` contain `delete from` only inside retention clean-up functions.) A new migration should be numbered one higher than the current maximum, open with a purpose comment, and call out any destructive step in capitals as `0042` does. `tests/db/migrations.test.ts` checks migration text (sequential numbering, RLS enabled on every table, no client write grants on `user_roles`, `0042` being the latest migration and flagged destructive, search functions server-only), so a new migration that adds a table or function may need a matching assertion there.

## Duplication that is deliberate vs. duplication that is debt

- **Deliberate**: three independent markdown-subset parsers exist because their target renderers have genuinely different constraints (jsPDF can't mix bold runs in one `text()` call, `WikiMarkdown.tsx` needs pipe-table support the others don't) — see [`coding-patterns.md`](coding-patterns.md).
- **Resolved**: `parseFrontmatter` used to be duplicated inside `app/api/admin/pathways/publish/route.ts`; it now exists only in `lib/strip-frontmatter.ts`, used by `lib/pathway-store.ts`.
- **Debt, not deliberate**: the brand hex colors (`#1b1b42`, `#ff6543`, `#feda09`, `#0099ff`) are defined once as CSS custom properties in `app/globals.css` but also hardcoded literally in `lib/dimensions.ts`, `lib/email.ts`, `lib/adoption-plan-pdf.ts` and `app/explore/ExploreLibrary.tsx` — necessary duplication for `lib/email.ts` (inline HTML, outside Tailwind) and `lib/adoption-plan-pdf.ts` (outside the browser rendering pipeline), but avoidable in the React component. The model ID `claude-sonnet-4-6` is a string literal repeated across `app/api/chat/route.ts`, `app/api/pathways/check-similar/route.ts` and `scripts/seed-pathways.ts` (only the classifier has a named constant, `CLASSIFIER_MODEL`). See [`knowledge/technical-debt.md`](../knowledge/technical-debt.md).

## Undocumented-area convention (this wiki's own convention)

When a topic in this generated wiki has no evidence in the repository, it is marked with a plain-language `> **Note:**` callout rather than left blank or marked with an internal-only "not found" label — applied consistently across every page in this wiki.

## Skill/tooling artifacts

`.claude/skills/` and `.claude/agents/` exist in this repository (AI-agent tooling configuration) and are excluded from normal application review — they are not part of the deployed service.
