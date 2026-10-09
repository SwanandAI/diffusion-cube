# Spec: Toolkit Asset Files

Status: **TA-01 to TA-10 code complete (build passes). Migration 0034 applied to production and verified (2026-09-30). Next: end-to-end live test pass by the owner → TA-11 (wiki refresh + Terms review)** · Updated: 2026-10-09 · Owner: Anurag Goutam · Branch: `feature/toolkit-assets`

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

0. **Draft, then questions, then resources (since 2026-10-09).**
   - Once the material is enough, the companion settles the stage. It asks only when the documents don't state it.
   - It then sets `pathwayAction: "generate"`. The first draft appears, and a hidden note makes the companion ask its first journey question right under the draft.
   - When the questions end, `"questions-done"` revises the draft once with all the answers. The resource review card (steps 2–3) follows.
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
| DELETE | `/api/toolkit-assets/[id]` | Uploader only (`pathway_contributor` + pathway member), unpublished only | Built (2026-10-08), not live-tested |
| DELETE | `/api/contributions/[designId]` | Owner of the workspace (session RLS) | Built (2026-10-08), not live-tested |
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
| `app/api/toolkit-assets/[id]/route.ts` (DELETE: contributor removes an unpublished asset) | Flow-chart fixes | New |
| `components/ToolkitAssetStatusList.tsx` (Remove action) | Flow-chart fixes | Changed |
| `lib/toolkit-assets.ts` (`noToolkitAssetsRule`, `ToolkitAssetMention`, `buildAssetMentionAsk`) | Flow-chart fixes | Changed |
| `lib/grid-update.ts`, `lib/system-prompts.ts`, `lib/adoption-conversation.ts`, `components/ChatPanel.tsx` (`toolkitAssetMentions`) | Flow-chart fixes | Changed |
| `components/ResourceReviewCard.tsx`, `components/PublishConsentCard.tsx` | New contributor flow | New |
| `app/api/contributions/[designId]/route.ts` (delete a contribution) | New contributor flow | New |
| `lib/adoption-conversation.ts` (resource review + publish-consent actions, `routeResourceFindings`), `lib/toolkit-assets.ts` (`ResourceReviewState`, `PublishConsentState`), `lib/system-prompts.ts` (5-step contributor flow, `sensitiveNote`), `lib/grid-update.ts`, `components/ChatPanel.tsx`, `components/AdoptionWorkspace.tsx`, `components/PathwayDocumentPane.tsx` | New contributor flow | Changed |
| `app/api/admin/pathways/publish/route.ts`, `lib/email.ts` (`sendContributionEmail`) | New contributor flow | Changed |

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

### 2026-10-05 · Behaviour scenarios documented
- New: `docs/tasks/toolkit-asset-files/behaviour-scenarios.md` (since merged into `plan.md`, see below). Every contributor (`C-xx`) and adopter (`A-xx`) scenario, each marked implemented / partial / gap against the code at `3ded7ae`.
- Gaps found (not yet built):
  - the contributor is never asked proactively whether they have reusable assets (C-21 to C-28)
  - no partial-match framing for assets in `/analyse` and `/explore`; adjacent-pathway assets undefined (A-10, A-11, A-18)
  - "say nothing" when no asset fits also applies to an **explicit** ask (A-12)
  - conflict between "never in first reply" and "straight away when asked" for a first `/analyse` message (A-04)
- Added (same day) §9: evidence handling for adopters (scattered, missing, conflicting, stale), covering pathway insights and assets (A-28 to A-46). Already handled: no-evidence framing and inference flagging. Gaps:
  - no rule to **combine** evidence from several pathways
  - no rule for **conflicting** evidence
  - no **dates**: pathway `timestamp`s reach the prompt but nothing uses them; asset dates reach neither the prompt nor the card
- Proposed prompt/client changes and owner decisions D1 to D7 are in §10 of that document. No code changed.

### 2026-10-05 · Behaviour gaps implemented with default decisions (code complete, not live-tested)
Owner asked to take the recommended defaults (D1–D7, now in `plan.md` appendix B10.5) and build them.

