# Task List: Toolkit Asset Files

Stage 4 of `brd-task-creator`, derived from the approved [`plan.md`](plan.md) (2026-09-30). This supersedes the 2026-09-29 S3 / per-asset-approval task list.

> **Testing note.** This repo has **no automated test suite** (no test runner, no CI test job). Every case below is a **manual verification step**: a concrete action and an observable result in the running app, in Supabase (tables or Storage), or on GitHub. Cases marked 💲 call the real Anthropic API, write to real Storage, or commit to GitHub. Run them on a dev Supabase project and a scratch `GITHUB_BRANCH`.

## Dependency overview

```
TA-01 (migration + bucket + lib) ─► TA-02 (identify) ─► TA-03 (consent + submit) ─► TA-04 (status list)
                                                             │
                                                             └─► TA-05 (assemble block + #4/#6) ─► TA-06 (publish with pathway + admin list)
TA-01 ─► TA-07 (public download + ids API + proxy) ─► TA-08 (/analyse cards)
                                                   └─► TA-09 (/explore cards + #2)
TA-01 ─► TA-10 (cleanup on deletes)          TA-11 (docs + wiki) last
```

---

### TA-01: Migration 0034, private Storage bucket, and core library

**As a** Solution Team engineer
**I want** `contribution_units` extended for toolkit assets, a private bucket with enforced limits, and one shared asset library
**So that** every later story stores and reads assets one consistent, secure way

**Priority:** P0 · **Depends on:** None

**Acceptance Criteria:**
- Given `supabase/migrations/0034_contribution_units_toolkit_assets.sql`, then:
  - Its header comment states its purpose and that dropping the client write policies is the only non-additive change.
  - It adds `asset_kind` (check file|link), `asset_name`, `purpose`, `reuse_condition`, `storage_path`, `file_name`, `mime_type`, `size_bytes`, `link_url`, `share_consent` (default false), `share_consented_at`.
  - It adds a partial index on `(pathway_id, published_at) where unit_type='toolkit-asset'`.
- Given a `unit_type='toolkit-asset'` row, when it's written with `share_consent=false`, a null `asset_kind`, `file` kind without `storage_path`, or `link` kind without `link_url`, then the check constraint rejects it.
- Given the migration is applied, when an authenticated browser client tries `insert`/`update` on `contribution_units`, then RLS denies it. The select policy (own + published) is unchanged.
- Given the migration, then bucket `toolkit-assets` exists with `public=false`, `file_size_limit=26214400`, and an `allowed_mime_types` list covering: pdf, msword, docx, ms-powerpoint, pptx, ms-excel, xlsx, text/csv, text/plain, text/markdown, png, jpeg, gif, webp. **No zip.** No `storage.objects` policies grant client access.
- Given `lib/toolkit-assets.ts`, then it exports:
  - `ALLOWED_ASSET_EXTENSIONS`, `MAX_ASSET_BYTES`
  - `buildAssetPath(pathwayId, fileName)`: `<pathwayId>/<uuid>/<sanitised-name>`, where sanitising strips separators, `..` and control characters
  - `renderToolkitAssetBlock`, `applyToolkitAssetBlock`, `assetIdsInDocument`
  - `loadPublishedToolkitAssets({ pathwaySlug? })`
  - `parseToolkitAssetsTag`, `stripToolkitAssetsTag`
  - service-role helpers `createUploadUrl(path)` and `createDownloadUrl(path, fileName)` (60 s, attachment disposition)
- Given `applyToolkitAssetBlock`, then it:
  - replaces only what is between `<!-- toolkit-assets:start -->`/`end` when those markers exist
  - otherwise inserts at the end of Section 4 (before the next Section 5 / 6 / "Retrieval guide" / "Source Trace" heading), falling back to before Source Trace, then to the end of the document
  - removes the block when the list is empty
  - is idempotent
- Given the rendered block, then each entry has an `<!-- asset-id: asset-<uuid> -->` marker, name, kind, purpose and reuse condition, and **no URL**.
- Given `stripToolkitAssetsTag`, then it cuts at the opening `<toolkit_assets` even when the tag is only partially streamed (same approach as `stripGridUpdate`).

