# API Specification

No OpenAPI/Swagger/GraphQL schema exists in this repository — this table is hand-traced from every `route.ts` file under `app/api/`. Only working, callable endpoints are listed; the three routes that reference a dropped database table are documented separately in [`../knowledge/technical-debt.md#td-01`](../knowledge/technical-debt.md#td-01), not here, since they would error (relation does not exist) if invoked.

## Chat (the core AI surface)

| Method | Path | Handler | Auth | Purpose |
|---|---|---|---|---|
| POST | `/api/chat` | `app/api/chat/route.ts` | `mode==='library'`: none. All other modes: `hasAnyRole`, plus `flow`-specific role re-check for `companion` | Streams from `claude-sonnet-4-6`. Body: `{messages, mode, grid?, meta?, versionNumber?, designId?, flow?, existingPublishedDoc?, pathwayId?}`. Modes: `companion`, `library`, `extract-insights`, `analysis-doc`, `executive-summary`, `plan-document`, `pathway-draft`, `pathway-exec-summary` |

## Pathways (contributor workspace + public listing)

| Method | Path | Handler | Auth | Purpose |
|---|---|---|---|---|
| GET | `/api/pathways` | `app/api/pathways/route.ts` | any approved role | List pathways with per-pathway "already joined" flag and contributing-org names |
| POST | `/api/pathways` | `app/api/pathways/route.ts` | `pathway_contributor` | Create a pathway (`{title, sector, description}`), slug uniqued against collisions |
| POST | `/api/pathways/[id]/join` | `app/api/pathways/[id]/join/route.ts` | `pathway_contributor` | Join a pathway (idempotent no-op if already joined); resolves/creates the caller's org |
| POST | `/api/pathways/assemble` | `app/api/pathways/assemble/route.ts` | `hasAnyRole` + `pathway_contributor` + pathway membership | Contributor publish: commits latest draft to GitHub, sets `content_cache`/`review_requested` |
| POST | `/api/pathways/check-similar` | `app/api/pathways/check-similar/route.ts` | `pathway_contributor` | Forced-tool-use LLM call checking a candidate title/sector/description against existing pathways |

## Wiki (public/browse)

| Method | Path | Handler | Auth | Purpose |
|---|---|---|---|---|
| GET | `/api/wiki-pathways` | `app/api/wiki-pathways/route.ts` | none (fully public) | Pathway metadata list for `/explore` cards and chat source-attribution chips |
| GET | `/api/wiki-stats` | `app/api/wiki-stats/route.ts` | `hasAnyRole` | `{total, sectors[]}` — used by the companion's opening line |

## Organisations

| Method | Path | Handler | Auth | Purpose |
|---|---|---|---|---|
| GET | `/api/organisations` | `app/api/organisations/route.ts` | `hasAnyRole` | Autocomplete search (`?q=`) for the contributor-signup organisation field |

## Auth

| Method | Path | Handler | Auth | Purpose |
|---|---|---|---|---|
| POST | `/api/auth/grant-default-role` | `app/api/auth/grant-default-role/route.ts` | any session | Grants `adopter` immediately post-signup (idempotent) |
| POST | `/api/auth/send-email` | `app/api/auth/send-email/route.ts` | Standard Webhooks HMAC signature (`SEND_EMAIL_HOOK_SECRET`), no session | Supabase Send Email Auth Hook target — dispatches signup/recovery/reauthentication/invite/magiclink emails via SMTP. `email_change` explicitly rejected (400) |

## Admin

| Method | Path | Handler | Auth | Purpose |
|---|---|---|---|---|
| POST | `/api/admin/roles` | `app/api/admin/roles/route.ts` | admin | `{user_id, role, action:'add'|'remove'}` — raw insert/delete, not upsert (duplicate add errors) |
| POST | `/api/admin/reject` | `app/api/admin/reject/route.ts` | admin | Deletes the user account outright (`admin.auth.admin.deleteUser`) |
| POST | `/api/admin/contributor-registrations/approve` | `.../approve/route.ts` | admin | Sets `access_status='approved'`, backfills `org_id`, upserts the `pathway_contributor` role |
| POST | `/api/admin/contributor-registrations/reject` | `.../reject/route.ts` | admin | Sets `access_status='rejected'` |
| POST | `/api/admin/pathways/publish` | `app/api/admin/pathways/publish/route.ts` | admin | Reads `pathways.content_cache`, upserts into `published_pathways` (on `slug`), clears `review_requested`, sets `published_design_doc_id` |
| POST | `/api/admin/pathways/delete` | `app/api/admin/pathways/delete/route.ts` | admin | Deletes a `pathways` row; relies on FK cascade/set-null for dependents |

## Response conventions

- All `/api/chat` modes except `library` require an approved account (`hasAnyRole`); an unapproved account gets a 403.
- Streamed modes return raw `text/plain` (the model's streamed text, including the trailing `<grid_update>` block — stripped client-side, never server-side).
- `check-similar` is the one non-streaming Anthropic call in the app; it returns JSON (`{matchId: string | null}`).
- Max tokens per mode: 8192 `companion`, 1024 `library`/`extract-insights`, 9000 `pathway-draft`, 4096 everything else.

## Source files

Every `app/api/**/route.ts` file (list in [`../repository-map.md`](../repository-map.md)).
