# API Specification

No OpenAPI/Swagger/GraphQL schema exists in this repository — this table is hand-traced from every `route.ts` file under `app/api/`. Only working, callable endpoints are listed. The three dead routes that referenced a dropped table (`/api/pathway-submissions/push`, `/api/admin/pathway-submissions/review`, `/api/admin/pathway-submissions/publish`) were **deleted** (MLC-12) — signed out the proxy answers 401 for them; signed in they fall through to a 404 (not yet browser-verified). See [`../knowledge/technical-debt.md#td-01`](../knowledge/technical-debt.md#td-01).

> **Note:** the toolkit-asset routes (`/api/toolkit-assets/*`) and `/api/contributions/[designId]` exist in code but are not yet documented on this page.

## Chat (the core AI surface)

| Method | Path | Handler | Auth | Purpose |
|---|---|---|---|---|
| POST | `/api/chat` | `app/api/chat/route.ts` | `mode==='library'`: none, but **per-IP rate limit first (429), then input guard (400)**. All other modes: `hasAnyRole`, plus `flow`-specific role re-check for `companion` | Streams from `claude-sonnet-4-6` (`asset-reuse` is a short non-streamed call). Body: `{messages, mode, grid?, meta?, designId?, flow?, existingPublishedDoc?, pathwayId?}`. Modes (7): `companion`, `analysis-doc`, `executive-summary`, `extract-insights`, `pathway-draft`, `library`, `asset-reuse`. `plan-document` and `pathway-exec-summary` were removed (MLC-13) and now get 400 `Unknown mode.` |

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
| POST | `/api/account/delete` | `app/api/account/delete/route.ts` | any session + password re-check | Permanent self-serve account deletion (see `specs/ACCOUNT_DELETION_SPEC.md`) |
| POST | `/api/account/contact-sharing` | `app/api/account/contact-sharing/route.ts` | any session + own `contributor_registrations.access_status === 'approved'` | `{sharingLevel: 'none'\|'name'\|'name_and_email'}` → updates only `share_name`/`share_contact`/`contact_info` on the caller's own row, via the service-role client (the table has no user UPDATE policy, since one would also expose `access_status`) |
| POST | `/api/auth/grant-default-role` | `app/api/auth/grant-default-role/route.ts` | any session | Grants `adopter` immediately post-signup (idempotent) |
| POST | `/api/auth/send-email` | `app/api/auth/send-email/route.ts` | Standard Webhooks HMAC signature (`SEND_EMAIL_HOOK_SECRET`), no session | Supabase Send Email Auth Hook target — dispatches signup/recovery/reauthentication/invite/magiclink emails via SMTP. `email_change` explicitly rejected (400) |

## Errors

| Method | Path | Handler | Auth | Purpose |
|---|---|---|---|---|
| POST | `/api/errors/client` | `app/api/errors/client/route.ts` | none (public, in `proxy.ts` `PUBLIC_PATHS`) | Browser error intake from `app/error.tsx`/`app/global-error.tsx` (via `lib/client-error-report.ts`). Order: per-IP rate limit (`client-error` scope) → 429; body > 16 KB or bad JSON → 400; else a `sys_errors` row `source = client:<path>` (query stripped, non-path → `/`), session user attached → 204. Reads only `message`, `stack`, `path` |

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

- **Every route handler is wrapped by `withErrorHandling(source, handler)`** (`lib/errors.ts`; handlers are named `handle<METHOD>` and exported as `export const POST = withErrorHandling('api/<path>', handlePOST)`). A returned 4xx passes through untouched (recorded as `expected` in `sys_errors`, except 429s, which are not recorded); a returned **5xx has its body replaced with the generic message** `System encountered an error. Please try sometime later.` (the real text goes to `sys_errors`); a thrown `ExpectedError` (`ValidationError` 400, `AuthError` 401/403, `NotFoundError` 404) becomes its own status + message; anything else thrown → 500 + generic message, stack recorded. `/api/auth/send-email` passes `errorBody: hookError` so Supabase Auth still gets `{error: {http_code, message}}`.
- Streamed 200 responses pass through the wrapper untouched. A failure **mid-stream** in `/api/chat` is caught inside the stream (`streamFailed()`): it is recorded in `sys_errors` and as an `ok:false` `ai_usage` row, then `controller.error()` makes the client's reader reject, so the client shows the partial text plus the generic message and does not save the broken reply.
- `library` mode rejections: 429 `{"error":"Too many requests. Please try again later."}` (default 20/min, 200/day per IP; fails open if the limiter itself errors), then 400 `{"error":"Invalid request."}` when `messages` isn't an array, has a non-`user`/`assistant` role or non-string content, exceeds 20 messages, has a visitor message over 1,000 chars or a total over 20,000 chars (defaults; env-overridable — see `architecture/configuration.md`), or doesn't end with the visitor's message (`lib/explore-guard.ts`). An empty history (the kickoff) passes. Both checks run before any DB read or Claude call.
- All `/api/chat` modes except `library` require an approved account (`hasAnyRole`); an unapproved account gets a 403.
- Streamed modes return raw `text/plain` (the model's streamed text, including the trailing `<grid_update>` block — stripped client-side, never server-side).
- `check-similar` and `/api/chat`'s `asset-reuse` (max 400 tokens, plain text) are the non-streaming Anthropic calls; `check-similar` returns JSON (`{matchId: string | null}`).
- Max tokens per mode: 8192 `companion`, 1024 `library`/`extract-insights`, 9000 `pathway-draft`, 400 `asset-reuse`, 4096 everything else (`analysis-doc`, `executive-summary`).

## Source files

Every `app/api/**/route.ts` file (list in [`../repository-map.md`](../repository-map.md)).