**Test Plan:**
- *Positive:*
  - Apply `0034` on top of `0001`–`0033` on a dev project. It succeeds, and the bucket appears in Storage with the limits set.
  - A service-role insert of a valid file-kind row succeeds with `published_at` null.
  - `applyToolkitAssetBlock` on a copy of `content/wiki/pathways/mahavistaar.md` with two assets puts the block after the Section 4 table and before `## 6. Retrieval guide`.
- *Edge cases:*
  - Doc with no Section 4: block goes before Source Trace. Doc with neither: appended at the end.
  - Running twice gives byte-identical output. An empty list removes the block.
  - `buildAssetPath` with `../../x.pdf`, `a/b.pdf`, `résumé 2026.pdf`: none escapes `<pathwayId>/<uuid>/`.
  - `stripToolkitAssetsTag` on `"text <toolkit_as"`: returns `"text"`.
- *Negative cases:*
  - A contributor, from the browser console, runs `supabase.from('contribution_units').insert({...})` and then `update({published_at: …})` on their own row: both get an RLS error.
  - A browser `supabase.storage.from('toolkit-assets').upload(...)` or `.download(...)` with the user's JWT is denied.
  - A service-role insert with `share_consent=false` gets a check-constraint error.
- *Non-functional:*
  - The migration is additive apart from the documented policy drop.
  - 💡 `applyToolkitAssetBlock` and `parseToolkitAssetsTag` are pure string functions, strong candidates for this repo's **first automated tests**. This is a suggestion only.

---

### TA-02: Contributor companion identifies toolkit-asset candidates

**As a** contributor
**I want** the assistant to recognise when my upload or link is a genuinely reusable asset
**So that** I'm only asked about things worth sharing

**Priority:** P0 · **Depends on:** TA-01

**Acceptance Criteria:**
- Given `content/framework.md` "The five unit types", then it has **Playbook** and **Toolkit Asset** rows consistent with `content/pathway-generation-prompt.md:71-72,107-108`.
- Given `contributorSystemPrompt`, then a "Toolkit asset files" section tells the model to:
  - flag an uploaded file or https link in `toolkitAssetCandidates` **only** if it meets the Toolkit Asset bar
  - flag each file/link at most once per conversation
  - never ask the sharing question in prose (the card does)
  - make no evaluative statements (the existing no-judgment rule)
  - if the contributor explicitly asks to add a non-qualifying item, say plainly that it reads as source material rather than a reusable artifact
- Given `gridUpdateContract(..., { pathwayAction: true, toolkitAssetCandidates: true })`, then the contributor contract documents `toolkitAssetCandidates: [{ source: { fileName } | { url }, name, purpose, reuseCondition, dimension?, stage? }]`. The explorer contract does not.
- Given `parseGridUpdate`, then it passes `toolkitAssetCandidates` through and drops entries missing `source` or `name`.
- Given the **contributor** flow:
  - `.doc`/`.ppt` and images over 5 MB (up to 25 MB) are accepted as **asset-only** attachments (no text extraction); the model is told `📎 Uploaded asset file **<name>** (<type>, <size>)`
  - `.zip` stays rejected
- Given the **Explorer** flow, then the attachment rules are unchanged.

**Test Plan:**
- *Positive:*
  - 💲 A contributor uploads a checklist/template PDF: the reply's `<grid_update>` (DevTools network) has one candidate with that `fileName`.
  - 💲 A contributor pastes an https GitHub repo link describing it as their tool: a `url` candidate.
- *Edge cases:*
  - 💲 The same file uploaded twice in one conversation is flagged once.
  - A 7 MB PNG is accepted as asset-only. A `.ppt` is accepted as asset-only.
- *Negative cases:*
  - 💲 An interview transcript upload produces **no** candidate and no evaluative language.
  - 💲 An `http://` link produces no candidate.
  - A `.zip` upload in the contributor flow is rejected with the unsupported-type message.
  - `parseGridUpdate` with a candidate lacking `name` drops that entry; the rest parses.

---

### TA-03: Contributor gives public-sharing consent and submits the asset

**As a** contributor
**I want** one clear question about public sharing before anything is stored
**So that** nothing of mine becomes public without my explicit permission

**Priority:** P0 · **Depends on:** TA-01, TA-02