**Done**
- **Contributor, general ask** (`lib/adoption-conversation.ts` `appendPathwayDocMessage`): on the first draft only, and only if no consent card exists yet, the draft message ends with *"Is there any asset you want to attach with this pathway? You can attach the file or paste an https link here."* The wording is the owner's.
- **Contributor, targeted ask** (`contributorSystemPrompt`): Claude asks once per artifact the material names but didn't attach. Only from step 4, on a `pathwayAction: "none"` turn; never after a "no"; never repeats the app's general question.
- **Adopter matching rules** (`toolkitAssetTimingRules`, shared by `/analyse` and `/explore`):
  - match and no-match rules, judged per asset: surface matching assets directly as relevant tools from that pathway
  - an explicit ask overrides the first-reply ban
  - "No shared toolkit files match this yet" on an explicit ask, optionally pointing to a toolkit described only in text
  - attribution by pathway; both of two competing assets offered
  - never describe a file's contents
  - a date clause for assets older than 12 months
- **Evidence handling** (`evidenceHandlingRules`, explorer only; `groundingRules` untouched): scattered, missing, conflicting and dated evidence, with today's date in the prompt. The length rule allows a lead-in plus up to four bullets when combining or contrasting. The library prompt gains a dates paragraph.
- **Dates:**
  - `lib/wiki-loader.ts` `datedLine()` adds `Documented as of:` (frontmatter timestamp) or `First published:` (`published_pathways.created_at`) beside `Contributed by:`; also used for the `/explore` DB fallback
  - assets carry `publishedAt` into the prompt (`· shared Sep 2026`) and onto the download card
  - `formatAssetMonth` uses a fixed month list, because `toLocaleDateString('en-GB')` gave "Sept" on this machine's ICU

**Verified**
- `tsc` clean and `npm run build` passes.
- `eslint` on the changed files: only the 2 pre-existing `exhaustive-deps` warnings in `adoption-conversation.ts`.
- Scratch checks (14, all pass): month formatting incl. a UTC year-end edge, the prompt line with and without a date, and the new rule phrases present in the shared asset rules. The date-line helper was checked separately on 3 cases.

**Open**
- Live test pass (💲 model behaviour) for the scenarios listed in `plan.md` appendix B10.6. Needs a published asset in the production project, so it's confirmed with the owner first.
- Before the pass, pick one test question that two corpus pathways answer differently (A-36).
- The TEMPORARY dev-only `grid_update` log in `app/api/chat/route.ts` is still in place and must be removed before merge.

### 2026-10-05 · Flow charts added
- `behaviour-scenarios.md` §1.4 (now `plan.md` appendix B1.4): four Mermaid flow charts with scenario IDs on each node. They show the behaviour as built:
  - Contributor 1: what happens to a file or link
  - Contributor 2: when assets get asked for
  - Adopter 1: when and how an asset is offered
  - Adopter 2: handling the evidence
- Verified: all four parse with the `mermaid` library (scratch check, outside the repo).

### 2026-10-05 · Behaviour spec merged into plan.md and requirement.md
- At the owner's request, `behaviour-scenarios.md` was folded into the planning documents and deleted:
  - [`plan.md`](../docs/tasks/toolkit-asset-files/plan.md) gains "Appendix: Behaviour Specification": the full C-xx / A-xx catalogue with statuses, the four flow charts, the changes built, decisions D1–D7 and the live-test list. Its sections are renumbered B1–B10.
  - The main body of `plan.md` is updated to match: status line, summary, scope, assumptions A5 and A8–A10, affected areas, `publishedAt` on `GET ?ids=`, risks 9–10, sequencing S9–S11.
  - [`requirement.md`](../docs/tasks/toolkit-asset-files/requirement.md) gains "How the assistant behaves": the same rules in plain language (what counts as an asset, asking contributors, adopter fit levels, evidence handling, dates), plus a risk line that these rules are AI instructions needing live tests.
- Code comments in `lib/toolkit-assets.ts` and `lib/system-prompts.ts` now point to `plan.md` B7 / B9.

