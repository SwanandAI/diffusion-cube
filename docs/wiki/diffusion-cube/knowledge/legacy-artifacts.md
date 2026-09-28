# Legacy Artifacts

Code and schema that is documented but intentionally not yet removed — distinct from [`technical-debt.md`](technical-debt.md)'s actionable register; this page is the inventory of what exists and why it's still there.

## Dead route stub

**`app/navigate/page.tsx`** — a pure `redirect('/analyse')` stub. Kept public in `proxy.ts` specifically so old bookmarks to the pre-rename "Navigate" route (an earlier name for the current "Analyse"/Explorer flow) still resolve without hitting the login wall first. Safe to remove only once confidence is high that no external link to `/navigate` remains in circulation.

## Dormant email senders

**`lib/email.ts`**'s `sendAdminApprovalEmail` / `sendUserApprovedEmail` — exported, self-documented in their own comments as dormant, no live caller. Left over from the pre-role-split admin-approval flow described in `SIGNUP_APPROVAL_OPTIONS.md`'s "Option 1." The rest of `lib/email.ts` (signup/reset/reauthentication codes, invite/magiclink) is fully live.

## Inert database tables

`pathway_cache`, `wiki_cache`, `pending_signups` — see [`../application/database.md#inert-tables`](../application/database.md#inert-tables-created-never-readwritten-by-current-code) for what each was originally for. None are read or written by any current code path; RLS remains configured on them (permissive on the first two, zero-policy service-role-only on the third) but is moot since nothing queries them.

## Superseded UI naming

`components/SiteHeader.tsx` — the pre-`AppShell` header, with a hard link to `https://100pathways.com/`. Survives as the header for exactly one screen: the "awaiting approval" state in `app/(app)/layout.tsx`. Everywhere else, `AppShell.tsx` (Sidebar-based) has replaced it. Not slated for removal since it is still in active (if narrow) use.

## Historical route/flow names still visible in code and comments

The Explorer flow has been renamed four times across this project's history — Explore → Strengthen → Navigate → Analyse — and traces of at least three of those names remain live simultaneously: `proxy.ts`'s own comments, `app/analyse/StrengthenWorkspace.tsx`'s filename, and the `/navigate` stub above. This is documented for search-ability (see [`../architecture/repository-conventions.md`](../architecture/repository-conventions.md)), not flagged as something requiring cleanup on its own — renaming a component file is low-value churn relative to the risk of an unrelated merge conflict.

## POC-stage schema never wired up

`contribution_units` (migrations `0022`/`0025`) — see [`technical-debt.md#td-04`](technical-debt.md#td-04) for the full history. Kept here as a legacy artifact rather than immediately dropped, since its RLS design is sound and it may still represent a valid future direction (individually-tagged, retrievable corpus units) rather than purely abandoned work.

## Source files

`app/navigate/page.tsx`, `lib/email.ts`, `supabase/migrations/0002_pathway_cache.sql`, `0004_wiki_cache.sql`, `0005_pending_signups.sql`, `0022_contribution_units.sql`, `components/SiteHeader.tsx`.