**Acceptance Criteria:**
- Given a companion reply with `toolkitAssetCandidates`, when streaming finishes, then the client appends a client-constructed message rendering `ToolkitAssetConsentCard` per candidate:
  - It shows the proposed name, purpose and file name / link domain.
  - It asks **"OK to share this publicly? Anyone using 100 Pathways, including visitors who aren't signed in, will be able to download it."**
  - It offers **Yes, share** / **No**.
- Given a file candidate whose `File` is no longer in memory (e.g. after a reload), then the card asks the contributor to re-attach it, and Yes is disabled.
- Given **No**, then no upload, no API call and no row happen, and the card shows "Not shared."
- Given **Yes** on a file:
  1. `POST /api/toolkit-assets/upload-url`
  2. `uploadToSignedUrl`
  3. `POST /api/toolkit-assets` with `shareConsent: true`
  4. The card shows "Added. It will go live when this pathway is approved."
- Given **Yes** on a link, then only the register call is made (`kind:'link'`).
- Given `POST /api/toolkit-assets/upload-url`, then it returns:
  - 401 with no session
  - 403 without `pathway_contributor`
  - 403 when not a member of `pathwayId`
  - 400 for a disallowed extension (incl. zip) or `size` > 25 MB
  - otherwise `{path, token}` for a server-built path under that pathway
- Given `POST /api/toolkit-assets`, then it re-checks role and membership, and returns 400 when:
  - `shareConsent !== true`
  - a file's path is outside `<pathwayId>/` or the object doesn't exist
  - a link isn't `https:`

  On success, a service-role insert creates `section='micro-innovation'`, `unit_type='toolkit-asset'`, `unit_internal_id='asset-<uuid>'`, `user_id`, `design_id`, `share_consent=true`, `share_consented_at=now()`, `published_at=null`, and a lower-cased valid `dimension`/`stage` (or null). The response is `{id, status:'awaiting_pathway_review'}`.
- Given a double-click on Yes, then only one object and one row result.

**Test Plan:**
- *Positive:*
  - 💲 Upload a checklist PDF and answer Yes. The object appears under `toolkit-assets/<pathwayId>/…`, and one `contribution_units` row has `published_at` null and `share_consent` true.
  - 💲 Link candidate, answer Yes: a link row, no object.
- *Edge cases:*
  - Answer No: no network calls, no object, no row.
  - Reload before answering: the card shows re-attach.
  - A 25 MB file succeeds. Two candidates give two independent cards. A double-click still gives one row.
- *Negative cases:*
  - `curl` upload-url with no cookie gets 401. An adopter-only user gets 403. A non-member contributor gets 403.
  - `curl` register with `shareConsent:false` gets 400. A path under another pathway gets 400. A never-uploaded path gets 400.
  - Forge a small `size`, then upload 30 MB to the signed URL: Supabase rejects it (bucket limit). Upload a `.zip` renamed `.pdf` with MIME `application/zip`: rejected by the MIME allow-list.
- *Non-functional:*
  - The card matches the brand tokens and works at 375 px.
  - Invariant: a `<grid_update>` with candidates never creates a row without a Yes click.

---

### TA-04: Contributor sees each asset's status

**As a** contributor
**I want** to see which assets are awaiting pathway review and which are live
**So that** I know what the public can download

**Priority:** P1 · **Depends on:** TA-03

