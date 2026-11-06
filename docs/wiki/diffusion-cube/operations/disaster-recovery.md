# Disaster Recovery

> **Note:** No disaster-recovery runbook, backup schedule, or restore procedure is documented in this repository. Database backups, point-in-time recovery, and multi-region failover for Postgres are managed through the Supabase project's own dashboard/plan tier, outside this codebase. Deployment rollback is managed through whichever platform is serving traffic (Vercel's deployment history, or manual redeploy for the Docker/AWS path) rather than anything defined here.

## The big change: pathway content is no longer in Git

Until migration `0042`, the curated pathways were Markdown files committed to this repository (`content/wiki/pathways/`) and contributor pathways were committed to GitHub on assemble — so Git history was a free, independent backup of the corpus. **That is no longer true.** `content/wiki/` is gone, `lib/github.ts` is gone, and every pathway — seeded or contributed — now exists **only in the Supabase project**:

| What | Where it lives now | Other copy? |
|---|---|---|
| Every version of every pathway document | `pathway_versions` rows | None in Git. Contributor drafts also exist as `design_documents` rows (their source workspace) |
| Which version is live, status, card fields | `pathways` (`status`, `published_version_id`, `stage`, `tags`, …) | None |
| Searchable micro-innovation units + vectors | `pathway_units` | **Derived** — rebuilt from the published version by re-publishing it (`publishVersion` re-parses and re-embeds) |
| Seeded pathways' original documents (PDF, DOCX, XLSX, PPTX …) | private **`pathway-sources`** Storage bucket + their extracted text in `pathway_sources` | Whatever folder the seed operator kept the manifest and files in — **not in this repository** |
| Passages cut from those originals, with vectors | `pathway_source_chunks` | **Derived** — rebuilt by re-running the seed for that slug |
| Contributor toolkit assets (uploaded files) | **`toolkit-assets`** Storage bucket + `contribution_units` rows | None |
| `published_pathways` | A **view** over `pathways` + `pathway_versions` since `0042` — holds no data of its own | n/a |

> **Note:** Supabase's database backups (and PITR, on plans that include it) cover Postgres tables. Whether they also cover **Storage bucket objects** depends on the Supabase plan and should be confirmed in the dashboard — if they don't, the `pathway-sources` and `toolkit-assets` buckets have **no backup at all** from anything in this repository. That information lives in the Supabase dashboard, not in code.

## What can be reasoned about from the code

- **The seed is the rebuild path for the curated library — but only if its inputs are kept.** `npm run seed:pathways` rebuilds seeded pathways (rows, sources, passages, a new published version) from a manifest + files. Those inputs live outside the repo. The generated documents are also cached at `<manifest folder>/.seed-cache/<slug>.md`; re-using that cache avoids paying Claude to regenerate (and avoids getting a slightly different document). Keep the manifest folder, files and `.seed-cache/` somewhere durable.
- **Contributor pathways have no rebuild path other than a database backup.** Their published versions exist only in `pathway_versions` (and the originating `design_documents` draft).
- **Migration `0042` itself destroyed data** — it dropped the old `published_pathways` table and every row in it (business decision Q21). Any project where `0042` has run can only recover pre-`0042` community rows from a Supabase backup taken before it ran. Take a backup before running `0042` on any further project.
- **Deleting a pathway is permanent.** `POST /api/admin/pathways/delete` cascades `pathway_versions`, `pathway_units`, `pathway_sources`, `pathway_source_chunks`, `pathway_contributors` and `contribution_units`, and removes the pathway's files from both buckets first. There is no soft delete or trash (the `retired` status exists in the schema but no code sets it — see [`../knowledge/technical-debt.md#td-22`](../knowledge/technical-debt.md#td-22)).
- **Derived data can be regenerated:** missing or null unit vectors are restored by re-publishing the pathway; missing passage vectors by re-running the seed for that slug. Both need the `embed` Edge Function to be deployed and healthy (see [`troubleshooting.md`](troubleshooting.md#search--retrieval)).
- **App-side content that is still in Git:** `content/framework.md`, `content/pathway-generation-prompt.md`, `content/resources.md` and `content/legal/` — plus all code, migrations and the `embed` function source. A whole Supabase project can be re-created from `supabase/migrations/` + `supabase functions deploy embed` + the seed, but that yields an **empty-of-contributions** library.
- **`design_documents`, `designs`, `pathways`, `pathway_contributors`, `organisations`, `contributor_registrations`, `library_conversations`, `user_roles`, `sys_errors`, `ai_usage`** all exist only in Supabase — no export/backup tooling for these is present in this repository.

## Rollback

- **Code:** revert and redeploy (Vercel deployment history, or rebuild the Docker image from an earlier commit). There is no feature flag for the pathway-storage change — the plan deliberately dropped a legacy switch (`plan_pathway_storage.md` → "no legacy switch").
- **Schema:** migrations are forward-only SQL files with no down-migrations. Rolling back past `0042` means restoring a database backup, not running a script.

## Recommended (not yet implemented)

- Document the actual Supabase backup/PITR configuration in use (plan tier, retention window, and whether Storage is included) alongside this page, once known.
- A periodic export of `pathways` + `pathway_versions` (published versions at least) to a durable location would restore the Git-like recoverability the corpus lost in `0042` — no such job exists today.
- Keep the seed manifest folder (sources + `.seed-cache/`) under version control or durable storage of its own.
- A documented rollback procedure for each deploy path (Vercel deployment pinning vs. re-running the Docker build from a tagged commit) would close the gap noted above.

## Source files

`supabase/migrations/0034_contribution_units_toolkit_assets.sql`, `supabase/migrations/0042_pathway_storage.sql`, `lib/pathway-store.ts`, `app/api/admin/pathways/delete/route.ts`, `scripts/seed-pathways.ts`, `lib/seed.ts`, `docs/features/pathway-storage/plan_pathway_storage.md`.
