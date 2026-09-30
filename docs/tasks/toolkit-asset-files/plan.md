# Plan: Store Toolkit Asset Files and Surface Them in `/analyse` and `/explore`

> Status: **Approved 2026-09-30** (Stage 3 of `brd-task-creator`), with N1–N3 answered. This supersedes both earlier versions. Decision history is in [`clarifications.md`](clarifications.md); build tasks are in [`task-list.md`](task-list.md).

## Summary

Contributors can attach real toolkit asset files (PDF, Word, PowerPoint, Excel, CSV/TXT/MD, images) or https links inside their `/contribute` workspace. The contributor companion flags uploads that genuinely look like reusable assets, and the contributor answers one explicit question: **"OK to share this publicly?"** Yes stores the file privately in Supabase Storage and records it in `contribution_units`. No stores nothing.

Assets are **reviewed and published with their pathway**:
- **Send for Review** (assemble) writes a generated "Toolkit asset files" block into the pathway document, so the admin reviews the assets as part of the pathway.
- **Admin publish** publishes exactly the assets listed in that reviewed document.

Published assets are **public**: anyone can view and download them, signed in or not. **Claude surfaces them in conversation** in both places:
- **`/analyse`:** the companion returns asset IDs in `<grid_update>` and the client renders download cards.
- **`/explore`:** after some exchanges in a pathway's chat, Claude says "these are the assets associated with this pathway". Its reply carries a trailing asset-ID tag that the client renders as download cards.

## Scope

**In scope**
- Contributor-only attach: pdf, doc, docx, ppt, pptx, xls, xlsx, csv, txt, md, png, jpg/jpeg, gif, webp, up to 25 MB; plus https links. **No ZIP.**
- AI identification plus a single explicit **public-sharing** consent question
- Private Supabase Storage bucket, created in the migration, with Supabase-enforced size and MIME limits
- Asset records in `contribution_units` (`unit_type='toolkit-asset'`)
- Generated asset block in the pathway document at assemble time (GitHub `.md`, `content_cache`, then `published_pathways` on admin publish)
- Publish-with-pathway, bound to the asset IDs in the reviewed document
- Admin pathway card lists the pathway's assets with preview links
- **Conversational** surfacing in `/analyse` (companion) and `/explore` (library pathway chat), as validated download cards
- **Public** download and metadata for published assets
- Storage cleanup when a pathway or an account is deleted
- `content/framework.md` rows for Playbook and Toolkit Asset (a dependency for AI identification)
- Fixes for security findings in code this feature touches: #2 (library `pathwayId` traversal), #4 (slug → GitHub path), #6 (assemble `designId` ownership)