**Acceptance Criteria:**
- Given `PathwayDocumentPane` for a pathway, then a "Toolkit assets" section lists the rows readable under RLS (own rows, plus others' published). Each row shows name, kind, file name/domain, and a badge:
  - **Awaiting pathway review** (`published_at` null)
  - **Published**
- Given one of the contributor's own rows, then clicking it opens a preview via the download route (the owner may preview while unpublished).
- Given a successful TA-03 submit, then the list refreshes without a reload. An empty list shows a one-line empty state.

**Test Plan:**
- *Positive:* After TA-03 the asset shows "Awaiting pathway review". After TA-06's publish it shows "Published".
- *Edge cases:* With two contributors on one pathway, A sees own pending assets plus B's published ones, not B's pending.
- *Negative cases:* A non-member querying `contribution_units` for that pathway from the console sees only published rows.

---

### TA-05: Assemble writes the asset block, validates the slug, and checks design ownership

**As a** contributor sending a pathway for review
**I want** my assets listed in the pathway document the admin reviews
**So that** the admin approves them as part of the pathway, safely

**Priority:** P0 · **Depends on:** TA-01, TA-03

**Acceptance Criteria:**
- Given `POST /api/pathways/assemble`, when the caller is not the owner of `designId`, or `designs.pathway_id ≠ pathwayId`, then it returns 403 (security finding #6). The draft is read only for that design and that caller.
- Given a pathway slug not matching `^[a-z0-9]+(-[a-z0-9]+)*$`, then assemble returns 400 before any GitHub call (security finding #4).
- Given a valid call, then the content written to GitHub and `content_cache` is `applyToolkitAssetBlock(draft, allConsentedAssetsForPathway)` (published and unpublished), and the response is unchanged in shape.
- Given `pathwayDraftSystemPrompt`, then it instructs the model to omit anything between the toolkit-assets markers.
- Given a pathway with no assets, then assemble output is byte-identical to today's.

**Test Plan:**
- *Positive:* 💲 With one consented asset, click Send for Review. The GitHub file (scratch branch) and `content_cache` contain exactly one block listing it.
- *Edge cases:*
  - 💲 The model copies the block into a revised draft; after assemble there is still exactly one block.
  - Add a second asset and re-assemble: both are listed.
- *Negative cases:*
  - `curl` assemble with another user's `designId`: 403, no commit, no draft in the response.
  - A design linked to a different pathway: 403.
  - (Dev DB) a pathway row whose slug contains `../` (service-role insert): 400, no GitHub request.
- *Non-functional:* Assemble alone still doesn't touch `published_pathways`, and assets stay unpublished.

---

### TA-06: Approving the pathway publishes its assets; the admin sees them in review

**As an** admin
**I want** to see a pathway's assets while reviewing it, and have them go live when I approve it
**So that** there is one review step for the document and its assets

**Priority:** P0 · **Depends on:** TA-05

**Acceptance Criteria:**
- Given `/admin`, when a pathway card is expanded, then it lists the assets whose IDs appear in that pathway's `content_cache`. Each shows name, kind, file name + size or link domain, a **Preview** link (admin may preview unpublished), and a **"Not scanned for malware"** label.
- Given `POST /api/admin/pathways/publish`, when the upsert succeeds, then it sets `published_at = now()` on this pathway's toolkit-asset rows that are unpublished **and** whose IDs are in `assetIdsInDocument(content_cache)`. Assets not in the document stay unpublished.
- Given a re-publish, then already-published assets are untouched and any missed ones are published (idempotent).
- Given the asset flagging fails after a successful upsert, then the route logs the error and returns `{ok: true, assetsPublished: false}`, and the admin sees a warning toast.

**Test Plan:**
- *Positive:* 💲 Publish a pathway whose `content_cache` lists two assets: both rows get `published_at`, and `published_pathways.content` contains the block.
- *Edge cases:*
  - Attach a third asset **after** assemble, then publish: the third stays unpublished. Re-assemble and re-publish: it becomes published.
  - Publishing a pathway with no assets behaves as today.
- *Negative cases:*
  - Hand-edit `content_cache` (dev DB) to include an asset ID from **another** pathway, then publish: that foreign asset is not published.
  - A non-admin `curl` to publish gets 403 (unchanged).
- *Non-functional:* `/wiki/<slug>` still strips Source Trace with the block present, and the published content contains no storage URL.

---

### TA-07: Public download route and public asset-metadata API

**As** anyone using 100 Pathways
**I want** to download a published asset without signing in
**So that** reusable material is freely available (N1)

**Priority:** P0 · **Depends on:** TA-01

**Acceptance Criteria:**
- Given `proxy.ts`, then `/api/toolkit-assets` is in `PUBLIC_PATHS`, and every non-public handler under it (upload-url, register POST) enforces its own auth.
- Given `GET /api/toolkit-assets/[id]/download`:
  - Published file with no session: 302 to a fresh 60 s signed URL with `Content-Disposition: attachment; filename="<file_name>"`.
  - Published link: 302 to the stored https `link_url`.
  - Unpublished: 302 only for the uploader or an admin session, otherwise **404**.
  - Missing object: 404 JSON (not 500).
- Given `GET /api/toolkit-assets?ids=…` with no session, then it returns metadata only for published toolkit assets (`id, name, purpose, kind, fileName, sizeBytes, linkDomain, pathwaySlug, pathwayTitle`), omitting unknown/unpublished IDs, capped at 20.
- Given any response, then no storage path, bucket name or signed URL appears in the JSON.

**Test Plan:**
- *Positive:* In a private window (no session), open `/api/toolkit-assets/<publishedId>/download`: the file downloads with its original name. A link asset redirects to GitHub.
- *Edge cases:*
  - Reuse the signed URL after 61 s: rejected by Supabase.
  - `?ids=` with 25 IDs is capped at 20. Mixed published / pending / garbage IDs return only published.
- *Negative cases:*
  - A pending asset ID with no session gets 404; as another contributor, 404; as the uploader, 302.
  - Delete the object manually, then download: 404.
  - A no-session `POST /api/toolkit-assets` (register) is still rejected by the handler (401).
- *Non-functional:* Check the JSON in DevTools for storage paths or keys (none). Note the no-rate-limit risk (plan Risk 1) in the release notes.

---

### TA-08: `/analyse` companion offers relevant assets as download cards

**As an** adopter analysing my project
**I want** the assistant to offer matching pathways' assets in the conversation
**So that** I get concrete, reusable material when it's useful

**Priority:** P0 · **Depends on:** TA-06, TA-07

**Acceptance Criteria:**
- Given `app/api/chat/route.ts` with `mode==='companion'` and `flow==='explorer'`, then published assets are loaded and passed to `explorerSystemPrompt`. No other mode receives them this way.
- Given `explorerSystemPrompt`, then it has a "Published toolkit assets" block (`id, pathwaySlug, name, purpose, reuseCondition, kind`) and a rule to:
  - surface an asset only when its pathway passes the existing matching discipline
  - name it in one short clause as a suggested choice
  - put its ID in `toolkitAssetsReferenced`
  - never write a URL, and never pad
- Given `gridUpdateContract` (explorer) and `parseGridUpdate`, then `toolkitAssetsReferenced: string[]` is documented and passed through.
- Given a completed reply with IDs, then the client calls `GET /api/toolkit-assets?ids=`, renders a `ToolkitAssetCard` per returned ID (name, purpose, pathway, file name/size or link domain, Download), drops unreturned IDs, and persists the validated IDs on the message, so the cards re-render after reload.

**Test Plan:**
- *Positive:* 💲 With a published asset on a published agriculture voice-advisory pathway, describe a matching project in `/analyse`: the reply mentions the asset, a card appears, Download works, and the card survives reload.
- *Edge cases:*
  - 💲 An unrelated sector gives no card and no forced mention.
  - A stored message ID that no longer resolves: the card is omitted, no crash.
- *Negative cases:*
  - Edit a stored message's IDs to include `asset-bogus`: no card.
  - 💲 The contributor flow on the same topic shows no asset cards.
- *Non-functional:*
  - Prompt size increase with 5 assets is about 250 tokens.
  - Grep 20 replies for URLs to `/api/toolkit-assets` or storage: none come from the model.

---

### TA-09: `/explore` library chat offers the pathway's assets in conversation

**As** a visitor exploring a pathway in the public library
**I want** the assistant, after some conversation, to tell me which assets are associated with this pathway
**So that** I can download what I need without a separate page (N2)

**Priority:** P0 · **Depends on:** TA-06, TA-07

**Acceptance Criteria:**
- Given library mode, when `pathwayId` does not match `^[a-z0-9]+(-[a-z0-9]+)*$`, or is neither a library-corpus file ID nor a `published_pathways` slug, then the route returns 404 before reading any file (security finding #2).
- Given a library pathway chat whose `pathwayId` is a published DB pathway with published assets, then `libraryPathwaySystemPrompt(document, assets)` includes those assets (`id, name, purpose, reuseCondition, kind`) and the rules:
  - **never** mention them on the kickoff overview turn (`LIBRARY_KICKOFF_PROMPT`)
  - mention them at the earliest on the visitor's second message, or immediately when the visitor asks about tools, templates, resources, files, or how to reuse/implement
  - phrase them as "the assets associated with this pathway"
  - end that reply with `<toolkit_assets>["asset-…", …]</toolkit_assets>`
  - never write URLs, and don't repeat the list every turn
- Given the library **overview** chat (no `pathwayId`) or a static-only pathway, then no assets are passed and no tag is expected.
- Given `ExploreLibrary`, then while streaming it hides everything from `<toolkit_assets` onward (`stripToolkitAssetsTag`). On completion it parses the IDs, calls `GET /api/toolkit-assets?ids=`, keeps only IDs whose `pathwaySlug` equals the open pathway, and renders `ToolkitAssetCard`s under that reply. Download works with no sign-in.
- Given a signed-in visitor, then the validated IDs are saved on the message in `library_conversations.messages`, so cards re-render when the conversation is reopened. Anonymous visitors get cards for the session only (no persistence, same as today's anonymous chats).

**Test Plan:**
- *Positive:*
  - 💲 In a private window, open a published DB pathway with assets in `/explore`. The kickoff overview has no assets. Ask a follow-up about implementation: the reply says "these are the assets associated with this pathway", cards appear, and Download works without login.
  - 💲 Signed in, reopen the conversation: the cards are still there.
- *Edge cases:*
  - 💲 A visitor immediately asks "are there any templates?": assets are offered on that turn.
  - 💲 A pathway with no assets: no mention, no tag. The overview chat: no assets.
  - A malformed tag (bad JSON): no cards, and the text still renders.
- *Negative cases:*
  - Manually craft a reply tag with an asset ID from another pathway (simulate in the client): the card is dropped.
  - A library request with `pathwayId: "../../wiki/pathways/blue-dots"` gets 404, and no model call is made.
  - A partially streamed `<toolkit_as` never flashes in the UI.
- *Non-functional:*
  - The library prompt grows only by the open pathway's assets.
  - Kickoff-turn cost is unchanged (no assets mentioned).

---

### TA-10: Clean up stored files when pathways or accounts are deleted

**As an** admin or a departing user
**I want** stored asset files removed with their records
**So that** no orphaned files remain

**Priority:** P1 · **Depends on:** TA-01

**Acceptance Criteria:**
- Given `app/api/admin/pathways/delete/route.ts`, then it removes the storage objects of that pathway's toolkit assets (any status) before deleting the pathway. Storage errors are logged but don't block the delete, and the confirm dialog copy mentions asset files.
- Given `app/api/account/delete/route.ts`, then it removes the storage objects of the user's **unpublished** assets before deleting those rows. **Published** assets' objects and rows survive with `user_id` nulled (the migration `0033` rule), and stay downloadable.

**Test Plan:**
- *Positive:*
  - A pathway with one pending and one published asset, deleted by an admin: both objects and both rows are gone.
  - A contributor with one pending and one published asset deletes their account: the pending object and row are gone; the published object is present, its row has `user_id` null, and public download still works.
- *Edge cases:* A pathway with only link assets: no storage calls.
- *Negative cases:* Storage failing during pathway delete: the pathway is still deleted and the error is logged.
- *Non-functional:* Update `specs/ACCOUNT_DELETION_SPEC.md` accordingly.

---

### TA-11: Documentation and wiki refresh

**As a** future engineer or AI agent on this repo
**I want** the new bucket, routes, contracts and table semantics documented
**So that** the wiki stays the source of truth

**Priority:** P2 · **Depends on:** TA-01 … TA-10

**Acceptance Criteria:**
- Given the `llm-wiki` skill is re-run, then the wiki reflects:
  - `contribution_units` as live (TD-04 updated) and the `toolkit-assets` bucket
  - migration count 34
  - the new routes (incl. public ones in `PUBLIC_PATHS`)
  - `toolkitAssetCandidates`, `toolkitAssetsReferenced` and `<toolkit_assets>` contracts
  - the `framework.md` fix
  - the security findings #2/#4/#6 as fixed
- Given `content/legal/terms.md` (and privacy notice if needed), then Legal has reviewed the public-sharing consent wording, or the review is tracked as a launch blocker.

**Test Plan:**
- *Positive:* The wiki `api-specification.md` lists the four `/api/toolkit-assets` routes with correct auth.
- *Negative cases:* No doc contains secrets or signed URLs.
