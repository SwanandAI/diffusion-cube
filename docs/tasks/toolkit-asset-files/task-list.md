# Task List: Toolkit Asset Files

Stage 4 of `brd-task-creator`, derived from the approved [`plan.md`](plan.md) (2026-09-29). Story IDs follow the plan's Sequencing (S0–S7).

> **Testing note.** This repo has **no automated test suite** (no test runner, no CI test job; `.github/workflows/deploy.yml` only builds and deploys). Every test case below is a **manual verification step**: a concrete action and an observable result in the running app, in Supabase, or in the S3 console. Cases marked 💲 call the real Anthropic API or write to the real S3 bucket, so they cost money or change real state. Run them against a dev bucket prefix (`TOOLKIT_ASSETS_S3_PREFIX=dev/`).

## Dependency overview

```
TA-01 (S3 infra + lib/s3.ts) ──┐
TA-02 (migration + lib)  ──────┼─► TA-03 (identify) ─► TA-04 (submit) ─► TA-05 (status list)
                               │                          │
                               │                          ├─► TA-06 (admin review + sync) ─► TA-07 (re-apply on assemble/publish)
                               │                          └─► TA-08 (download + ids API) ─► TA-09 (explorer cards)
                               └─► TA-10 (cleanup on deletes)
TA-11 (docs + wiki refresh) last
```

---

### TA-01: Provision the S3 bucket and add a server-only S3 module

**As a** Solution Team engineer
**I want** a private S3 bucket and one server-only module that wraps it
**So that** asset files have a secure home and the rest of the app never talks to AWS directly

**Priority:** P0
**Depends on:** None

**Acceptance Criteria:**
- Given the new checklist `docs/tasks/toolkit-asset-files/s3-setup.md`, when an engineer follows it, then the bucket exists with:
  - Block Public Access (all four settings on)
  - default SSE-S3 encryption
  - a CORS rule allowing `POST` from the app origins (production domain, Vercel preview domain pattern, `http://localhost:3000`)
  - an IAM policy granting only `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on `arn:aws:s3:::<bucket>/<prefix>*`, plus `s3:ListBucket` on the bucket
- Given `package.json`, then it declares `@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post`, `@aws-sdk/s3-request-presigner`.
- Given `lib/s3.ts`, then it exports:
  - `presignUpload(key, contentType)`: a presigned **POST** with `content-length-range` 1–26,214,400 bytes, an exact-key condition, and a fixed `Content-Type`
  - `presignDownload(key, fileName)`: a 60 s GET with `ResponseContentDisposition: attachment; filename="<fileName>"`
  - `headObject(key)`, returning `null` on 404
  - `deleteObjects(keys[])`
- Given `lib/s3.ts`, then it reads `AWS_REGION`, `TOOLKIT_ASSETS_S3_BUCKET`, `TOOLKIT_ASSETS_S3_PREFIX` and uses the SDK's default credential chain. It carries a SERVER-ONLY header comment like `lib/supabase/admin.ts`, and no AWS variable uses a `NEXT_PUBLIC_` prefix.
- Given a missing `TOOLKIT_ASSETS_S3_BUCKET`, when any `lib/s3.ts` function is called, then it throws a clear configuration error. The callers (TA-04, TA-08) turn that into a handled 503 JSON response, not an unhandled 500.

**Test Plan:**
- *Positive:*
  - 💲 From a scratch Node script using `lib/s3.ts`: presign an upload for `dev/toolkit-assets/test/1/a.pdf`, `curl -F` the fields plus a 1 MB PDF, then `headObject` returns size 1 MB; presign a download and `curl -I` gets 200 with `content-disposition: attachment`.
- *Edge cases:*
  - 💲 Upload exactly 25 MB (26,214,400 bytes): S3 accepts it.
  - A file name with spaces or unicode: the download `content-disposition` is correctly encoded.
- *Negative cases:*
  - 💲 Upload 25 MB + 1 byte with a valid presign: S3 returns `EntityTooLarge`.
  - Open the object's plain `https://<bucket>.s3.<region>.amazonaws.com/<key>` URL with no signature: 403 (Block Public Access works).
  - Wait 61 s, then use the presigned GET: 403 (expiry works).
  - Upload from a browser on a non-allowed origin: blocked by CORS.
  - Grep the client bundle (`.next/static`) for the bucket name and access key: not present.
