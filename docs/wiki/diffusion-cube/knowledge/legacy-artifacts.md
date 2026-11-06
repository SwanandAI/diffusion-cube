# Legacy Artifacts

Code and schema that is documented but intentionally not yet removed — distinct from [`technical-debt.md`](technical-debt.md)'s actionable register; this page is the inventory of what exists and why it's still there. Re-verified against code on 2026-11-06.

## Removed since the last refresh (for anyone following old links)

| Removed | Was | Replaced by |
|---|---|---|
| `lib/github.ts` | GitHub Contents API client — assemble committed pathway Markdown to `GITHUB_REPO`/`GITHUB_BRANCH` | `lib/pathway-store.ts` (`saveVersion` / `publishVersion`) writing `pathway_versions` in Supabase; `GITHUB_*` env vars no longer read |
| `lib/library-documents.ts`, `lib/library-pathways.ts` | Read/listed pathway files for the Explore library | `lib/pathway-store.ts` (`listPublished`, `getPublishedDocument(s)`, `buildOverview`); shared types in `lib/library-types.ts` |
| `content/wiki/` (all pathway Markdown, `index.md`) | The committed grounding corpus | Database rows, seeded with `npm run seed:pathways` — see [`../operations/deployment.md`](../operations/deployment.md#supabase-project-setup-per-environment) |
| `loadWikiContext` and the `WIKI_PATH` env var | Loaded the whole corpus into every prompt | Per-message retrieval (`lib/retrieval.ts`); `lib/wiki-loader.ts` now loads only `framework.md`, `pathway-generation-prompt.md`, `resources.md` |
| `app/api/auth/grant-default-role/route.ts` | Client call after signup to grant `adopter` | Database trigger from migration `0039` |
| `app/api/admin/reject/route.ts` | Admin rejection of a pending signup | Nothing — there is no pending state since `0039` |
| `published_pathways` **table** | Copy of each published pathway | A **view** of the same name over `pathways` + `pathway_versions` (migration `0042`) |
| `content/library-wiki/`, the `pathway-submissions` routes, `PathwaySubmissionsPanel` | Earlier removals | See [`technical-debt.md#td-02`](technical-debt.md#td-02), [`#td-01`](technical-debt.md#td-01) |

## Dead route stub

**`app/navigate/page.tsx`** — a pure `redirect('/analyse')` stub. Kept public in `proxy.ts` specifically so old bookmarks to the pre-rename "Navigate" route (an earlier name for the current "Analyse"/Explorer flow) still resolve without hitting the login wall first. Safe to remove only once confidence is high that no external link to `/navigate` remains in circulation.

## Route with no in-app caller

**`app/api/wiki-stats/route.ts`** (+ `getWikiStats` in `lib/wiki-content.ts`) — returns the published-pathway count and sectors; its comment says it backs the "Explore the Pathways Library" intent's opening line, but nothing in `app/`, `components/` or `lib/` fetches it any more. It is still a working, role-gated endpoint, so it may have an external consumer; confirm before removing.

## Dormant email senders

**`lib/email.ts`**'s `sendAdminApprovalEmail` / `sendUserApprovedEmail` — exported, self-documented in their own comments as dormant, no live caller. Left over from the pre-role-split admin-approval flow. With migration `0039` (every account is an adopter at signup) there is no approval step for them to serve. The rest of `lib/email.ts` (signup/reset/reauthentication codes, invite/magiclink, contributor notifications) is live.

## "Awaiting approval" remnants

Since `0039` no account is created without a role, but three places still handle the zero-role case, which can now only arise if an admin removes a user's last role (or `0039` was never applied):

- `app/(app)/layout.tsx` — renders an "Awaiting approval" screen with `components/SiteHeader.tsx`.
- `app/api/chat/route.ts`, `app/api/wiki-stats/route.ts`, `app/api/pathways/assemble/route.ts` — 403 with "Your account doesn't have access yet. Please contact an administrator." (chat also answers "Please sign in to continue." to a non-library call with no session). The API wording was updated on 2026-11-06.

These are defensive rather than dead. Only the page screen's "Awaiting approval" heading still carries the legacy wording.

## Inert database tables

`pathway_cache`, `wiki_cache`, `pending_signups` — see [`../application/database.md`](../application/database.md) for what each was originally for. None are read or written by any current code path (only a stale comment in `lib/supabase/admin.ts` still mentions `pending_signups`); RLS remains configured on them. The 2026-10-22 audit noted `wiki_cache` and `pathway_cache` are still writable by signed-in users ([`technical-debt.md#td-25`](technical-debt.md#td-25) group). Candidates for a future drop migration.

## Transitional `pathways` columns

Assemble still writes `pathways.content_cache`, `review_requested` and `assembled_design_doc_id`, and publish sets `published_design_doc_id`, alongside the new `pathway_versions` / `status` / `published_version_id` model from `0042`. `content_cache` is still read (the admin document route's fallback, toolkit-asset block rewriting in `lib/toolkit-assets-server.ts`) and `review_requested` drives the admin "awaiting review" badge, so they are live — but they duplicate state the versions table now holds. Worth consolidating once the new model has settled.

## Superseded UI naming

`components/SiteHeader.tsx` — the pre-`AppShell` header, with a hard link to `https://100pathways.com/`. Still used in two places: the zero-role "Awaiting approval" screen in `app/(app)/layout.tsx`, and `components/LegalDocument.tsx` (the `/terms` and `/privacy` pages). Everywhere else, `AppShell.tsx` (Sidebar-based) has replaced it. Not slated for removal since it is in active use.

## Historical route/flow names still visible in code and comments

The Explorer flow has been renamed four times across this project's history — Explore → Strengthen → Navigate → Analyse — and traces remain live simultaneously: `proxy.ts`'s comments, `app/analyse/StrengthenWorkspace.tsx`'s filename, and the `/navigate` stub above. Likewise "wiki" survives in names for things that are no longer files: `lib/wiki-loader.ts`, `lib/wiki-content.ts`, `/wiki` pages and `/api/wiki-pathways` all now read the database or app content. Documented for search-ability (see [`../architecture/repository-conventions.md`](../architecture/repository-conventions.md)), not flagged as needing cleanup on its own.

## Unused schema value

`pathways.status = 'retired'` is allowed by migration `0042`'s check constraint but no code sets it — see [`technical-debt.md#td-22`](technical-debt.md#td-22).

## No longer legacy

`contribution_units` (migrations `0022`/`0025`) was listed here as POC schema never wired up. Since migration `0034` it stores contributor toolkit assets and is read and written by live code — see [`technical-debt.md#td-04`](technical-debt.md#td-04).

## Source files

`app/navigate/page.tsx`, `app/api/wiki-stats/route.ts`, `lib/wiki-content.ts`, `lib/wiki-loader.ts`, `lib/email.ts`, `app/(app)/layout.tsx`, `components/SiteHeader.tsx`, `components/LegalDocument.tsx`, `lib/supabase/admin.ts`, `app/api/pathways/assemble/route.ts`, `app/api/admin/pathways/document/route.ts`, `lib/toolkit-assets-server.ts`, `supabase/migrations/0002_pathway_cache.sql`, `0004_wiki_cache.sql`, `0005_pending_signups.sql`, `0034_contribution_units_toolkit_assets.sql`, `0039_default_adopter_role.sql`, `0042_pathway_storage.sql`.
