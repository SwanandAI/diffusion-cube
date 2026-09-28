# Repository Conventions

## Naming and history

Several features carry **multiple historical names simultaneously** in live code and comments — a real, verified pattern worth knowing before searching for something by name:

- The Explorer flow has been called, in order: "Explore" → "Strengthen" → "Navigate" → "Analyse." `proxy.ts`'s own comments and `app/analyse/StrengthenWorkspace.tsx`'s filename still say "Strengthen"; `app/navigate/page.tsx` is a pure redirect stub kept alive only so old bookmarks resolve. When grepping for this flow, search all four terms.
- `designs` is the database table name for what the UI calls an "adoption" or "conversation" — a legacy name from before the multi-role rework, kept because renaming a live table is higher-risk than living with the mismatch.
- `cube_state` was renamed to `grid_state` in migration `0008`; `CoverageGrid`/`DimensionChips` (chip-based grid UI) were replaced by `HeatmapGrid` (a literal table) — the visual UI has swung back and forth on chips-vs-table across the project's history, and the current state is table (see [`architecture-overview.md`](architecture-overview.md#reconciliation)).

## File organization

- One `route.ts` per API endpoint under `app/api/**/`, named by resource/action folder path (e.g. `app/api/pathways/[id]/join/route.ts`), not by HTTP verb.
- `lib/` is flat (no subfolders except `lib/supabase/`) — 24 files, each owning one concern (prompts, one corpus loader per corpus, roles, email, logging, PDF export, markdown parsing).
- `components/` is also flat, one file per component, PascalCase filenames matching the exported component name.
- Server components (data-loading pages) and their client-side interactive counterpart are split into two files in the same folder, e.g. `app/analyse/page.tsx` (server) + `app/analyse/StrengthenWorkspace.tsx` (client); `app/contribute/page.tsx` + `ContributeAccessGate.tsx` + `ContributeGrid.tsx` follows the same split.

## Comment style

No `TODO`/`FIXME`/`HACK`/`XXX` markers exist anywhere in `app/`, `lib/`, or `components/` (verified by repo-wide grep — zero matches). The team's documentation style is instead long prose comments explaining **why** a non-obvious decision was made, placed at the point of the decision — e.g. the Dockerfile's header comment explains the AWS/ARM64 targeting rationale, and `lib/pathway-submission-versions.ts` carries a comment acknowledging a pre-existing bug in a check constraint that was never fixed (moot now, since the table backing it was later dropped). New comments in this codebase should follow the same pattern: explain a hidden constraint or non-obvious trade-off, not restate what the code does.

## Migration conventions

Migrations in `supabase/migrations/` are numbered sequentially (`0001` through `0032`), always additive except for two documented exceptions: `0008_grid_revamp.sql` (deletes pre-revamp test rows) and `0018_drop_retired_tables.sql` (drops three superseded tables in FK-safe order). A new migration should be numbered one higher than the current maximum and should state its purpose in a leading SQL comment, matching every existing migration's style.

## Duplication that is deliberate vs. duplication that is debt

- **Deliberate**: three independent markdown-subset parsers exist because their target renderers have genuinely different constraints (jsPDF can't mix bold runs in one `text()` call, `WikiMarkdown.tsx` needs pipe-table support the others don't) — see [`coding-patterns.md`](coding-patterns.md).
- **Debt, not deliberate**: `parseFrontmatter` is implemented twice — once in `lib/strip-frontmatter.ts` (the shared version) and once, near-identically, as a private function inside `app/api/admin/pathways/publish/route.ts`. The brand hex colors (`#1b1b42`, `#ff6543`, `#feda09`, `#0099ff`) are defined once as CSS custom properties in `app/globals.css` but also hardcoded literally in `lib/dimensions.ts`, `lib/email.ts`, `lib/adoption-plan-pdf.ts`, `components/AdoptionPlanModal.tsx`, and `app/explore/ExploreLibrary.tsx` — necessary duplication for `lib/email.ts` (inline HTML, outside Tailwind) and `lib/adoption-plan-pdf.ts` (outside the browser rendering pipeline), but avoidable in the two ordinary React components. See [`knowledge/technical-debt.md`](../knowledge/technical-debt.md).

## Undocumented-area convention (this wiki's own convention)

When a topic in this generated wiki has no evidence in the repository, it is marked with a plain-language `> **Note:**` callout rather than left blank or marked with an internal-only "not found" label — applied consistently across every page in this wiki.

## Skill/tooling artifacts

`.claude/skills/` and `.claude/agents/` exist in this repository (AI-agent tooling configuration) and are excluded from normal application review — they are not part of the deployed service.