- *Non-functional:*
  - Confirm the IAM user/role cannot `s3:DeleteBucket` or list other buckets.

---

### TA-02: Migration 0034 and the core toolkit-asset library

**As a** Solution Team engineer
**I want** `contribution_units` extended for toolkit assets, with writes locked to the server, plus one shared library for asset logic
**So that** every later story reads and writes asset records one consistent way, and nobody can self-approve

**Priority:** P0
**Depends on:** None

**Acceptance Criteria:**
- Given `supabase/migrations/0034_contribution_units_toolkit_assets.sql`, then:
  - its header comment states its purpose and that it drops the two client write policies (the only non-additive part)
  - it adds `asset_kind`, `asset_name`, `purpose`, `reuse_condition`, `storage_key`, `file_name`, `mime_type`, `size_bytes`, `link_url`, `share_consent` (default false), `share_consented_at`, `review_status` (default `'pending'`, check pending/approved/rejected), `reviewed_by` (FK set null), `reviewed_at`
- Given a row with `unit_type='toolkit-asset'`, when it is inserted with `share_consent=false`, or `asset_kind` null, or `asset_kind='file'` with no `storage_key` while not rejected, or `asset_kind='link'` with no `link_url`, then the insert fails the check constraint.
- Given a toolkit-asset row, when `review_status='approved'` and `published_at` is null (or the reverse), then the write fails the check constraint.
- Given the migration is applied, when an authenticated client (anon key + user JWT) tries to `insert` or `update` `contribution_units`, then it is denied by RLS (both client write policies are dropped). The existing select policy (own + published) is unchanged.
- Given `lib/toolkit-assets.ts`, then it exports:
  - `ALLOWED_ASSET_EXTENSIONS`, `MAX_ASSET_BYTES = 26214400`
  - `buildAssetKey(pathwayId, fileName)`: `<prefix>toolkit-assets/<pathwayId>/<uuid>/<sanitised-name>`. Sanitising strips path separators, `..` and control characters, and keeps the extension.
  - `renderToolkitAssetBlock(assets)`, `applyToolkitAssetBlock(markdown, assets)`, `loadApprovedToolkitAssets(supabase)`, `syncToolkitAssetBlock(pathwayId)`
- Given `applyToolkitAssetBlock`:
  - When the markers `<!-- toolkit-assets:start -->` / `<!-- toolkit-assets:end -->` exist, it replaces only what is between them.
  - When they are absent, it inserts the block at the end of Section 4 (before the next heading matching Section 5, Section 6, "Retrieval guide" or "Source Trace"), falling back to just before Source Trace, then to end of document.
  - With an empty asset list, it removes the block entirely.
  - Running it twice gives the same output as running it once (idempotent).
- Given the rendered block, then each asset shows name, kind (file/link), purpose and reuse condition, with an `<!-- asset-id: asset-<uuid> -->` marker, and contains **no URL**.

**Test Plan:**
- *Positive:*
  - Apply `0034` to a Supabase branch/dev project on top of `0001`–`0033`: it succeeds. `\d contribution_units` shows the new columns.
  - Service-role insert of a valid file-kind row: succeeds with `review_status='pending'`.
  - Run `applyToolkitAssetBlock` in a Node REPL on a copy of `content/wiki/pathways/mahavistaar.md` with two assets: the block appears after the Section 4 table and before `## 6. Retrieval guide`.
