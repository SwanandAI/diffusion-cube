# Spec: Toolkit Asset Files

Status: **TA-01 to TA-10 code complete (build passes). Migration 0034 applied to production and verified (2026-09-30). Next: end-to-end live test pass by the owner → TA-11 (wiki refresh + Terms review)** · Updated: 2026-09-30 · Owner: Anurag Goutam · Branch: `feature/toolkit-assets`

Planning artifacts (requirement, clarifications, approved plan, task list with acceptance criteria and test plans): [`docs/tasks/toolkit-asset-files/`](../docs/tasks/toolkit-asset-files/). This spec records **what is being built and what has actually been done**. The progress log (§10) is updated after every task.

## 1. Goals

- A contributor can attach the real file behind a Toolkit Asset (or a link to it), not just describe it in words.
- Nothing is stored or shared without the contributor's explicit "OK to share this publicly?".
- Assets are reviewed and published together with their pathway. There is no separate asset approval.
- Anyone can find published assets through conversation in `/analyse` and `/explore`, and download them without signing in.

## 2. What changes

| Before | After this change |
|---|---|
| Toolkit assets exist only as text inside pathway documents | Contributors attach the actual file (PDF, Word, PowerPoint, Excel, CSV/TXT/MD, images, up to 25 MB, no ZIP) or an https link |
| Uploaded files are text-extracted in the browser and discarded | A file the contributor agrees to share publicly is stored in the private Supabase Storage bucket `toolkit-assets` |
| `contribution_units` table exists but nothing uses it (0 rows) | Each asset is one `contribution_units` row (`unit_type='toolkit-asset'`) |
| Anyone signed in could insert/update their own `contribution_units` rows, including setting `published_at` (self-publish) | Client write policies removed. Only server routes write this table |
| Pathway documents list assets as prose only | "Send for Review" adds a generated **Toolkit asset files** block, which the admin reviews with the pathway |
| n/a | Admin publishing the pathway publishes the assets listed in that reviewed document |
| n/a | Claude offers published assets as download cards in `/analyse` and `/explore` chats |

## 3. User flows

1. **Contributor attaches.** In a `/contribute` workspace the contributor uploads a file or pastes an https link.
2. **AI identifies.** The contributor companion flags it in `<grid_update>.toolkitAssetCandidates` if it's a genuine reusable artifact.
3. **Consent.** A card asks *"OK to share this publicly? Anyone using 100 Pathways, including visitors who aren't signed in, will be able to download it."*
   - **No:** nothing is stored.
   - **Yes:** the browser uploads to a signed upload URL, then the server registers the row (unpublished).
