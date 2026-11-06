# API Specification

> Last verified against code: 2026-11-06 (HEAD `0a1ca00`). 23 `route.ts` files under `app/api/`.

No OpenAPI/Swagger/GraphQL schema exists in this repository. This table is traced by hand from every `route.ts` file under `app/api/`, and lists only working endpoints you can call. Removed routes, for the record:

- **`/api/auth/grant-default-role`**: deleted. Since migration `0039`, a database trigger grants every new account the `adopter` role when the account is created.
- **`/api/admin/reject`**: deleted. There is no pending-signup state left to reject.
- **The three `pathway-submissions` routes**: deleted earlier (MLC-12). See [`../knowledge/technical-debt.md#td-01`](../knowledge/technical-debt.md#td-01).

A signed-out call to a removed path gets 401 from `proxy.ts`. A signed-in call gets 404.

## Chat (the core AI surface)

| Method | Path | Handler | Auth | Purpose |
|---|---|---|---|---|
| POST | `/api/chat` | `app/api/chat/route.ts` | Public at the proxy (in `PUBLIC_PATHS`). `library` needs no session. Every other mode needs a session holding the role that `requiredRole(mode, flow)` picks: `pathway_contributor` for `pathway-draft`, `asset-reuse`, and `companion`/`extract-insights` with `flow==='contributor'`; `adopter` for everything else | Streams from `claude-sonnet-4-6` (`asset-reuse` is a short non-streamed call). Grounding comes from per-message retrieval over the pathway store (`lib/retrieval.ts`, which runs its own `claude-haiku-5-5` classifier call). The whole corpus is no longer sent. Body: `{messages, mode, grid?, meta?, designId?, flow?, existingPublishedDoc?, pathwayId?}`. Modes (7): `companion`, `analysis-doc`, `executive-summary`, `extract-insights`, `pathway-draft`, `library`, `asset-reuse`. Any other mode gets 400 `Unknown mode.` |

### `/api/chat` check order

1. **Rate limit (429).** Runs before the body is parsed. A signed-in caller is counted per account (`chat-user` scope: `CHAT_USER_RATE_LIMIT_PER_MIN`/`_PER_DAY`, default 30/300). An anonymous caller is counted per IP (`explore` scope: `EXPLORE_RATE_LIMIT_*`, default 20/200). The limiter fails open: if the check itself errors, the request is allowed.
2. **Body size (413).** A raw body over 32 MiB gets `This request is too large.`
3. **JSON shape (400).** A body that is not a JSON object gets `Invalid request.`
4. **Mode (400).** Unknown mode gets `Unknown mode.`
5. **`library` input guard (400).** `lib/explore-guard.ts`. The check fails with 400 `Invalid request.` when:
   - `messages` is not an array, or has a role other than `user`/`assistant`, or has non-string content.
   - There are more than 20 messages.
   - A visitor message is over 1,000 chars, or the total is over 20,000 chars.
   - The conversation does not end with the visitor's message.

   These are defaults, which env vars can override. An empty history (the kickoff) passes.
6. **Roles (403), for every non-`library` mode.**
   - A non-library call with no session gets `Please sign in to continue.`; a signed-in account with zero roles gets `Your account doesn't have access yet. Please contact an administrator.` (both 403). This is now only a guard, because every account gets `adopter` at signup.
   - A caller without the required role gets `This needs the Contributor role.` or `This needs the Adopter role.`
7. **Message validation (400/413), for every non-`library` mode.**
   - `messages` must be a non-empty array of at most 500 `user`/`assistant` turns. `grid` and `meta`, when sent, must be plain objects. Otherwise 400.
   - The text in messages + grid + meta + `existingPublishedDoc` must not exceed 800,000 chars. Otherwise 413 `This conversation is too long to send in one request.`
8. **`library` with a `pathwayId`.**
   - A malformed slug (`isValidSlug`) or an unpublished pathway gets 404 `Unknown pathway.`
   - Otherwise the prompt is grounded in that pathway's published document, with Source Trace stripped (`getPublishedDocument` + `adopterDocument`). It also gets the pathway's published toolkit assets and, for seeded pathways, passages from its public source documents (`pathwayPassages` → `match_source_chunks`).
   - Without a `pathwayId`, the prompt gets the library overview (`buildOverview`) plus lessons retrieved for the latest question.

## Pathways (contributor workspace)

| Method | Path | Handler | Auth | Purpose |
|---|---|---|---|---|
| GET | `/api/pathways` | `app/api/pathways/route.ts` | `pathway_contributor` **or admin** (403 otherwise) | Lists every pathway for the contributor's selector. It reads with the **service role** and listing columns only, because migration `0040` limits the session to the pathways it contributes to. Each row carries `isPublished` (slug present in the `published_pathways` view), `reviewRequested`, `isContributor`, and the names of the contributing orgs |
| POST | `/api/pathways` | `app/api/pathways/route.ts` | `pathway_contributor` | Creates a pathway (`{title, sector, description}`, all required non-empty strings). The slug always passes `isValidSlug`, falls back to `pathway`, and is made unique against every `pathways` row. The insert uses the service role. Returns 201 `{id, slug}` |
| POST | `/api/pathways/[id]/join` | `app/api/pathways/[id]/join/route.ts` | `pathway_contributor` | Joins a pathway. The pathway's existence is checked with the service role. Joining twice is an idempotent no-op. Resolves or creates the caller's org from their `contributor_registrations` row (400 if there is none) |
| DELETE | `/api/pathways/[id]/join` | `app/api/pathways/[id]/join/route.ts` | any session | Leaves a pathway: removes only the caller's own `pathway_contributors` row (service role, since the table has no delete policy). The Contribute grid's Delete calls this after deleting the caller's workspace |
| POST | `/api/pathways/assemble` | `app/api/pathways/assemble/route.ts` | `hasAnyRole` + `pathway_contributor` + pathway membership + the design must be the caller's own workspace for this pathway | **"Send for review."** Takes the latest `design_documents` draft and applies the Section 4 toolkit-asset File column. It saves the result as the next **`pathway_versions`** row via `saveVersion` (`source='contributor'`), which moves a `draft` pathway to `in_review`. It also writes `content_cache` and sets `review_requested=true` and `assembled_design_doc_id`. **No GitHub commit**, and this does not make the pathway live |
| POST | `/api/pathways/check-similar` | `app/api/pathways/check-similar/route.ts` | `pathway_contributor` | A forced-tool-use `claude-sonnet-4-6` call (`report_match`). It compares the candidate title/sector/description against **published** pathways only (the slugs come from the `published_pathways` view, the rows from `pathways` via the service role). Returns `{matchId: string \| null}`. Any LLM failure answers `{matchId: null}` and is recorded |

## Contributions and toolkit assets

| Method | Path | Handler | Auth | Purpose |
|---|---|---|---|---|
| DELETE | `/api/contributions/[designId]` | `app/api/contributions/[designId]/route.ts` | session; owner only (the design is read and deleted through RLS) | Handles the contributor's "No, delete this contribution." It deletes the workspace, its drafts, and every **not-yet-published** toolkit asset shared from it, files included. It drops those assets from the review copy and clears the pathway's `assembled_/published_design_doc_id` pointers to this workspace's documents, withdrawing a pending review. Published assets stay |
| GET | `/api/toolkit-assets?ids=a,b` | `app/api/toolkit-assets/route.ts` | **public** (`/api/toolkit-assets` is in `PUBLIC_PATHS`) | Card metadata for up to 20 **published** asset ids. Unknown and unpublished ids are left out silently. Never returns a storage path or URL |
| POST | `/api/toolkit-assets` | same | `pathway_contributor` + membership (`authorizePathwayContributor`) | Registers an asset after the contributor's explicit public-sharing consent (`shareConsent: true` is required). `kind:'file'`: the `storagePath` must sit under the pathway's prefix, the object must exist, and it must be 25 MB or less. `kind:'link'`: `https://` only, at most 2,000 chars. Inserts an **unpublished** `contribution_units` row (`unit_type='toolkit-asset'`, id `asset-<uuid>`) with the service role. Returns 201 `{id, status:'awaiting_pathway_review'}` |
| POST | `/api/toolkit-assets/upload-url` | `app/api/toolkit-assets/upload-url/route.ts` | same as above | Step 1 for a file. Checks the extension (no ZIP) and size, then returns a one-time signed upload URL for a server-built path in the private `toolkit-assets` bucket. The browser uploads to that URL directly |
| DELETE | `/api/toolkit-assets/[id]` | `app/api/toolkit-assets/[id]/route.ts` | uploader only, unpublished only | Removes one of the caller's own assets before it goes live. Someone else's asset gets 404, and an already-live asset gets 409. The row is deleted first, then the file, then the asset is dropped from `pathways.content_cache` |
| GET | `/api/toolkit-assets/[id]/download` | `app/api/toolkit-assets/[id]/download/route.ts` | public for a published asset; an unpublished one goes only to its uploader or an admin (404 for everyone else) | Streams the file through the route, so the storage URL is never exposed (`Content-Disposition` attachment, `nosniff`, `no-store`). A link asset gets a 302 to its https URL. `?preview=1` shows a PDF, image, or text file inline (text as sandboxed `text/plain`) |

## Wiki (public/browse)

| Method | Path | Handler | Auth | Purpose |
|---|---|---|---|---|
| GET | `/api/wiki-pathways` | `app/api/wiki-pathways/route.ts` | none (fully public) | Metadata for every **published** pathway (`slug, title, description, sector, stage, timestamp, contributor`), read from the store via `listWikiPathways()` → `listPublished()`. Used for chat source-attribution chips |
| GET | `/api/wiki-stats` | `app/api/wiki-stats/route.ts` | `hasAnyRole` | `{total, sectors[]}` over published pathways (excludes `Cross-Sector`). Used by the companion's opening line |

## Organisations

| Method | Path | Handler | Auth | Purpose |
|---|---|---|---|---|
| GET | `/api/organisations` | `app/api/organisations/route.ts` | session + `hasAnyRole` (401 otherwise) | Autocomplete search (`?q=`) for the organisation field at contributor signup. `%`, `_` and `\` are escaped, so they match literally |

## Account and auth

| Method | Path | Handler | Auth | Purpose |
|---|---|---|---|---|
| POST | `/api/account/delete` | `app/api/account/delete/route.ts` | any session + password re-check | Permanent self-serve account deletion (see `specs/ACCOUNT_DELETION_SPEC.md`, `lib/account-deletion-server.ts`) |
| POST | `/api/account/contact-sharing` | `app/api/account/contact-sharing/route.ts` | any session + own `contributor_registrations.access_status === 'approved'` | `{sharingLevel: 'none'\|'name'\|'name_and_email'}` updates only `share_name`/`share_contact`/`contact_info` on the caller's own row, using the service-role client. The table has no user UPDATE policy, because one would also expose `access_status` |
| POST | `/api/auth/send-email` | `app/api/auth/send-email/route.ts` | Standard Webhooks HMAC signature (`SEND_EMAIL_HOOK_SECRET`), no session | Target of Supabase's Send Email Auth Hook. Sends signup, recovery, reauthentication, invite and magiclink emails over SMTP. `email_change` is explicitly rejected (400) |

## Errors

| Method | Path | Handler | Auth | Purpose |
|---|---|---|---|---|
| POST | `/api/errors/client` | `app/api/errors/client/route.ts` | none (public, in `proxy.ts` `PUBLIC_PATHS`) | Takes browser errors from `app/error.tsx`/`app/global-error.tsx` (via `lib/client-error-report.ts`). Order: per-IP rate limit (`client-error` scope) → 429. A body over 16 KB or bad JSON → 400. Otherwise it writes a `sys_errors` row with `source = client:<path>` (query stripped, non-path → `/`) and the session user attached → 204. Reads only `message`, `stack`, `path` |

## Admin

All admin routes use `isAdmin()`: the `ADMIN_EMAILS` env list **or** an `admin` role row.

| Method | Path | Handler | Auth | Purpose |
|---|---|---|---|---|
| POST | `/api/admin/roles` | `app/api/admin/roles/route.ts` | admin | `{user_id, role, action:'add'\|'remove'}`. `role` must be `pathway_contributor` or `admin`; `adopter` is not grantable because every account holds it. Adding `pathway_contributor` goes through `approveContributor()` (same as the registration Approve button). Removing it goes through `revokeContributor()`. `admin` is upserted (re-granting is a no-op) or deleted |
| POST | `/api/admin/contributor-registrations/approve` | `.../approve/route.ts` | admin | `{registration_id}` → `approveContributor()`: backfills `org_id`, sets `access_status='approved'`, and grants `pathway_contributor`. Works on a pending or a previously rejected registration |
| POST | `/api/admin/contributor-registrations/reject` | `.../reject/route.ts` | admin | `{registration_id}` → `revokeContributor()`: sets `access_status='rejected'` **and removes the `pathway_contributor` role** |
| GET | `/api/admin/pathways/document?pathway_id=` | `app/api/admin/pathways/document/route.ts` | admin | The document an admin reviews: the **latest `pathway_versions` row** (what Publish would make live), falling back to `pathways.content_cache`. Read with the service role, because the `0040` RLS cannot see `ADMIN_EMAILS`-only admins. Seeded pathways have versions but no `content_cache`. 404 if the pathway does not exist |
| POST | `/api/admin/pathways/publish` | `app/api/admin/pathways/publish/route.ts` | admin | `{pathway_id}` publishes the pathway's latest version via `publishVersion()`. That call sets `status='published'` and `published_version_id`, copies the card fields from the frontmatter, and re-parses and re-embeds `pathway_units`. Then the route clears `review_requested`, sets `published_design_doc_id`, publishes the toolkit assets whose `asset-id` markers appear in that version, and emails the contributor (best-effort). Returns `{ok, slug, assetsPublished, skippedUnits, embedded}`. 400 if no version exists yet |
| POST | `/api/admin/pathways/delete` | `app/api/admin/pathways/delete/route.ts` | admin | `{pathway_id}` first removes the pathway's toolkit-asset files and its seeded source files from storage (best-effort), then deletes the `pathways` row. Versions, units, sources, chunks, contributors and `contribution_units` cascade with it. **Deleting a pathway unpublishes it**, because `published_pathways` is now a view over `pathways`. `designs.pathway_id` is set to null |

## Response conventions

- **Every one of the 23 route handlers is wrapped by `withErrorHandling(source, handler)`** (`lib/errors.ts`). Handlers are named `handle<METHOD>` and exported as `export const POST = withErrorHandling('api/<path>', handlePOST)`. The wrapper behaves like this:
  - A returned 4xx passes through untouched. It is recorded as `expected` in `sys_errors`, except 429s, which are not recorded. An anonymous caller's errors are recorded only within the per-IP `anon-error` allowance.
  - A returned **5xx has its body replaced with the generic message** `System encountered an error. Please try sometime later.` The real text goes to `sys_errors`.
  - A thrown `ExpectedError` (`ValidationError` 400, `AuthError` 401/403, `NotFoundError` 404) becomes its own status and message.
  - Anything else thrown becomes 500 with the generic message, and the stack is recorded.
  - `/api/auth/send-email` passes `errorBody: hookError`, so Supabase Auth still gets `{error: {http_code, message}}`.
- Streamed 200 responses pass through the wrapper untouched. A failure **mid-stream** in `/api/chat` is caught inside the stream (`streamFailed()`). It is recorded in `sys_errors` and as an `ok:false` `ai_usage` row, then `controller.error()` makes the client's reader reject. The client shows the partial text plus the generic message, and does not save the broken reply.
- Streamed modes return raw `text/plain`: the model's streamed text, including the trailing `<grid_update>` block. The block is stripped on the client, never on the server.
- Non-streaming Anthropic calls:
  - `check-similar` (JSON `{matchId}`).
  - `/api/chat`'s `asset-reuse` (max 400 tokens, plain text).
  - The retrieval classifier (`claude-haiku-5-5`, inside `lib/retrieval.ts`, recorded as `mode: 'retrieval-classify'`).
- Max tokens per mode: 8192 `companion`, 1024 `library`/`extract-insights`, 9000 `pathway-draft`, 400 `asset-reuse`, 4096 everything else (`analysis-doc`, `executive-summary`).

## Source files

Every `app/api/**/route.ts` file (list in [`../repository-map.md`](../repository-map.md)). Prompt and retrieval detail: [`../integrations/ai-llm.md`](../integrations/ai-llm.md).