- *Edge cases:*
  - `applyToolkitAssetBlock` on a doc with no Section 4 heading: block lands before `## Source Trace`.
  - A doc with neither Section 4 nor Source Trace: block is appended at the end.
  - Run it twice: byte-identical output.
  - Empty list on a doc that has a block: block removed, no leftover blank-line run.
  - File names `../../etc/passwd`, `a/b.pdf`, `résumé 2026.pdf` passed to `buildAssetKey`: none escapes the `<pathwayId>/<uuid>/` segment.
- *Negative cases:*
  - As a signed-in contributor, from the browser console, `supabase.from('contribution_units').insert({... published_at: new Date()})`: RLS error.
  - Same with `update({ review_status: 'approved' })` on one's own row: RLS error.
  - Service-role insert with `share_consent=false`: check-constraint error.
- *Non-functional:*
  - Migration stays additive apart from the documented policy drop.
  - 💡 `applyToolkitAssetBlock` is a pure string transform, a strong candidate for this repo's **first automated test** (per `architecture/testing.md`). Suggestion only; not assumed in scope.

---

### TA-03: Contributor companion identifies toolkit-asset candidates

**As a** contributor
**I want** the assistant to recognise when something I upload or link is a genuinely reusable asset
**So that** I'm only asked to share things that are actually useful to other adopters

**Priority:** P0
**Depends on:** TA-02

**Acceptance Criteria:**
- Given `content/framework.md` "The five unit types" table, then it has rows for **Playbook** and **Toolkit Asset**, with definitions consistent with `content/pathway-generation-prompt.md:71-72,107-108` ("a genuine multi-step, gated sequence" / "an actual reusable artifact … someone else can lift and adapt without rebuilding").
- Given `contributorSystemPrompt`, then it has a "Toolkit asset files" section instructing the model to:
  - flag an uploaded file or pasted https link in `toolkitAssetCandidates` **only** if it meets the Toolkit Asset bar
  - flag each file/link at most once per conversation
  - never ask the yes/no questions in prose (the card asks)
  - never make evaluative statements (the existing no-judgment rule)
  - when the contributor explicitly asks to add something that doesn't meet the bar, say plainly that it reads as source material rather than a reusable artifact
- Given `gridUpdateContract(..., { pathwayAction: true, toolkitAssetCandidates: true })`, then the contributor contract documents `toolkitAssetCandidates: [{ source: { fileName } | { url }, name, purpose, reuseCondition, dimension?, stage? }]`. The explorer contract does **not** include it.
- Given `lib/grid-update.ts`, then `ParsedGridUpdate` and `parseGridUpdate` pass `toolkitAssetCandidates` through, dropping entries that lack `source` or `name`.
- Given `lib/extract-text.ts` / `handleAttachFiles` in the contributor flow:
  - a `.zip` is accepted as an **asset-only** attachment (no text extraction). The model receives `📦 Uploaded asset file **<name>** (ZIP, N entries: first 50 entry names…)` via JSZip.
  - an image over 5 MB is accepted as asset-only, described by name and size (not sent as an image block).
  - `.doc`/`.ppt` are accepted as asset-only.
  - In the Explorer flow the existing type rules are unchanged.

**Test Plan:**
- *Positive:*
  - 💲 As a contributor in a workspace, upload a real checklist PDF (e.g. an "infrastructure readiness checklist"): the reply's `<grid_update>` (check the network response) contains one `toolkitAssetCandidates` entry with that `fileName`, a sensible name and purpose.
  - 💲 Paste `https://github.com/COSS-India/voicera_mono_repository` saying "this is our orchestration platform": a candidate with a `url` source.
- *Edge cases:*
  - 💲 Upload a ZIP of templates: accepted, the model receives the entry-name listing, and a candidate is flagged.
  - 💲 Upload the same file twice in one conversation: flagged only once.
  - Upload a 7 MB PNG diagram: accepted as asset-only, not rejected by the 5 MB image limit.