### 2026-10-08 · Code checked against the requirement.md flow charts; 2 gaps fixed, targeted ask rebuilt (code complete, not live-tested)
A node-by-node check of the code against the contributor and adopter flow charts in `requirement.md` found three gaps:
1. **Admin "Changes needed" couldn't drop an asset.** There was no way to remove a shared asset, and assemble re-lists every consented asset on each Send for Review.
2. **"No shared toolkit files match this yet" never reached the model when no assets exist.** The rule lived inside the asset block, which was left out when the asset list was empty. That covers every curated pathway in `/explore`, and `/analyse` before anything is published.
3. **The targeted ask almost never fired.** It was prompt-only and limited to step-4 turns with `pathwayAction: "none"`. Most step-4 turns are revise or publish, so a document that named a checklist in its text was rarely followed up.

**Done**
- **Fix 1:** `DELETE /api/toolkit-assets/[id]`.
  - Only the uploader can remove an asset, and only while it is unpublished. Anyone else gets a 404.
  - The row is deleted first, guarded on `published_at is null`, so a publish racing the delete gets a 409 and its file is never removed. The storage object is removed after the row.
  - If the asset was already sent for review, it is also taken out of `pathways.content_cache` (the copy the admin reviews and publishes). The committed GitHub copy catches up on the next Send for Review.
  - `ToolkitAssetStatusList` has a Remove action on unpublished rows, with a confirm dialog and toasts.
- **Fix 2:** `noToolkitAssetsRule()`. When no assets exist, `/analyse` and `/explore` still get the explicit-ask rule ("No shared toolkit files match this yet", optionally pointing to a toolkit described only in text). `/explore` is also told never to write the tag.
- **Targeted ask, rebuilt to be deterministic:**
  - The contributor companion reports `toolkitAssetMentions` (`[{ name, mentionedIn }]`) on the turn it reads material that names a reusable artifact that wasn't attached. It does this even when it judged the uploaded document itself to be background material.
  - It sets `toolkitAssetAskDeclined: true` when the contributor says they have nothing to attach.
  - Both are stored on the assistant message, so they survive a reload.
  - `appendPathwayDocMessage` asks under the draft (the first draft and any revision), naming each artifact once, up to 5 per ask. On the first draft the general "any other asset" question is folded in, so the contributor gets one question. After a decline, nothing is asked again.
  - The companion no longer asks in its own prose.
  - The order is now: material names an artifact → the app asks by name under the draft; nothing named → the general ask on the first draft. This matches the chart's E → F / E → G split.

**Verified**
- `tsc` clean. `eslint` on the changed files shows only the 2 pre-existing `exhaustive-deps` warnings.
- Scratch checks (outside the repo), all as expected:
  - `toolkitAssetMentions` parsing (object, bare string, empty name dropped)
  - the ask text
  - `pendingAssetMentions`: consent-card name excluded, already-asked excluded, new mention picked up, decline stops everything
  - re-applying the asset block without a removed id

**Open**
- Live test (💲 model behaviour):
  - a report that names a checklist in its text is followed by the by-name ask under the first draft
  - a "no" stops later asks
  - asking for templates on a curated `/explore` pathway gets the "No shared toolkit files" line
  - Remove on a sent asset updates the admin review card

### 2026-10-08 · New contributor flow implemented (code complete, not live-tested; no migration)
The owner redrew the contributor flow (see `requirement.md` → Flow charts) and asked for it to be built.

**Owner decisions**
- Upfront consent is a notice only. The Terms acceptance at registration is the consent of record.
- Assets stay **all-or-nothing** with the pathway (N3 unchanged).
- The admin review round-trip was dropped after a first draft. Not built: an events table, in-app change requests or rejection, the reply time limit and reminders, and contributor withdrawal. The admin side stays Publish / Delete, with change requests handled out of band; the contributor can Remove an asset.