4. **Send for Review (assemble).** The asset block, listing every consented asset, is written into the pathway document (GitHub `.md` + `pathways.content_cache`).
5. **Admin publish.** `published_pathways` is updated as before. Assets whose IDs are in the reviewed document get `published_at` set. An asset attached after the last Send for Review waits for the next round.
6. **Discovery (same rules on both pages, one shared prompt text):**
   - Assets are brought up only in the conversation: never in Claude's first reply; from the user's second message onward once the talk is about a pathway with assets (in `/analyse`, a pathway that genuinely matches the user's situation); or straight away when the user asks about tools, templates, resources, files or how to reuse something.
   - Each is offered once, as a suggestion. Claude never writes a URL.
   - `/analyse`: the IDs go in `<grid_update>.toolkitAssetsReferenced`.
   - `/explore`: the IDs go in a trailing `<toolkit_assets>[ids]</toolkit_assets>` tag, which is never shown.
   - In both, the client validates the IDs and shows a **download card under that reply**. There is no separate asset list anywhere. Downloads need no sign-in.

## 4. Storage (Supabase Storage)

- We use **Supabase Storage**, the **Storage → Files → Buckets** screen of the project dashboard. No S3 and no other service.
- One bucket, **`toolkit-assets`**, created by migration 0034 (an `insert into storage.buckets`, the same thing as clicking "New bucket"). Once applied it appears on that Buckets screen.
- Settings:
  - **private** (`public = false`)
  - **file size limit 25 MB**
  - **allowed MIME types:** pdf, doc, docx, ppt, pptx, xls, xlsx, csv, txt, md, png, jpeg, gif, webp (no zip)
- **No storage policies** are created, so no browser can read or write the bucket directly:
  - Uploads use a signed upload URL issued by the server.
  - Downloads go through `GET /api/toolkit-assets/[id]/download`, which mints a 60-second signed URL.
- Object path: `<pathway_id>/<uuid>/<ascii-safe file name>`. The original file name is kept separately for display and download.

## 5. Database changes: exactly what is touched

**Nothing existing is renamed, retyped or removed, and no existing data changes.** Migration 0034 touches only:

| Object | Change | Kind |
|---|---|---|
| `public.contribution_units` (existing table, 0 rows) | **Adds 11 new columns:** `asset_kind`, `asset_name`, `purpose`, `reuse_condition`, `storage_path`, `file_name`, `mime_type`, `size_bytes`, `link_url`, `share_consent` (default false), `share_consented_at`. All nullable except `share_consent` | Additive |
| `public.contribution_units` | Adds check constraint `contribution_units_toolkit_asset_shape`. It applies **only** to rows with `unit_type='toolkit-asset'`; other rows are unaffected | Additive |
| `public.contribution_units` | Adds partial index `contribution_units_toolkit_assets_idx` on `(pathway_id, published_at)` for asset rows | Additive |
| `public.contribution_units` | **Drops 2 RLS policies**: "Contributors can insert their own units" and "Contributors can only update their own units". The select policy stays | **Non-additive (security fix)** |
| `storage.buckets` (Supabase system table) | Inserts one row: the `toolkit-assets` bucket | Additive |

Existing columns of `contribution_units` (`id`, `unit_internal_id`, `pathway_id`, `design_id`, `user_id`, `section`, `unit_type`, `dimension`, `stage`, `density`, `source_doc`, `published_at`, `created_at`, `updated_at`, `content`) are reused as-is. No other table is changed by the migration. Later tasks change **application code** that reads/writes `pathways` and `published_pathways`, but add no columns to them.

## 6. API (added or changed)

| Method | Path | Auth | Status |
|---|---|---|---|
| POST | `/api/toolkit-assets/upload-url` | `pathway_contributor` + pathway member | Built (TA-03), not live-tested |
| POST | `/api/toolkit-assets` | `pathway_contributor` + pathway member | Built (TA-03), not live-tested |
| GET | `/api/toolkit-assets?ids=` | Public (published only) | Built (TA-07), not live-tested |
| GET | `/api/toolkit-assets/[id]/download` | Public if published; uploader/admin otherwise | Built (TA-07), not live-tested |
| POST | `/api/pathways/assemble` | Changed: asset block, slug validation, `designId` ownership | Built (TA-05), not live-tested |
| POST | `/api/admin/pathways/publish` | Changed: publishes the reviewed assets | Built (TA-06), not live-tested |
| POST | `/api/chat` | Changed: assets in explorer/library prompts, library `pathwayId` validation | Built (TA-08/09), not live-tested |

## 7. Migration and environments

- File: [`supabase/migrations/0034_contribution_units_toolkit_assets.sql`](../supabase/migrations/0034_contribution_units_toolkit_assets.sql).
- The only Supabase project configured in `.env.local` (`pcpdgufryqrkzugnkljl`, branch `main`) is labelled **PRODUCTION** in the dashboard.
- **Decision (2026-09-30):** the owner runs 0034 in the **Supabase SQL Editor** (as with 0033). The developer then verifies read-only through psql.
- Any live test that creates asset rows or files will land in production. Each such test is confirmed with the owner before it is run.
- Rollback, if ever needed: drop the constraint, index and 11 columns; recreate the two policies from `0022`; delete the bucket, which must be empty first.

## 8. Security notes

- Security review findings fixed in code this work touches: **#2** (library `pathwayId` path traversal), **#4** (slug → GitHub path traversal), **#6** (assemble `designId` ownership). See `docs/security/security-review-2026-09-30.md`.
- Known and accepted for this release:
  - public downloads have **no rate limit** (egress cost)
  - files are **not scanned** for malware or PII
  - the public-sharing consent wording needs a Terms of Use review before launch

## 9. Files

| File | Task | Status |
|---|---|---|
| `supabase/migrations/0034_contribution_units_toolkit_assets.sql` | TA-01 | Applied 2026-09-30 (owner, SQL Editor) |
| `lib/toolkit-assets.ts` (browser-safe helpers) | TA-01 | Written |
| `lib/toolkit-assets-server.ts` (server-only storage/DB helpers) | TA-01 | Written |
| `components/WikiMarkdown.tsx` (hides HTML-comment markers) | TA-01 | Changed |
| `content/framework.md` (Playbook + Toolkit Asset unit-type rows) | TA-02 | Changed |
| `lib/system-prompts.ts` (contributor "Toolkit asset files" section, `toolkitAssetCandidates` contract) | TA-02 | Changed |
| `lib/grid-update.ts` (`toolkitAssetCandidates` parsing, `TOOLKIT_ASSET_CONSENT_MARKER`) | TA-02/03 | Changed |
| `lib/extract-text.ts` (`ATTACH_ACCEPT`, `CONTRIBUTOR_ATTACH_ACCEPT`) | TA-02 | Changed |
| `lib/adoption-conversation.ts` (asset-only attachments, in-memory asset files, consent cards, share/decline, refresh counter) | TA-02/03/04 | Changed |
| `components/ChatPanel.tsx`, `components/AttachmentsPanel.tsx` (accept prop, consent card rendering) | TA-02/03 | Changed |
| `components/AdoptionWorkspace.tsx` (wiring) | TA-02/03/04 | Changed |
| `app/api/toolkit-assets/upload-url/route.ts` | TA-03 | New |
| `app/api/toolkit-assets/route.ts` (POST register) | TA-03 | New |
| `components/ToolkitAssetConsentCard.tsx` | TA-03 | New |
| `components/ToolkitAssetStatusList.tsx`, `components/PathwayDocumentPane.tsx` | TA-04 | New / changed |
| `lib/slug.ts` (shared slug validator) | TA-05 | New |
| `app/api/pathways/assemble/route.ts` | TA-05 | Changed |
| `lib/adoption-plan-markdown.ts` (hides HTML-comment markers in modal/PDF) | TA-05 | Changed |
| `app/api/admin/pathways/publish/route.ts` | TA-06 | Changed |
| `app/admin/page.tsx`, `components/AdminPathwaysPanel.tsx`, `components/AdminPathwayRowCard.tsx` | TA-06 | Changed |
| `app/api/toolkit-assets/[id]/download/route.ts` (public download) | TA-07 | New |
| `app/api/toolkit-assets/route.ts` (public GET `?ids=`) | TA-07 | Changed |
| `proxy.ts` (`/api/toolkit-assets` in `PUBLIC_PATHS`) | TA-07 | Changed |
| `components/ToolkitAssetCards.tsx` (download cards under replies) | TA-08/09 | New |
| `lib/toolkit-assets.ts` (shared prompt text: `renderToolkitAssetsForPrompt`, `toolkitAssetTimingRules`) | TA-08/09 | Changed |
| `lib/system-prompts.ts` (explorer + library asset blocks, `toolkitAssetsReferenced` contract) | TA-08/09 | Changed |
| `lib/grid-update.ts` (`toolkitAssetsReferenced` parsing) | TA-08 | Changed |
| `app/api/chat/route.ts` (assets into prompts; library `pathwayId` validation) | TA-08/09 | Changed |
| `lib/adoption-conversation.ts`, `components/ChatPanel.tsx` (persist + render `/analyse` cards) | TA-08 | Changed |
| `app/explore/ExploreLibrary.tsx` (strip tag, parse IDs, cards, persist) | TA-09 | Changed |
| `app/api/admin/pathways/delete/route.ts`, `app/api/account/delete/route.ts`, `components/AdminPathwaysPanel.tsx` (copy) | TA-10 | Changed |
| `specs/ACCOUNT_DELETION_SPEC.md` (asset files) | TA-10 | Changed |

## 10. Progress log

One entry per completed task (newest last): what was done, how it was verified, and what is still open.

### 2026-09-30 · Setup
- Branch `feature/toolkit-assets` created from `Terms`.
- Checked the live `contribution_units` schema read-only (psql). It matches migrations 0022/0025/0033: 15 columns, 3 policies, 0 rows.

### 2026-09-30 · TA-01: Migration 0034, bucket, core library (code complete, migration pending)
**Done**
- Wrote migration 0034 (columns, asset-shape constraint, partial index, drop of 2 client write policies, private `toolkit-assets` bucket with 25 MB / MIME limits).
- `lib/toolkit-assets.ts`:
  - allowed types and extension → MIME map (no zip)
  - `displayAssetFileName` / `sanitizeAssetFileName`
  - asset-ID validation
  - `renderToolkitAssetBlock` / `applyToolkitAssetBlock` / `assetIdsInDocument`
  - `parseToolkitAssetsTag` / `stripToolkitAssetsTag`
- `lib/toolkit-assets-server.ts`:
  - published/pathway/single-asset loaders
  - signed upload URL, object size check, 60 s signed download URL, object removal
- `components/WikiMarkdown.tsx` strips HTML comments so asset markers never show as text.

**Decisions**
- Split the library into browser-safe and server-only files, following `lib/grid-update.ts`, so the service-role client can't be bundled client-side.
- Storage key uses an ASCII-safe name (Supabase keys are ASCII-only); the original name is kept for display and download.

**Verified (manual, no automated suite)**
- `npx tsc --noEmit` clean.
- `eslint` clean on the new/changed files.
- A scratch script (outside the repo) ran 21 checks, all passing:
  - block placement on the real `mahavistaar.md` (between Section 4 and Section 6)
  - drafts with `---` separators, and docs with no Section 4 or no Source Trace
  - idempotency; empty-list removal; no URL in the block
  - markers outside the block ignored
  - file-name sanitising (`../`, `\`, NUL, empty); no-zip and 25 MB boundary
  - partial and complete tag stripping; tag parsing (valid, deduped, malformed)

**Open**
- Migration 0034: the owner runs it in the SQL Editor (decided 2026-09-30); the developer then verifies it read-only.
- Database-side checks (constraint, dropped policies, bucket access denial) can only run once it is applied.

### 2026-09-30 · TA-02: Contributor companion identifies toolkit-asset candidates (code complete)
**Done**
- `content/framework.md`: added the **Playbook** and **Toolkit Asset** rows to "The five unit types". The table previously listed only 3 of the 5 types, and it is the definition the contributor companion actually reads.
- `contributorSystemPrompt` gains a "Toolkit asset files" section:
  - flag only genuine reusable artifacts, never source material or design decisions
  - once per file or link; https links only
  - never ask about sharing in prose; no judgment statements
- `gridUpdateContract` gains an opt-in `toolkitAssetCandidates` field (contributor only).
- `parseGridUpdate` validates candidates and drops entries with no name or no file/https source.
- Contributor-flow attachments:
  - `.doc`, `.ppt`, `.csv`, images over 5 MB, and PDFs with no text layer are accepted as **asset-only** attachments (the model is told the name, type and size)
  - asset-eligible files (up to 25 MB) are held in memory for the consent step
  - ZIP stays rejected
  - the Explorer flow is unchanged
- File pickers: new `ATTACH_ACCEPT` / `CONTRIBUTOR_ATTACH_ACCEPT` constants. `ChatPanel` and `AttachmentsPanel` take an accept prop; the contributor surfaces pass the wider list.

**Verified**
- `tsc` clean; `npm run build` passes.
- `eslint`: no new problems. The same 2 errors and 3 warnings exist identically on the `Terms` versions of these files (checked by stashing).

**Open**
- The model's actual flagging behaviour (💲 live Anthropic calls) is not yet tested.

### 2026-09-30 · TA-03: Consent card, upload URL, register (code complete, not live-tested)
**Done**
- `POST /api/toolkit-assets/upload-url`:
  - re-checks session, `pathway_contributor` role and pathway membership (shared `authorizePathwayContributor`)
  - checks extension (no zip) and size (≤ 25 MB)
  - returns a signed upload URL for a server-built path `<pathwayId>/<uuid>/<ascii-name>`, plus the MIME type chosen from the extension
- `POST /api/toolkit-assets`:
  - re-checks the same things
  - requires `shareConsent: true`
  - file: path must be under the pathway's prefix, the object must exist, size re-checked via `info()`
  - link: must be valid `https:`
  - `designId` is linked only if the session client can see that design and it belongs to the pathway
  - inserts an unpublished `contribution_units` row with the service role and returns `{id, status:'awaiting_pathway_review'}`
- Client:
  - after a contributor reply, one consent card per **new** candidate (a file candidate must name a file actually uploaded in this conversation; a source already asked about is skipped)
  - **Yes** → signed upload straight to the bucket, then register
  - **No** → nothing stored and the in-memory file is dropped
  - double-submit blocked
  - after a reload, the card asks the contributor to re-attach the file
  - the outcome is persisted on the message, so it survives reload and Claude sees it in history
- Card copy: *"OK to share this publicly? Anyone using 100 Pathways, including visitors who aren't signed in, will be able to download it once this pathway is approved."*

**Verified**
- `tsc` clean, `npm run build` passes, no new lint problems.

**Open**
- Live test blocked: 0034 isn't applied yet (no bucket, and the old policies are still in place).
- A live test will create a real row and file in the **production** project; to be confirmed with the owner first.

### 2026-09-30 · TA-04: Contributor asset status list (code complete, not live-tested)
**Done**
- `ToolkitAssetStatusList` sits under the document in `PathwayDocumentPane`. It lists the pathway's assets visible under RLS (own rows, plus others' published), each with **Awaiting pathway review** / **Published** and a link to the download route (built in TA-07).
- The list re-fetches after each successful share.

**Verified**
- `tsc` clean, `npm run build` passes.

**Open**
- The download links only work after TA-07.
- ~~Decision needed on late-added assets~~: resolved 2026-09-30, see TA-05.

### 2026-09-30 · Decisions at the TA-01 to TA-04 checkpoint
- **Late-added assets:** show "Send for Review" again whenever the pathway has shared assets not yet in the sent document (owner chose the recommended option).
- **Live testing:** one end-to-end test pass after TA-10 is coded, not per group.

### 2026-09-30 · TA-05: Assemble writes the asset block; security fixes #4 and #6 (code complete, not live-tested)
**Done**
- `app/api/pathways/assemble/route.ts`:
  - **#6 (IDOR):** `designId` must be the caller's own design (session client, RLS own-only) **and** linked to `pathwayId`, otherwise 403. The draft read is also filtered by `user_id`.
  - **#4 (path traversal):** the pathway slug must match `lib/slug.ts`'s `^[a-z0-9]+(-[a-z0-9]+)*$` before any GitHub call, otherwise 400.
  - The committed GitHub file and `content_cache` now contain `applyToolkitAssetBlock(draft, all consented assets for the pathway)`. The response still returns the draft itself, unchanged, so the contributor's pane behaves as before.
- `pathwayDraftSystemPrompt` rule 6: leave out the toolkit-asset block and never write `asset-id` markers (the app regenerates them).
- `lib/adoption-plan-markdown.ts`: HTML comments are stripped before parsing, so markers can never show in the document modal or the PDF.
- Late-asset resend:
  - `ToolkitAssetStatusList` now shows **Published / Sent for review / Not yet sent for review** (by comparing with `pathways.content_cache` markers) and reports the "not yet sent" count.
  - `PathwayDocumentPane` shows "Send for Review" when that count is over 0, with the note "N new toolkit asset(s) not yet sent for review."
  - After a successful send, the list refreshes.

**Verified**
- `tsc` clean, `eslint` clean on the changed files, `npm run build` passes.

**Open**
- Live test (a GitHub commit to `cube-dev`) is planned for the end-to-end pass.

### 2026-09-30 · TA-06: Approving the pathway publishes its assets; admin sees them in review (code complete, not live-tested)
**Done**
- `app/api/admin/pathways/publish/route.ts`: after the `published_pathways` upsert, sets `published_at` on this pathway's unpublished toolkit assets **whose IDs appear in the published `content_cache`**. It never touches another pathway's assets and is idempotent. Returns `assetsPublished: false` if that step fails (the pathway is still published).
- `app/admin/page.tsx` loads every toolkit asset (admin client), grouped by pathway.
- `AdminPathwayRowCard` gets a "Toolkit assets in this review" section with name, file + size or link domain, purpose, **Preview** (via the download route; admins may open unpublished assets), a "Not scanned for malware" label, and a note that publishing makes them public. Assets shared after the review was sent are listed separately as "not published by this click".
- `AdminPathwaysPanel` shows an error toast when `assetsPublished === false`.

**Verified**
- `tsc` clean, `eslint` clean on the changed files, `npm run build` passes.

**Open**
- Previews work after TA-07.
- Known and pre-existing (security review #7): the admin card caches `content_cache` on first expand, but publish uses the value at click time. So if a contributor re-sends after the admin opened the card, what gets published may differ from what was shown. Not in this feature's scope.

### 2026-09-30 · Decision: how assets appear in chat
- Owner's decision: **same way on both pages**. Only in the conversation (no separate list or UI), at the designed moments, with a **download card under the reply** (chosen over inline links or names-only). The timing rule is one shared text (`toolkitAssetTimingRules`) used by both prompts, so the two can't drift apart.

### 2026-09-30 · TA-07: Public download route and metadata API (code complete, not live-tested)
**Done**
- `GET /api/toolkit-assets/[id]/download`:
  - rejects malformed IDs (404)
  - **published** asset → 302 to a fresh 60 s signed URL (download disposition, original file name), or to the stored https link
  - **unpublished** → only the uploader or an admin; everyone else gets the same 404 as a missing ID
  - missing object → 404, not 500
  - `Cache-Control: no-store`
- `GET /api/toolkit-assets?ids=`: public, published only, up to 20, unknown IDs omitted. Returns no path or URL.
- `proxy.ts`: `/api/toolkit-assets` added to `PUBLIC_PATHS`. The contributor POST routes under it still enforce auth in the handler (401/403).

**Verified**
- `tsc` clean, `eslint` clean on the new files, `npm run build` passes.

### 2026-09-30 · TA-08: `/analyse` offers assets in conversation (code complete, not live-tested)
**Done**
- The explorer companion prompt gets a "Toolkit asset files" block (every published asset: ID, pathway, kind, name, purpose, reuse condition) plus the shared timing rules, narrowed to pathways that genuinely match the user's situation.
- The contract field `toolkitAssetsReferenced` is added only when assets exist.
- `parseGridUpdate` keeps only well-formed asset IDs.
- The hook stores the IDs on the final assistant message, so cards survive reload.
- `ChatPanel` renders `ToolkitAssetCards` under that reply. The cards fetch public metadata and silently drop unknown or unpublished IDs.
- Only `mode === 'companion'` on the explorer branch loads assets; document modes and the contributor flow never do.

**Verified**
- `tsc` clean, build passes, no new lint problems.
- Scratch checks: prompt entry is one line with ID and slug; the rules contain the first-reply ban, the second-message rule and the no-URL rule.

**Open**
- Whether the model follows the timing (💲) is to be checked in the end-to-end pass.

### 2026-09-30 · TA-09: `/explore` offers the pathway's assets in conversation; security fix #2 (code complete, not live-tested)
**Done**
- **#2 (path traversal):** library-mode `pathwayId` must be a valid slug (`lib/slug.ts`) before any file read, otherwise 404 with no model call. `../../wiki/pathways/x` can no longer load arbitrary `.md` files.
- For a pathway chat, that pathway's published assets are loaded and passed to `libraryPathwaySystemPrompt`, together with the same shared timing rules, an explicit "never in the opening overview" line, and the trailing-tag contract (after the closing question).
- `ExploreLibrary`:
  - hides the tag from the moment it starts streaming (including a half-arrived `<toolk…`)
  - parses the IDs on completion and keeps them on the message (saved to `library_conversations` for signed-in visitors)
  - renders `ToolkitAssetCards` filtered to the open pathway's slug
  - sends only `{role, content}` back to `/api/chat`
- The overview chat (no pathway) never gets assets.

**Verified**
- `tsc` clean, build passes; lint shows only the 3 warnings already present on `Terms`.
- Scratch check: a library reply with a tag is stripped cleanly and its ID parsed.

### 2026-09-30 · TA-10: Storage cleanup on deletes (code complete, not live-tested)
**Done**
- Admin pathway delete removes the storage objects of all the pathway's toolkit assets before deleting it (rows cascade). Storage errors are logged, never blocking. The confirm dialog now mentions asset files.
- Account delete removes the user's **unpublished** asset files before their rows. Published asset files stay downloadable (rows keep `user_id = null`).
- `specs/ACCOUNT_DELETION_SPEC.md` §4.1/§4.2 updated.

**Verified**
- `tsc` clean, build passes, no new lint problems.

**Open (all tasks)**
- Migration 0034 is still not applied (checked 2026-09-30: no bucket, no asset columns, 3 old policies).
- End-to-end live test pass, then TA-11 (wiki refresh via `llm-wiki`; Terms of Use review of the public-sharing wording).
- Not in scope, noted: `lib/wiki-content.ts` `/wiki/[slug]` has the same unvalidated-slug pattern (security review #25; signed-in only).

### 2026-09-30 · Migration 0034 applied
- The owner ran 0034 in the Supabase SQL Editor (production project). Result: "Success. No rows returned".
- Read-only verification via psql:
  - 11 new columns on `contribution_units`
  - only the SELECT policy remains (the insert/update policies were dropped)
  - constraint `contribution_units_toolkit_asset_shape` present
  - index `contribution_units_toolkit_assets_idx` present
  - bucket `toolkit-assets`: `public=false`, limit 26214400 (25 MB), 14 MIME types, zip not allowed
  - 0 storage policies reference the bucket
  - `contribution_units` still 0 rows (no existing data touched)
- Test files prepared (outside the repo) in `~/Desktop/langchat-toolkit-test-files/`, LangChat-themed:
  - checklist PDF (asset)
  - interview transcript DOCX (source material)
  - ZIP (rejection test)
  - language QA matrix CSV (the "No" answer test)
  - data-model template MD (the late-asset test)
- Testing on a new "LangChat Toolkit Test" pathway was recommended, **not** the real `langchat` pathway (already awaiting review; publishing would make it live).

### 2026-09-30 · Live test round 1 (owner), Part A
Test pathway: **"Test Assets Langchat"** (`test-assets-langchat`, id `f646508e…`). Evidence checked read-only in the database and bucket.

| Step | Result | Evidence |
|---|---|---|
| A2/A3 checklist PDF → Yes | ✅ Pass | 1 `contribution_units` row (`asset_kind=file`, `share_consent=true`, unpublished); object `f646508e…/<uuid>/LangChat-Multilingual-Chat-Launch-Checklist.pdf`, 37,568 bytes, `application/pdf`; card status `shared` persisted in `designs.messages` |
| A4 interview transcript | ✅ Pass | No card |
| A6 CSV test matrix | ❌ Fail, bug | No card. The CSV was sent as "asset-only", so the model never saw its contents; it guessed from the name, asked, then declined |
| A7 GitHub link (supabase/realtime) | ⚠️ Product gap | Model declined it as a "third-party dependency, not your own artifact" |

**Decision (owner, 2026-09-30):** third-party or open-source tools and repos **count as toolkit assets when the deployment actually built on them** and others could reuse them the same way. This matches the corpus precedent (MahaVISTAAR lists OpenAgriNet and Voicera as Toolkit Assets).

**Fixes applied**
- `lib/adoption-conversation.ts`: in the contributor flow, CSV is now read as text (`file.text()`) and sent to the companion. It falls back to asset-only if unreadable. The Explorer flow is unchanged (still doesn't take CSV).
- `contributorSystemPrompt` "Toolkit asset files" section, two new rules:
  - (1) third-party/open-source tools the deployment built on or adapted qualify; mentioned-in-passing or evaluated-only tools don't
  - (2) for files whose contents can't be read, judge from the file name and the contributor's description, don't question them about contents, and ask at most one neutral question only if nothing indicates what the file is
- Verified: `tsc` clean, no new lint problems. Re-test of A6/A7 pending.

### 2026-09-30 · Live test round 2 (owner), A6/A7 re-test
| Step | Result | Evidence |
|---|---|---|
| A6 CSV → No | ✅ Pass | Consent card shown (message 29), status `declined`; no `contribution_units` row, nothing in the bucket |
| A7 GitHub link | ❌ Fail, prompt | The model replied "Already noted from your earlier message" and listed no candidate. It read "list each file or link at most once per conversation" as "never reconsider anything already discussed" |

**Fix:** the once-only rule now applies only to files and links that **already had a card**, identifiable in history by the consent messages' outcome lines. Anything earlier judged not an asset, or only noted for the document, is listed once the contributor's new explanation meets the bar. The "don't announce" rule is also tightened: the model mustn't call something a toolkit asset in its prose (seen at message 28, "Updating the draft to include this test matrix as a toolkit asset"). `tsc` clean. Re-test pending.

### 2026-09-30 · Live test round 3 (owner), A7 re-test
- ❌ In the same chat the model replied "That link was already flagged from your earlier message — it's recorded as a toolkit asset candidate", but **no card was ever shown and no link row exists** (verified: 0 link rows, 0 url candidates in `designs.messages`). It was a hallucination: the model can't see its own past `<grid_update>` (stripped before storage) and inferred from its earlier prose.
- **Fix:** the contributor prompt now states that the consent-card outcome lines are the only record of what was flagged. With no such line, the item has **not** been flagged: never claim "already flagged/recorded/noted", and list it this turn if it qualifies.
- This chat's history now carries three earlier refusals for the same link. Re-test in a **fresh contributor chat** on the same test pathway (a clean-history test of the real flow), plus one more attempt in this chat.

### 2026-09-30 · Live test round 4 (owner), plus a re-publish question
| Step | Result | Evidence |
|---|---|---|
| A8 reload before answering | ✅ Pass | The data-model `.md` card shows "Attach the file again…" with Yes disabled (message 37, status `pending`) |
| A7 link (same old chat, message 38) | ❌ Fail | Again "already been flagged from your earlier messages"; still 0 link rows. The fresh-chat test was not run yet |

**New hypothesis:** the model may actually be emitting the link candidate in a shape the parser dropped (e.g. `source` as a bare string, a top-level `url`, or a trailing quote), which would explain why it believes it was "recorded".
- **Fix:** `parseToolkitAssetCandidates` is now lenient:
  - accepts `source` as an object (`fileName`/`filename`/`file`, `url`/`link`/`href`) or a bare string
  - accepts top-level `url`/`link`/`fileName`
  - strips trailing quotes and punctuation from URLs
  - still https-only and requires a name
  - scratch-checked on 8 shapes, all passing
- **Diagnostic (TEMPORARY, dev-only):** `app/api/chat/route.ts` logs the contributor companion's raw `<grid_update>` to the `npm run dev` terminal (`[chat][dev] contributor grid_update:`). **Remove after testing.**

**Owner question (answered from the code): re-publish after approval.**
- An approved version stays live in `published_pathways` while the contributor revises and re-sends. Re-sending overwrites only `content_cache` and the GitHub file. Adopters keep seeing the approved version until the admin publishes again, which replaces it wholesale.
- Published assets stay published and downloadable throughout (there's no revoke). New assets go live with the next approval. Assemble regenerates the block from the database each time, so no asset is lost even if a draft drops it.
- Caveats, both pre-existing:
  - the unapproved re-sent text sits in `content_cache` and on GitHub, and other contributors' drafts merge against it
  - the admin card's cached content (security review #7)

### 2026-09-30 · Live test round 5 (owner): link card appeared, but with a fabricated URL; plus a "View" request
- The link card appeared and the owner shared it. **But the saved row has `link_url = https://github.com/LangChat/langchat`, a URL the contributor never typed** (they pasted `https://github.com/supabase/realtime`). The model asked "is this the actual open-source … reference codebase?", got "yes", and **constructed a URL**. Approving the pathway would have published a fabricated link as the contributor's.
- **Fix (guard):** `appendToolkitAssetConsentMessages` only shows a card for a link that appears **verbatim in the contributor's own messages** (as file candidates must name an actually uploaded file). The prompt's `url` field now says: "exactly as the contributor typed it — never construct, complete, correct, or guess a URL". A cleanup of the bad row was handed to the owner (production write).
- **Owner request: a way to view files from the Files panel.** Implemented for files that are actually stored, i.e. those the contributor agreed to share:
  - `AttachmentsPanel` ("Shared in this chat") shows **View** for them (file name → asset ID, taken from the chat's `shared` consent cards) and "Not stored" for other uploads, with a tooltip explaining why. Duplicate names are deduped.
  - The download route accepts `?view=1` to open PDFs and images in the browser (signed URL with no download disposition) instead of downloading.
  - The status list and the admin Preview now use `?view=1` too.
- Verified: `tsc` clean; lint shows only the pre-existing problems on `Terms`.

### 2026-09-30 · Owner request: never expose the storage link, download instead
- **Problem:** "View/Download" redirected the browser to the Supabase signed storage URL, which exposed the project host, the bucket path (including the pathway ID) and the signed token in the address bar.
- **Fix:**
  - `GET /api/toolkit-assets/[id]/download` now **streams the file through the app** (`openAssetFileStream`: a server-side 60 s signed URL, fetched and piped as the response body). It always sends `Content-Disposition: attachment` (ASCII fallback plus RFC 5987 UTF-8 name), the stored `Content-Type`, `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
  - The storage URL never reaches the browser.
  - The inline `?view=1` mode was removed. Every file button now downloads (Files panel "Download", status list, admin card "Download", download cards).
  - Link assets still redirect to their own public https URL.
- **Risk to verify on Vercel:** proxied downloads go through the function's response. Vercel limits function response size (~4.5 MB for buffered responses; streamed responses may behave differently). **Test a file larger than 5 MB on a Vercel preview** before launch. If it fails, the fallback is a short-lived redirect (the old behaviour) for large files only, which is an owner decision.
- `createAssetDownloadUrl` was replaced by `openAssetFileStream`. `tsc` clean; no new lint problems.