- *Negative cases:*
  - 💲 Upload an interview transcript (source material, not an artifact): **no** candidate, and the reply has no evaluative language.
  - 💲 Paste an `http://` (non-TLS) link: no candidate.
  - In the **Explorer** flow, upload a ZIP: still rejected as unsupported (behaviour unchanged).
  - Feed `parseGridUpdate` a block whose candidate lacks `name`: the entry is dropped and the rest of the block parses.
- *Non-functional:*
  - The framework table renders correctly on `/wiki`-style markdown. The added rows barely change prompt size, so token impact is negligible.

---

### TA-04: Contributor confirms and submits an asset for review

**As a** contributor
**I want** to answer two clear Yes/No questions and have my asset sent for admin review
**So that** nothing is shared without my explicit agreement

**Priority:** P0
**Depends on:** TA-01, TA-02, TA-03

**Acceptance Criteria:**
- Given a companion reply with `toolkitAssetCandidates`, when it finishes streaming, then the client appends a client-constructed message rendering `ToolkitAssetConfirmCard` per candidate. The card shows the proposed name and purpose, and two Yes/No controls: **"Is this a toolkit asset?"** and **"OK to share with other adopters?"**. **Submit** is enabled only when both are answered.
- Given a file candidate, when the matching `File` is not in the hook's in-memory map (e.g. after a reload), then the card says the file needs re-attaching and Submit is disabled.
- Given the contributor answers **No** to either question, when they submit, then nothing is uploaded, no API call is made, no row is created, and the card shows "Not shared."
- Given both answers are **Yes** for a file, when submitted:
  1. The client calls `POST /api/toolkit-assets/upload-url`.
  2. It uploads directly to S3 with the returned presigned POST.
  3. It calls `POST /api/toolkit-assets` with `isToolkitAsset: true, shareConsent: true`.
  4. The card shows "Sent to admin for review."
- Given both answers are **Yes** for a link, when submitted, then only `POST /api/toolkit-assets` is called (`kind:'link'`).
- Given `POST /api/toolkit-assets/upload-url`:
  - no session → 401
  - no `pathway_contributor` → 403
  - not a member of `pathwayId` (checked against `pathway_contributors`, like `assemble`) → 403
  - extension not allowed or `size` > 26,214,400 → 400
  - S3 not configured → 503
  - otherwise it returns `{key, url, fields}` with a server-built key under that pathway.
- Given `POST /api/toolkit-assets`, then it re-checks role and membership and returns 400 when:
  - `isToolkitAsset !== true` or `shareConsent !== true`
  - (file) the key isn't under `<prefix>toolkit-assets/<pathwayId>/`, or `headObject` is null, or its size exceeds the cap
  - (link) the URL isn't `https:`

  On success, the service-role client inserts a `contribution_units` row: `section='micro-innovation'`, `unit_type='toolkit-asset'`, `unit_internal_id='asset-<uuid>'`, `user_id`, `design_id`, `review_status='pending'`, `published_at=null`, `share_consent=true`, `share_consented_at=now()`, `dimension`/`stage` lower-cased (or null if invalid). It returns `{id, reviewStatus:'pending'}`.
- Given a double-click on Submit, then only one upload and one row result (the button disables while in flight).

**Test Plan:**
- *Positive:*
  - 💲 Contributor uploads a checklist PDF, answers Yes/Yes, submits: S3 console shows the object under `dev/toolkit-assets/<pathwayId>/…`; Supabase shows one `contribution_units` row with `review_status='pending'`, `share_consent=true`, `published_at` null.
  - 💲 Link candidate, Yes/Yes: row with `asset_kind='link'`, `link_url` set, no S3 object.
- *Edge cases:*
  - Answer Yes/No: no network calls in DevTools, no S3 object, no row.
  - Reload the page between the candidate card appearing and submitting: card shows "re-attach", Submit disabled.
  - Double-click Submit quickly: exactly one object and one row.
  - 25 MB file: succeeds. A 3-file drop where two are candidates: two cards, each independent.