**Done**
- **Opening notice:** `CONTRIBUTOR_OPENING_MESSAGE` explains how material is used, that nothing goes public without consent and admin approval, and that progress is saved.
- **Contributor prompt, now 5 steps:**
  1. Wait for material.
  2. Sufficiency check.
  3. Questions about the journey, one per turn. No fixed number (an initial cap of 5 was removed at the owner's request): Cube asks only what the material leaves unclear, and stops when the journey is understood or the contributor asks to skip. "Don't know" or "rather not say" is recorded as a gap and never re-asked.
  4. Stage confirmation.
  5. `pathwayAction: "generate"`.

  The publish ack now points to the confirmation card. The draft prompt gains rule 7: declined answers become "Not documented in the source" and Section 2 open questions.
- **Resource review card** (`ResourceReviewCard`, state on `Message.resourceReview`):
  - Candidates and mentions are kept on each companion reply (`Message.toolkitAssetCandidates` / `toolkitAssetMentions`). The stage confirmation's "generate" opens the first review instead of drafting, and finishing that review generates the first draft.
  - Per item: **Share** with the consent statement (right to share, plus public download once approved) → upload and register. **Attach it / paste a link** for a mentioned item: the file goes through the normal upload path and is sent automatically once read, the companion checks it, and `mergeIntoReview` either attaches the resulting candidate or marks the item "background material only". **Don't share** records the decision.
  - When everything is decided, the card asks once for any other resource. Resources found after the first review get a new card with only the new items. Nothing is asked about twice (`reviewedResourceKeys` also counts legacy consent cards).
- **Personal-data flag:** candidates carry `sensitiveNote`, shown on the resource review card before the contributor agrees. It is not stored: a draft migration 0035 (`contribution_units.sensitive_note`, to show it to the admin) was dropped at the owner's request, so the feature needs no database change.
- **Publish consent** (`PublishConsentCard`): every Send for Review (pane button or chat) first asks "accurate, and may it be published to help future adopters?" with three answers:
  - Yes → sent for review.
  - Keep private → nothing sent.
  - Delete → `DELETE /api/contributions/[designId]` removes the workspace, its drafts, and the contributor's not-yet-live assets (files, rows, and review copy), and clears the pathway's pointers to the drafts, including any pending review.
  
  The outcome message now says "Sent for review" (it said "Published — it's live now", which was wrong).
- **Publish email:** when an admin publishes, the contributor whose draft was approved is emailed which assets went live and which wait for the next round. Best-effort; a failure is logged only.
- **Replaced:** the per-candidate consent cards (kept only to render older conversations), the by-name ask under the draft, and `toolkitAssetAskDeclined`.

**Verified**
- `tsc` clean and `npm run build` passes.
- `eslint`: no new errors. The 2 `set-state-in-effect` errors and the unused-variable warning in `AdoptionWorkspace.tsx`, and the `exhaustive-deps` warnings in `adoption-conversation.ts`, were already there.
- Scratch checks:
  - `sensitiveNote` parsing
  - a candidate wins over a same-name mention
  - an attached file takes its candidate
  - an attached link the check didn't list → background
  - already-reviewed keys are never re-added
  - the history text for a review card
- The requirement flowchart parses with `mermaid`.

**Open**
- Live test (💲 model behaviour):
  - the question loop (stops on its own, and on "skip") and gaps
  - a report that names a checklist → mention item → attach → check → share
  - an unreadable file
  - a link
  - a resource added after the draft
  - keep-private and delete
  - the publish email


### 2026-10-08 · Contribute grid: Publish and Delete on each card (code complete, not live-tested; no migration)

**Asked:** the owner wanted Delete on each `/contribute` card, and a Publish option too.

**Done**
- **Status badge on each card:**
  - *Published*: the slug is in `published_pathways`.
  - *Published · update in review*: published, and `review_requested` is set.
  - *In review*: not published yet, and `review_requested` is set.
  - *Draft*: the contributor has a workspace and neither of the above applies.
- `GET /api/pathways` now returns `isPublished` and `reviewRequested`.
- **Publish / Republish:** shown when the contributor has a workspace and nothing is waiting for review. It opens the chat with the existing "Ready to send for review?" card already raised (the new `requestPublishOnOpen` prop on `AdoptionWorkspace`), so it goes through the same consent → admin-review path. Nothing goes live directly.
- **Delete:** opens a confirm dialog. It then:
  1. calls `DELETE /api/contributions/[designId]` for each of the contributor's workspaces on that pathway;
  2. calls the new `DELETE /api/pathways/[id]/join` to leave the pathway, so the card disappears. This uses the service role because 0021 has no delete policy on `pathway_contributors`, and it is scoped to the caller's own row.

  Published content stays live.
- When you go back from a chat to the grid, the pathways list is fetched again, so the badges update.

**Verified**
- `tsc` clean.
- `eslint`: no new findings. The `set-state-in-effect` errors in `AdoptionWorkspace.tsx` and the unused `req` warning in `pathways/route.ts` were already there.

**Open**
- Live test:
  - Delete on a card with a workspace, and on a "Not started yet" card
  - Publish when there is no draft yet (the consent card should show the assemble error)
  - Republish on a published pathway
- Decision for the owner: leaving a published pathway removes the contributor's org badge from it, because org attribution comes from `pathway_contributors`.

### 2026-10-08 · Contribute grid follow-up: Publish removed; no Delete on published cards

**Asked:** the owner asked to remove the Publish/Republish card button, keep only Delete, and not offer Delete on a published pathway.

**Done**
- Removed the card's Publish/Republish button. Removed the `requestPublishOnOpen` prop from `AdoptionWorkspace` too, since nothing uses it now. Publishing works as before, from inside the chat.
- Delete is hidden on any card with `isPublished`. That includes *Published · update in review*.
- Status badges are unchanged.
- This resolves the earlier attribution question: a published pathway can no longer be left from the grid.

**Verified**
- `tsc` clean.
- `eslint` clean on `ContributeGrid.tsx`.

### 2026-10-08 · Workspace header tidied (UI only)

**Asked:** the owner said the deployment description at the top of the chat didn't look good. It was a coral sentence plus a large block of scrolling text.

**Done** (`AdoptionWorkspace.tsx`)
- Sector and geography are now small grey mono tags. Stage is a coral tag.
- The summary is now smaller muted text, cut to 2 lines, with a *Show more / Show less* link when it runs past about 160 characters.
- The title and its ▾ collapse toggle are unchanged.

**Verified**
- `tsc` clean.
- `eslint`: only the existing errors and warning in this file.
- Not checked visually yet.

### 2026-10-08 · A resource uploaded in chat now gets its own new card (code complete, not live-tested; no migration)

**Owner's report:** after the draft, they uploaded 2 files in chat. The Cube correctly picked up `01_A4KIOSK_Printing_Troubleshooting_Guide.pdf` as reusable, but it went into the older review card further up, which was still open. It should have been a fresh "share or don't share?" ask right below the upload.

**Cause:** `routeResourceFindings` folded every turn's findings into whichever review card was still open, however far up it was.

**Fix** (`lib/adoption-conversation.ts`)
- An open card only takes this turn's findings when the turn came from that card, meaning something attached from the card is waiting for this check (`attachedSource`).
- Otherwise, once a review has started, findings go into a **new card at the bottom**, even if an older card is still open. This uses the new pure helper `takeFindingsForFreshReview`.
- If an older open card has a pending mention whose name matches this turn's file or link, that item moves to the new card with the file attached, so it is never asked about twice.
- Already-decided resources are still never re-asked.
- The new card is written in a single `commitMessages` call that stays pure.

**Verified**
- `tsc` clean.
- `eslint`: only the existing `exhaustive-deps` warnings.
- Scratch test (`tsx`), 5/5 pass:
  - a chat upload gets a new item
  - the old card is left untouched
  - a pending same-name mention moves with its candidate and `mentionedIn`
  - it is removed from the old card
  - an already-declined file is not re-asked

**Open**
- Live re-test of the owner's scenario.
- Requirement.md line 46 already says a resource that turns up after the draft gets a new card for just those items, so the code now matches it. No doc change needed.

### 2026-10-08 · Share is now one click, with a one-line public note (UI only)

**Asked:** the owner didn't want to be asked twice (Share, then "Yes, share publicly"). They wanted a single Share click and a one-line note saying shared items are public.

**Done**
- In `ResourceReviewCard.tsx`, the Share button now shares straight away and shows *Sharing…* while it works. The confirm step and its Back button are gone.
- A one-line note under Share / Don't share keeps the rights and public-download wording: "Shared resources are public: anyone can download them once an admin approves this pathway. Only share what you have the right to share."
- Updated the comment on `decideResourceItem`.

**Verified**
- `tsc` clean.
- `eslint` clean on the card.

### 2026-10-09 · Draft first, then questions, then the resource review (code complete, not live-tested; no migration)

**Asked:** the owner wanted the pathway drafted from the uploaded documents before anything about reusable assets.
- A first pass drafted with no questions or stage check at all.
- The owner then set the order. The Cube reads the documents and asks for the stage only if they don't state it. It drafts the pathway, then asks the journey questions it used to ask before the draft, then shows the reusable-resources card.
- **Owner decisions:**
  - Questions come before the resources card.
  - Answers are folded into the draft in one revision when the questions end, not after each answer.

**Done**
- **Contributor prompt** (`contributorSystemPrompt`, `lib/system-prompts.ts`) has 6 steps:
  1. Wait for material.
  2. Sufficiency check.
  3. Stage. If the material states it explicitly (or the existing published document does, and nothing contradicts it), there's no question. Otherwise the Cube offers its read to confirm, or the four options when it has none.
  4. `"generate"`.
  5. Journey questions under the first draft. One per turn, `pathwayAction: "none"` while they run, the same rules as the old pre-draft loop, and skippable. They end with the new `pathwayAction: "questions-done"`, whose instruction paraphrases what the answers add (empty if nothing).
  6. The revise/publish loop. Filling a gap or correcting the stage → `revise`.
- **`ParsedGridUpdate.pathwayAction`** (`lib/grid-update.ts`) gains `'questions-done'`. The contract text defines it, and "generate" now fires once the stage is settled.
- **Client** (`lib/adoption-conversation.ts`):
  - **`"generate"`:** drafts, then shows the draft with its gap list and no closing question.
    - For the first real draft, it then sends `FIRST_DRAFT_READY_NOTE` as a **hidden** user message (new `Message.hidden`; `ChatPanel` skips it). The companion then asks question 1 right under the draft, with no typing from the contributor.
    - The drafter's "Not enough…" fallback doesn't count as a first draft.
  - **`"questions-done"`:** if the instruction isn't empty, revises once ("Here's the pathway document updated with your answers. Next, a quick check below on the reusable resources…"). It then adds the first resource review (`appendFirstResourceReview`) in the same `commitMessages`.
    - That review collects every candidate and mention found so far.
    - If a review already exists (older conversation), it only revises.
  - **The first review card's "No, that's all"** (`followsFirstDraft`) closes it and asks "Do you want to make any changes to the draft, or send it for review?". It thanks the contributor first if they shared anything.
  - **Findings wait:** findings from chat turns wait on their message until the first review exists. Before this, a file uploaded mid-questions got its own card early, and the main review never appeared.
  - **`commitMessages` keeps `conversationRef` current synchronously**, so the hidden turn's history includes the draft message.
  - **A contributor conversation that already has a resource review** is sent to the companion as step 6, at least. This covers older conversations whose numbering had the loop at step 5, which is now the questions step.
  - **Removed:** `startFirstResourceReview` and `appendResourceReview`.
- **`ResourceReviewState.followsFirstDraft`** (`lib/toolkit-assets.ts`) is new and optional. `generateOnComplete` is kept for older conversations: an open pre-draft card still drafts when finished, and `"generate"` waits for it.
- **Copy:**
  - The opening notice describes the new order.
  - The card subtitle says the items could be reused by other teams.
- **`requirement.md`:** the contributor rules and the flow chart are updated (Material → Stage → Draft → Questions → Resource review → Consent → Review → Publish).

**Verified**
- `tsc` clean.
- `eslint`: no new findings. The 2 `set-state-in-effect` errors and the unused-variable warning in `AdoptionWorkspace.tsx`, and the 2 `exhaustive-deps` warnings in `adoption-conversation.ts`, were already there.
- Scratch check (`tsx`), 10/10 pass:
  - "step 4 of 6"
  - six-step heading
  - stage asked only when not stated
  - questions after the first draft
  - no per-answer revise
  - `questions-done` in the contract, and `parseGridUpdate` passes it through with its instruction
  - `flowStep` range 1–6
  - the existing-document stage clause appears only when there is a published document
  - the old text is gone
- All 3 flow charts in `requirement.md` parse with `mermaid` 11.4.1.

**Open**
- Live test (💲 model behaviour):
  - a document stating "Pilot" → no stage question
  - a document without a stage → confirm question
  - the draft, then question 1 appearing under it with no visible user message
  - "skip" → `questions-done` with no revision, then the card
  - answers → one revision, then the card
  - a file uploaded mid-questions → shows up on the first card, not its own
  - "No, that's all" → the closing question
  - an older conversation in the loop isn't asked questions
- The hidden turn adds one companion call after every first draft (💲 small).
- Wiki refresh: `integrations/ai-llm.md` and `business/workflows.md` still describe the old pre-draft question flow.

### 2026-10-09 · Resource review card: simpler wording, "anything else" in its own box (UI only)

**Owner's report:** the "Do you have any other resource…" question sat right under the item list and read as part of it, and the card's wording was confusing.

**Done** (`ResourceReviewCard.tsx`)
- "Anything else to share?" is now a separate shaded box, with one help line: "A template, checklist, tool or link that other teams could use."
- **Plainer wording:**

  | Element | Was | Now |
  |---|---|---|
  | Title | Reusable resources | Files other teams can reuse |
  | Subtitle | — | "We found these in your documents. Choose Share or Don't share for each one." |
  | Empty state | — | "We didn't find any reusable files (like a template, checklist or tool) in your documents." |
  | Note under Share | — | "Once an admin approves this pathway, anyone can download what you share. Only share files you're allowed to share." |
  | Badges | — | *Shared · public after approval*, *Not shared*, *Used for the pathway only* |
  | Buttons | Attach a file / Attach it, Paste a link | *Add a file* / *Add the file*, *Add a link* |
  | Finish button | No, that's all | No, I'm done |
  | Footer | Resource review complete. | All done. |

- The Cube's line after a file is attached from the card is now "Thanks — choose Share or Don't share for it below." (prompt example in `system-prompts.ts`).
- The history text the model reads (`resourceReviewContent`) is unchanged.

**Verified**
- `tsc` clean. `eslint` clean on the card and the prompt file.
- The `requirement.md` flow chart label was updated to match ("Add the file / link").
- Not checked visually yet.

### 2026-10-09 · Drafting no longer freezes the chat (code complete, not live-tested; no migration)

**Owner's report:** while "Generating document…" showed, everything was stuck: typing, the card's buttons ("Anything else to share?"), all of it.

**Cause:** `sendMessage` awaited the whole draft generation (`handlePathwayAction`) before `setLoading(false)`, and `loading` disables the composer and every card. Drafting is the slowest call in the app.

**Done**
- **`lib/adoption-conversation.ts`**
  - `generate`, `questions-done` and `revise` now run through `runDraftJob`, a queue that is not awaited by the chat turn, so the chat unlocks as soon as the Cube's reply ends. Drafts still run one at a time.
  - `publish` stays awaited, since it only raises a card.
  - `sendMessage` now wraps the old body (`runTurn`) and tracks the turn in flight in `turnRef`. A finished draft is added to the chat only after `afterCurrentTurn()`, because a turn streams into the last message and would otherwise overwrite the draft message.
  - The hidden "first draft is ready" turn starts the same way.
  - Send for Review (`answerPublishConsent` → send) waits for any draft still being written, so the latest version is sent.
  - The legacy pre-draft card's "draft my pathway" also runs in the background now.
- **`ChatPanel` / `AdoptionWorkspace`:** the new `writingDraft` prop shows "Writing the pathway document… you can keep going meanwhile." as a non-blocking note. `generatingDoc` now covers explorer documents only, which still block as before.

**Verified**
- `tsc` clean.
- `eslint`: no new findings. Only the existing 2 errors and 1 warning in `AdoptionWorkspace.tsx` and the 2 `exhaustive-deps` warnings remain.

**Open**
- Live test:
  - type and send while a draft is being written
  - click card buttons meanwhile
  - a revise requested during a draft queues behind it
  - Send for Review clicked mid-draft sends the new draft
  - the first-draft question still appears under the draft