**Out of scope**
- ZIP, licence field, admin uploads, backfill of the 36 corpus-described assets
- Per-asset approve/reject/exclude at publish (N3), revoke/unpublish
- A fixed UI asset list (N2 chose conversation-only), the Analysis Document, `/wiki` pages
- Assets on the library **overview** chat (no specific pathway) or on static curated pathways (no `pathways` row)
- Rate limiting of downloads (flagged as a risk; see security finding #3)
- Enhancements (see the Future Upgrade Roadmap)

## Assumptions

- **A1.** The file is uploaded only after the contributor answers Yes. Until then it's held in browser memory; a reload means re-attaching.
- **A2.** An asset belongs to a `pathways` row, not a unit number.
- **A3.** Contributors see each asset as **Awaiting pathway review** or **Published**.
- **A4 (N1).** Published assets are public: the download and metadata routes need no session. Unpublished assets can be previewed only by their uploader and by admins.
- **A5 (N2).** "After some chats" in `/explore` means: **never on the kickoff overview turn**; at the earliest on the visitor's second message, or immediately when the visitor asks about tools, templates, resources, files, or how to reuse or implement the pathway. Assets are mentioned when relevant, without being repeated every turn.
- **A6 (N3).** Publishing publishes every asset listed in the reviewed document. Assets attached after the last Send for Review go out on the next assemble plus publish.
- **A7.** Files are stored in the private bucket at consent time (so the admin can preview them) and are served only through the app's download route, via 60 s signed URLs, once published.

## Affected Areas

| Area | Component(s) | Nature of change |
|---|---|---|
| Data | `supabase/migrations/0034_contribution_units_toolkit_assets.sql` (new) | Add asset columns and constraints to `contribution_units`; drop the client insert/update policies; create the private `toolkit-assets` bucket (25 MB limit, MIME allow-list) with **no** client storage policies |
| Domain logic | `lib/toolkit-assets.ts` (new) | Types, allowed extensions/MIME, path builder, `renderToolkitAssetBlock` / `applyToolkitAssetBlock`, `assetIdsInDocument`, `loadPublishedToolkitAssets({ pathwaySlug? })`, `parseToolkitAssetsTag` / `stripToolkitAssetsTag` (library replies), signed upload/download helpers (service role) |
| Domain logic | `lib/grid-update.ts` | Contributor `toolkitAssetCandidates`; explorer `toolkitAssetsReferenced` |
| Domain logic | `lib/system-prompts.ts` | `contributorSystemPrompt`: identification section; `gridUpdateContract` options; `explorerSystemPrompt`: published-assets block + surfacing rule; **`libraryPathwaySystemPrompt(document, assets)`**: the pathway's assets + timing rule + trailing-tag contract; `pathwayDraftSystemPrompt`: omit the asset block |
| Framework content | `content/framework.md` | Playbook and Toolkit Asset rows |
| Client logic | `lib/adoption-conversation.ts`, `lib/extract-text.ts` | Asset-eligible `File` retention (contributor flow); `.doc`/`.ppt` and images over 5 MB accepted as asset-only; candidates → consent card → signed upload → register; persist `toolkitAssetsReferenced` on explorer messages |
| Client logic | `app/explore/ExploreLibrary.tsx` | Strip the `<toolkit_assets>` tag from streamed library replies (never shown half-streamed), validate the IDs, render cards, persist validated IDs on the message (saved to `library_conversations` for signed-in users) |
| Routes/API | `app/api/toolkit-assets/upload-url/route.ts` (new) | `pathway_contributor` + membership + type/size → `createSignedUploadUrl` |
| Routes/API | `app/api/toolkit-assets/route.ts` (new) | POST (contributor): register a consented asset. GET `?ids=` (**public**): published-asset card metadata |
| Routes/API | `app/api/toolkit-assets/[id]/download/route.ts` (new) | **Public** for published assets → 302 to a 60 s signed URL or to `link_url`; unpublished → uploader or admin session only |
| Routes/API | `proxy.ts` | Add `/api/toolkit-assets` to `PUBLIC_PATHS`. The handlers enforce auth for the contributor POST routes, which is the repo's rule that the API route is the real gate |
| Routes/API | `app/api/pathways/assemble/route.ts` | Apply the asset block before commit/cache; validate the slug (#4); verify `designId` ownership and pathway link (#6) |
| Routes/API | `app/api/admin/pathways/publish/route.ts` | After the upsert, publish the pathway's assets whose IDs appear in the published content |
| Routes/API | `app/api/chat/route.ts` | Explorer companion: pass published assets. Library mode: validate `pathwayId` (#2); when it resolves to a DB pathway, pass that pathway's published assets to `libraryPathwaySystemPrompt` |
| Routes/API | `app/api/admin/pathways/delete/route.ts`, `app/api/account/delete/route.ts` | Remove storage objects before rows cascade / are deleted (account delete: unpublished assets only) |
| Frontend | `components/ToolkitAssetConsentCard.tsx` (new), `components/ChatPanel.tsx` | Single public-sharing consent card |
| Frontend | `components/PathwayDocumentPane.tsx` | Contributor asset status list |
| Frontend | `components/AdminPathwayRowCard.tsx`, `app/admin/page.tsx` | The pathway's assets (from `content_cache` markers), with preview links and a "not scanned" label |
| Frontend | `components/ToolkitAssetCard.tsx` (new) | Shared download card used by `ChatPanel` (`/analyse`) and `ExploreLibrary` (`/explore`) |

## Architectural Approach

**1. Where it lives.** Everything sits inside the existing Contributor → assemble → admin publish pipeline. Assets ride the same two-step gate as the pathway document, and the only new platform piece is Supabase Storage (same vendor, same service-role client). Surfacing reuses the one pattern the app already has for "the model mentions it, the client renders it" (`pathwaysReferenced`), in both chats.

**2. The model signals, the client acts.**
- **Contributor:** the companion adds `toolkitAssetCandidates` to `<grid_update>`. The client shows a card: **"OK to share this publicly? Anyone using 100 Pathways, including visitors who aren't signed in, will be able to download it."** Yes / No. Yes means upload and register, storing `share_consent` and `share_consented_at`; No means nothing is stored.
- **`/analyse`:** the companion adds `toolkitAssetsReferenced: [id]`. The client validates the IDs via public `GET /api/toolkit-assets?ids=`, renders cards, and persists the IDs.
- **`/explore`:** `libraryPathwaySystemPrompt` receives that pathway's published assets and the A5 timing rule. When it mentions them ("these are the assets associated with this pathway"), the reply ends with `<toolkit_assets>["asset-…"]</toolkit_assets>`. `ExploreLibrary` hides the tag from the moment it starts streaming, then keeps only IDs that are published **and** belong to the open pathway, and renders cards. The model never writes a URL in either chat.

**3. Identification needs the definition present.** `framework.md`'s unit-type table (`:294-300`) lacks Playbook and Toolkit Asset, and it is the file the contributor prompt injects.

**4. Upload path.**
1. `upload-url` checks role, membership, extension and size, then calls `createSignedUploadUrl('<pathwayId>/<uuid>/<safe-name>')` with the service role.
2. The browser calls `uploadToSignedUrl` directly (avoiding the ~4.5 MB Vercel body limit). The bucket's `file_size_limit` and `allowed_mime_types` enforce limits at Supabase.
3. Register checks that the object exists under that pathway's prefix, then inserts the row (service role).

There are no client storage policies. Every read goes through the download route.

**5. Records.** One `contribution_units` row per asset:
- `section='micro-innovation'`, `unit_type='toolkit-asset'`
- `unit_internal_id='asset-<uuid>'`
- `published_at` is null until its pathway is published

**6. Publish-with-pathway, bound to what was reviewed.**
- **Assemble:** applies the block (`<!-- toolkit-assets:start/end -->`, one `<!-- asset-id: … -->` entry per consented asset with name, kind, purpose and reuse condition, no URL) at the end of Section 4 (falling back to before Source Trace), then writes GitHub and `content_cache`.
- **Admin publish:** after the upsert, sets `published_at = now()` for this pathway's unpublished assets whose IDs are in `assetIdsInDocument(content_cache)`.
- The draft prompt omits the block and assemble regenerates it, so the model can neither drop nor forge entries.

**7. Public access (N1).** The download route serves published assets without a session. It mints a fresh 60 s signed URL per request and redirects, so there is no permanent public object URL, and the bucket stays private. Asset IDs are already visible in the public `published_pathways.content` markers, which is acceptable because the assets are public by consent.

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Public-read bucket (direct object URLs) | Simpler, but gives permanent URLs that stay live after a pathway or account is deleted and until the object is removed. It also exposes unpublished files if a path leaks. Route-minted signed URLs keep a single check (published or not) in app code. |
| Fixed "Toolkit assets" UI list in `/explore` | Rejected by the requester (N2: conversational only). |
| Add a `<grid_update>` contract to library chat | Heavier than needed: library chat has no grid. A single-purpose trailing tag is minimal and mirrors `<deliverable>` / `<grid_update>` handling. |
| Per-asset admin approval | Reversed by the requester (assets ride the pathway gate). |
| Publish all of the pathway's unpublished assets on publish | Would publish assets the admin never saw (TOCTOU). Binding to the reviewed document's IDs avoids this. |
| AWS S3 | Replaced by Supabase Storage. |
| Keep "all adopters" consent wording | Inaccurate once downloads are public (N1). Informed consent needs the public wording. |

## Key Tradeoffs

**Tradeoff: public assets (N1)**
- Gained: frictionless reuse and discovery for anyone.
- Given up: contributor files are downloadable by the whole internet. Egress costs can be abused because there is no rate limit (security finding #3), and scraping is possible. Consent wording must say "public", and the Terms need checking.

**Tradeoff: conversational-only surfacing (N2)**
- Gained: assets appear in context, only when relevant.
- Given up: discovery depends on the model following the timing rule. A visitor who never chats past the kickoff won't see assets. No new AI call is added, but the library prompt grows by the pathway's asset list.

**Tradeoff: assets ride the pathway gate (N3)**
- Gained: one review step, and assets always match a reviewed document.
- Given up: no per-asset reject. Late-added assets wait for the next round.

**Tradeoff: consent-then-upload with in-memory retention**
- Gained: nothing stored without consent.
- Given up: a reload before answering loses the file.

## Non-Functional Impact

- **Performance/scale:**
  - One indexed query per explorer companion turn and per library pathway turn.
  - One small `?ids=` call per reply that references assets.
  - Roughly 50 prompt tokens per asset: across all published assets in explorer turns, but only the open pathway's in library turns.
  - File bytes never pass through the app.
- **Availability/failure modes:**
  - Storage errors surface as handled errors on upload or download; chats keep working.
  - Upload succeeds but register fails: the orphan object is tolerated.
  - Publish succeeds but asset flagging fails: re-publishing is idempotent and retries.
  - A malformed or missing `<toolkit_assets>` tag means no cards and no crash.
  - No new Anthropic call is introduced (TD-05 unchanged).
- **Security:**
  - Private bucket with no client policies. Paths are server-built with sanitised names, and Supabase enforces size and MIME limits. Links must be https.
  - Unpublished assets are readable only by the uploader or an admin.
  - `contribution_units` client write policies are dropped (#8 for this table).
  - Security findings #2, #4 and #6 are fixed in the code this work touches.
  - **Public downloads have no rate limit, and there is no malware or PII scan.** Both are flagged below.
- **Consistency/coupling:** `ToolkitAssetCard` and `lib/toolkit-assets.ts` are shared across both chats. Library chat gains a dependency on `contribution_units`.

## Data Model / API Changes

**Migration `0034_contribution_units_toolkit_assets.sql`** (additive except the policy drop, and the header says so):
- New columns: `asset_kind` (file|link), `asset_name`, `purpose`, `reuse_condition`, `storage_path`, `file_name`, `mime_type`, `size_bytes`, `link_url`, `share_consent` (default false), `share_consented_at`.
- Toolkit-asset checks: `asset_kind` required; file ⇒ `storage_path`; link ⇒ `link_url`; `share_consent = true`.
- Partial index `(pathway_id, published_at) where unit_type = 'toolkit-asset'`.
- Drop the two client write policies.
- `insert into storage.buckets (..., public = false, file_size_limit = 26214400, allowed_mime_types = […])`, with no `storage.objects` policies.

**Routes**

| Method | Path | Auth | Request → Response |
|---|---|---|---|
| POST | `/api/toolkit-assets/upload-url` | `pathway_contributor` + membership | `{pathwayId, fileName, size, mimeType}` → `{path, token}` |
| POST | `/api/toolkit-assets` | `pathway_contributor` + membership | `{pathwayId, designId, kind, storagePath?, linkUrl?, fileName?, name, purpose, reuseCondition, dimension?, stage?, shareConsent: true}` → `{id, status:'awaiting_pathway_review'}` |
| GET | `/api/toolkit-assets?ids=` | **public** | Published assets only: `[{id, name, purpose, kind, fileName?, sizeBytes?, linkDomain?, pathwaySlug, pathwayTitle}]`; max 20 |
| GET | `/api/toolkit-assets/[id]/download` | **public** if published; uploader/admin otherwise | 302 → 60 s signed URL or `link_url`; 404 otherwise |

Changed: `POST /api/pathways/assemble`, `POST /api/admin/pathways/publish`, `POST /api/chat` (library: `pathwayId` validation and assets in prompt), `proxy.ts` `PUBLIC_PATHS`.

**Model contracts:**
- contributor `<grid_update>`: `toolkitAssetCandidates[]`
- explorer `<grid_update>`: `toolkitAssetsReferenced[]`
- library reply: optional trailing `<toolkit_assets>[ids]</toolkit_assets>`

## Risks & Open Items

1. **Public downloads with no rate limit:** egress-cost abuse and scraping. Recommend reusing whatever limiter is built for security finding #3; not in this scope unless requested.
2. **Consent and legal:** public sharing of contributor files should be checked against `content/legal/terms.md` (the contributor content licence) before launch. The consent wording in §2 is a proposal for that review.
3. **No malware or PII screening.** Files become public on pathway approval. The admin card labels them "not scanned", and the admin preview is the only check.
4. **Conversational-only discovery (N2)** depends on the model following the timing rule. Verify during testing; a fixed list stays on the roadmap as a fallback.
5. **Late-added assets** wait for the next round (A6). The contributor status list must make that clear.
6. **Static curated pathways can't carry assets.** The MahaVISTAAR example needs a DB pathway (slug collision with the static file is pre-existing and flagged).
7. **TD-16:** the Anthropic account expires 28-Oct-2026. Identification and both chats' surfacing depend on it; upload, publish and download do not. No hard date.
8. **Wiki refresh** after landing.

## Sequencing

1. **S1** Migration `0034` + `lib/toolkit-assets.ts`
2. **S2** `framework.md` rows + contributor identification + `toolkitAssetCandidates`
3. **S3** Contributor client: retention, asset-only types, consent card, upload-url + register, status list
4. **S4** Assemble (block + #4/#6) and admin publish (asset publishing) + admin card list + draft-prompt instruction
5. **S5** Public download route + public `GET ?ids=` + `proxy.ts`
6. **S6** `/analyse` surfacing
7. **S7** `/explore` surfacing (library prompt + tag + cards) + `pathwayId` validation (#2)
8. **S8** Storage cleanup on deletes

## Future Upgrade Roadmap (documentation only)

1. Structured metadata aligned to the company-brain toolkit schema
2. Toolkit Catalogue page, or a fixed per-pathway asset list (fallback for N2)
3. "Adapt this for me" AI mode
4. Reuse signals: download counts and "this helped" feedback (the Incentivize / Usage & Reuse milestones). The public download route is where to count.
5. Versioning, supersession, revoke/unpublish, per-asset exclusion at publish
6. Gap-matched suggestions and an Analysis Document section
7. Upload safety (malware, PII) and download rate limiting
8. ZIP support; backfill of the corpus-described assets; assets for static curated pathways