- *Negative cases:*
  - `curl` `POST /api/toolkit-assets/upload-url` with no cookie: 401. As an `adopter`-only user: 403. As a contributor not joined to that pathway: 403.
  - `curl` `POST /api/toolkit-assets` with `shareConsent:false`: 400, no row.
  - `curl` register with a `storageKey` pointing at another pathway's prefix: 400.
  - Register with a key that was never uploaded: 400 ("file not found").
  - `curl` upload-url with `size: 30000000`: 400. Forge `size` small but upload 30 MB to the presigned POST: S3 rejects it (`EntityTooLarge`).
  - Unset `TOOLKIT_ASSETS_S3_BUCKET` locally: upload-url returns 503 JSON, the card shows a friendly error, and the chat keeps working.
- *Non-functional:*
  - The card matches the app's brand tokens (`app/globals.css`) and works on a 375 px-wide viewport.
  - Invariant: the model output alone never creates a row. Replaying a `<grid_update>` with candidates but not clicking Submit leaves the DB unchanged.

---

### TA-05: Contributor sees the status of their assets

**As a** contributor
**I want** to see which of my assets are pending, approved or rejected
**So that** I know what other adopters can actually see

**Priority:** P1
**Depends on:** TA-04

**Acceptance Criteria:**
- Given a contributor workspace with a `pathwayId`, when `PathwayDocumentPane` is opened, then a "Toolkit assets" section lists that pathway's toolkit-asset rows readable under the existing RLS (the user's own rows, plus other contributors' approved ones). Each shows name, kind, file name/domain, and a status badge (Pending / Approved / Rejected).
- Given the contributor's own row, when they click its name, then it opens via `GET /api/toolkit-assets/[id]/download` (owner preview is allowed regardless of status, per A5).
- Given a successful submit in TA-04, then the list refreshes without a page reload.
- Given no assets, then the section shows a one-line empty state.

**Test Plan:**
- *Positive:*
  - After TA-04's submit, open the pane: the asset shows **Pending**. After admin approval (TA-06), reopen: **Approved**.
- *Edge cases:*
  - Two contributors on one pathway: A sees own pending plus B's approved, but **not** B's pending.
  - Rejected own asset: shows **Rejected**, and the name is not clickable (object deleted).
- *Negative cases:*
  - Contributor C not on this pathway, querying `contribution_units` from the console for that `pathway_id`: sees only approved rows (existing select RLS), never pending ones.
- *Non-functional:*
  - Mobile layout of the pane unchanged apart from the new section.

---

### TA-06: Admin reviews, approves or rejects each asset

**As an** admin
**I want** a queue of submitted assets I can preview, approve or reject
**So that** nothing reaches adopters without a human check, including assets added to already-live pathways

**Priority:** P0
**Depends on:** TA-02, TA-04, TA-01

**Acceptance Criteria:**
- Given `/admin`, when it loads, then a new `AdminToolkitAssetsPanel` lists toolkit-asset rows with `review_status='pending'` (newest first), each showing:
  - asset name, purpose, reuse condition, kind, file name + size (or link domain)
  - pathway title/slug, and whether the pathway is live in `published_pathways`
  - contributor email and org, submitted date
  - a visible **"Not scanned for malware"** label
  - a **Preview** link via the download route (admin is allowed any status)
- Given **Approve**, when `POST /api/admin/toolkit-assets/approve {id}` runs, then:
  - non-admin → 403
  - unknown id or non-toolkit row → 404
  - rejected row → 409
  - otherwise it sets `review_status='approved'`, `published_at=now()`, `reviewed_by`, `reviewed_at`, then calls `syncToolkitAssetBlock(pathwayId)`, which applies the block (all approved assets for that pathway) to:
    - `pathways.content_cache` (if non-empty)
    - `published_pathways.content` for the same slug (if the row exists)
    - `content/wiki/pathways/<slug>.md` via `lib/github.ts` (if `content_cache` was non-empty)
  - It returns `{approved: true, docSync: 'ok' | 'failed' | 'skipped'}`. `skipped` = nothing assembled yet.
