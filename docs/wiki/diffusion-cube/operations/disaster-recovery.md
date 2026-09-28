# Disaster Recovery

> **Note:** No disaster-recovery runbook, backup schedule, or restore procedure is documented in this repository. Database backups, point-in-time recovery, and multi-region failover for Postgres are managed through the Supabase project's own dashboard/plan tier, outside this codebase. Deployment rollback is managed through whichever platform is serving traffic (Vercel's deployment history, or manual redeploy for the Docker/AWS path) rather than anything defined here.

## What can be reasoned about from the code

- **Corpus content has a natural recovery path for the static half**: `content/wiki/pathways/` and `content/library-wiki/pathways/` are committed to this Git repository, so their history is recoverable via normal Git operations (`git log`, `git revert`) independent of any database state.
- **Contributor-assembled (but not yet admin-published) pathway content also lives in Git** — on the `GITHUB_REPO`/`GITHUB_BRANCH` configured in `lib/github.ts` — separately from whatever's committed to *this* repository's own `content/wiki/`. A pathway assembled against a different branch than the one this repo tracks would need an explicit merge/pull to reconcile.
- **`published_pathways` (the live public corpus) exists only in Supabase**, with no static-file mirror. Losing that table's data would remove all community-contributed pathways from `/explore` and from companion grounding, with no in-repo fallback — the original 7–12 curated pathways in `content/wiki/pathways/`/`content/library-wiki/pathways/` would remain unaffected, since they're file-backed.
- **`design_documents`, `designs`, `pathways`, `pathway_contributors`, `organisations`, `contributor_registrations` all exist only in Supabase** — no export/backup tooling for these is present in this repository.

## Recommended (not yet implemented)

- Document the actual Supabase backup/PITR configuration in use (plan tier, retention window) alongside this page, once known — that information lives in the Supabase dashboard, not in this repo.
- If `published_pathways` is considered critical, a periodic export-to-file job (mirroring it into `content/`) would give it the same Git-backed recoverability the static corpus already has — no such job exists today.
- A documented rollback procedure for each deploy path (Vercel deployment pinning vs. re-running the Docker build from a tagged commit) would close the gap noted above.

## Source files

`lib/github.ts`, `content/wiki/pathways/`, `content/library-wiki/pathways/`, `supabase/migrations/0012_published_pathways.sql`.