- Given approve is called again on an already-approved row, then the DB fields are unchanged and the sync re-runs (idempotent retry path for `docSync:'failed'`).
- Given **Reject** (with a confirm dialog, `useConfirm`), when `POST /api/admin/toolkit-assets/reject {id}` runs, then:
  - non-admin → 403
  - approved row → 409 (no revoke in this release, O5)
  - otherwise it sets `review_status='rejected'`, `reviewed_by`, `reviewed_at`, deletes the S3 object, nulls `storage_key`, and does **not** touch any document.
- Given a pathway already live in `published_pathways`, when a new asset for it is approved, then the live content shows the updated block immediately, with no separate pathway-publish click (accepted at review).
- Given the panel after an action, then the row leaves the pending list and a toast confirms (`showToast`). `docSync:'failed'` shows a warning toast with a "Retry sync" action.

**Test Plan:**
- *Positive:*
  - 💲 Approve a pending asset on an assembled and published pathway: `contribution_units` shows approved + `published_at`; `pathways.content_cache` and `published_pathways.content` both contain `<!-- toolkit-assets:start -->` with the asset; GitHub (branch `GITHUB_BRANCH`) has a new commit on `content/wiki/pathways/<slug>.md` containing the block.
  - Reject a pending file asset: row `rejected`, S3 object gone, documents unchanged.
- *Edge cases:*
  - Approve an asset whose pathway has never been assembled (`content_cache` empty): `docSync:'skipped'`, row approved, no GitHub commit.
  - Approve a second asset on the same pathway: the block lists **both**, and exactly one block exists (no duplication).
  - Force a GitHub failure (bad `GITHUB_TOKEN` locally): `docSync:'failed'` with a warning toast; Retry sync after fixing the token succeeds; row stays approved throughout.
  - Two admins approve the same row at once: final state approved, one block, no error surfaced to either.
- *Negative cases:*
  - `curl` approve/reject as a non-admin contributor: 403.
  - Reject an approved asset: 409.
  - Approve a rejected asset: 409.
  - `curl` approve with a random UUID: 404.
- *Non-functional:*
  - `/wiki/<slug>` still strips Source Trace correctly with the block present (the block sits above it).
  - The block contains no URL (grep the published content for `amazonaws` / `/api/toolkit-assets`: no hits).

---

### TA-07: Approved assets survive new drafts, assemble and publish

**As a** contributor or admin
**I want** approved assets to stay in the pathway document when it's revised, assembled or republished
**So that** a new draft never silently drops what an admin already approved

**Priority:** P0
**Depends on:** TA-06

**Acceptance Criteria:**
- Given `app/api/pathways/assemble/route.ts`, when it writes the latest draft, then it first runs `applyToolkitAssetBlock(draft, approvedAssetsForPathway)`, and the result is what goes to GitHub and `pathways.content_cache`.
- Given `app/api/admin/pathways/publish/route.ts`, when it upserts `published_pathways`, then the content is `applyToolkitAssetBlock(content_cache, approvedAssets)`.
- Given `pathwayDraftSystemPrompt` (and the generation rules it injects), then it tells the model to omit any content between the toolkit-assets markers, because the app regenerates it.
- Given a pathway with no approved assets, then assemble and publish output is byte-identical to today's behaviour.

**Test Plan:**
- *Positive:*
  - 💲 With one approved asset, ask the contributor companion to revise the draft, then **Send for Review** (assemble): the GitHub file and `content_cache` contain the block exactly once. Admin publish: `published_pathways.content` contains it.
- *Edge cases:*
  - 💲 The model copies the block into the draft anyway: after assemble, still exactly one block (markers replaced).
  - The model mangles one marker: document the result (known limitation); the block is re-inserted, and the dangling fragment is flagged to the admin by the preview.
- *Negative cases:*
  - Pathway with zero approved assets: diff assemble output against the pre-change behaviour; no differences.
- *Non-functional:*
  - No change to the two-step gate: assemble alone still doesn't create or modify `published_pathways`.

---

### TA-08: Secure download route and approved-asset metadata API

**As an** adopter
**I want** to download an approved asset through a short-lived secure link
**So that** shared files stay private to signed-in adopters

**Priority:** P0
**Depends on:** TA-01, TA-02

**Acceptance Criteria:**
- Given `GET /api/toolkit-assets/[id]/download`:
  - no session → 401
  - an approved asset and a caller with `adopter` → 302 to a 60 s presigned GET (file) or to the stored `link_url` (link)
  - a caller who is admin (`isAdmin`) or the row's `user_id` → 302 regardless of status (except rejected-and-deleted files → 404)
  - pending/rejected and the caller is neither → 404 (existence not leaked)
  - `headObject` null → 404 with a JSON error
  - S3 misconfigured → 503
- Given `GET /api/toolkit-assets?ids=a,b,c`, when called by an `adopter`, then it returns metadata only for IDs that are approved toolkit assets (`id, name, purpose, kind, fileName, sizeBytes, pathwaySlug, pathwayTitle`), silently omitting unknown/unapproved IDs, capped at 20 IDs. Non-adopter → 403.
- Given any response, then no S3 key, bucket name or presigned URL appears in the JSON metadata.

**Test Plan:**
- *Positive:*
  - 💲 As an adopter, open `/api/toolkit-assets/<approvedId>/download`: the browser downloads the file with its original name. Link asset: redirects to the GitHub URL.
- *Edge cases:*
  - Copy the presigned URL, wait 61 s, reopen: S3 403.
  - `?ids=` with 25 IDs: only the first 20 are considered.
  - `?ids=` mixing approved, pending and garbage: only approved come back.
- *Negative cases:*
  - No session: 401. Contributor-only (no `adopter`) on an approved asset they don't own: 403.
  - Adopter on a pending asset id: 404.
  - Delete the S3 object manually, then download: 404, not 500.
- *Non-functional:*
  - The response JSON contains no key/bucket (inspect in DevTools).

---

### TA-09: Adopters see relevant assets as download cards in `/analyse` (Option B)

**As an** adopter
**I want** the assistant to offer relevant approved assets as download cards when my project matches a pathway
**So that** I get concrete, reusable material right when it's useful

**Priority:** P0
**Depends on:** TA-08, TA-06

**Acceptance Criteria:**
- Given `app/api/chat/route.ts`, when `mode==='companion'` and `flow==='explorer'`, then it calls `loadApprovedToolkitAssets` and passes the list to `explorerSystemPrompt`. No other mode or flow receives it (not `library`, not contributor, not `analysis-doc`).
- Given `explorerSystemPrompt`, then it contains an "Approved toolkit assets" block (`id, pathwaySlug, name, purpose, reuseCondition, kind`) and a rule to:
  - surface an asset **only** when its pathway passes the existing matching discipline (same sector + same use-case, or a close problem match for a narrow question)
  - name it in one short framing clause in prose, as a suggested choice
  - put its id in `toolkitAssetsReferenced`
  - never write a URL
  - never pad when nothing matches
- Given `gridUpdateContract` for the explorer, then it documents optional `toolkitAssetsReferenced: string[]`, and `parseGridUpdate` passes it through.
- Given a completed explorer reply with `toolkitAssetsReferenced`, then the client calls `GET /api/toolkit-assets?ids=…`, renders a `ToolkitAssetCard` (name, purpose, pathway, file name/size or link domain, **Download** button → download route) for each returned id, drops ids not returned, and persists the validated ids on the message (like `pathwaysReferenced`) so the cards re-render after reload.
- Given `/explore` library chat, `/wiki`, the Analysis Document, and Executive Summary, then none of them show asset cards or download links.

**Test Plan:**
- *Positive:*
  - 💲 With an approved asset on a published agriculture voice-advisory pathway, as an adopter in `/analyse`, describe a voice-based farmer advisory project in Maharashtra: the reply names the asset in one clause and a download card appears under it. Download works. Reload the conversation: the card is still there.
- *Edge cases:*
  - 💲 A project in an unrelated sector (e.g. court transcription): no card, no forced mention.
  - 💲 An asset approved mid-conversation: offered on a later relevant turn.
  - A stored message whose asset id no longer resolves: the card is omitted, no crash.
- *Negative cases:*
  - Make the model emit a fake id (edit the stored message's ids in Supabase to include `asset-bogus`): no card for it.
  - 💲 Contributor flow and `/explore` library chat on the same topic: no asset cards.
  - Signed in as contributor-only (no `adopter`): `/analyse` is gated as today, and `?ids=` returns 403.
- *Non-functional:*
  - Prompt size: log `systemPrompt.length` before and after with 5 approved assets; about 250 tokens extra is acceptable.
  - Invariant: the model never produces a URL (grep 20 sampled replies for `http`/`/api/toolkit-assets`: none from the model).

---

### TA-10: Clean up S3 objects when pathways or accounts are deleted

**As an** admin or a departing user
**I want** stored asset files removed whenever their records are removed
**So that** no orphaned, unreviewable files sit in the bucket

**Priority:** P1
**Depends on:** TA-01, TA-02

**Acceptance Criteria:**
- Given `app/api/admin/pathways/delete/route.ts`, when a pathway is deleted, then it first collects `storage_key` from that pathway's toolkit-asset rows (any status), deletes those objects, and then deletes the pathway (rows cascade). An S3 failure is logged but does not block the delete. The confirm dialog copy mentions asset files.
- Given `app/api/account/delete/route.ts`, when a user deletes their account, then before deleting their unpublished units it deletes the S3 objects of their **pending/rejected** toolkit assets. Their **approved** assets' objects and rows survive with `user_id` nulled, matching migration `0033`'s "published content survives" rule.

**Test Plan:**
- *Positive:*
  - Pathway with 1 pending + 1 approved asset → admin deletes the pathway: both S3 objects gone, both rows gone.
  - Contributor with 1 pending + 1 approved asset deletes their account: pending object and row gone; approved object present; row has `user_id` null; the adopter download still works.
- *Edge cases:*
  - Pathway with only link assets: no S3 calls, delete succeeds.
- *Negative cases:*
  - Simulate S3 down (wrong region env) during pathway delete: pathway still deleted, error logged; orphan noted for the future sweep.
- *Non-functional:*
  - No change to `specs/ACCOUNT_DELETION_SPEC.md` guarantees other than the addition; update the spec text accordingly.

---

### TA-11: Documentation and wiki refresh

**As a** future engineer or AI agent working on this repo
**I want** the S3 setup, new env vars, routes and table semantics documented
**So that** the wiki stays the reliable source of truth

**Priority:** P2
**Depends on:** TA-01 … TA-10

**Acceptance Criteria:**
- Given `docs/tasks/toolkit-asset-files/s3-setup.md`, then it covers:
  - bucket settings, CORS JSON, IAM policy JSON, env vars per environment (Vercel / local / Docker-AWS)
  - the **AWS account expiry (Dec-2026) migration step**: copy the bucket and rotate credentials
- Given the `llm-wiki` skill is re-run, then the wiki reflects:
  - `contribution_units` as live (TD-04 resolved or updated)
  - S3 as a new integration and new env vars
  - migration count 34
  - the new routes
  - the new `<grid_update>` fields
  - the `framework.md` unit-type fix
- Given `.env.local` example documentation (if any is added), then it never contains real secrets.

**Test Plan:**
- *Positive:*
  - A second engineer provisions a dev bucket using only `s3-setup.md` and completes TA-04's positive test.
- *Edge cases:*
  - Wiki `configuration.md` lists all five new env vars with required/optional status.
- *Negative cases:*
  - Grep the repo for AWS access-key patterns (`AKIA[0-9A-Z]{16}`): no hits.
- *Non-functional:*
  - n/a
