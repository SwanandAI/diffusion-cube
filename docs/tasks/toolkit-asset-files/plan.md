# Plan: Store Toolkit Asset Files and Surface Them in `/analyse`

> Status: **Approved 2026-09-29** (Stage 3 of `brd-task-creator`), with these review decisions:
> - Storage is **AWS S3**
> - D-Q6 = **Option B** (asset-ID cards)
> - Approval updating live content is **accepted**
>
> Inputs: [`requirement.md`](requirement.md), [`clarifications.md`](clarifications.md). Task breakdown: [`task-list.md`](task-list.md).

## Summary

Contributors can attach real toolkit asset files (PDF, office docs, ZIP, images) or links (GitHub/URL) inside their `/contribute` workspace. The contributor companion checks whether each upload is a genuine Toolkit Asset. If it is, the contributor must explicitly answer **yes** to both "this is a toolkit asset" and "OK to share with other adopters". An admin then approves each asset individually. Approved assets are recorded in the pathway document (`pathways.content_cache`, the GitHub `.md`, and `published_pathways.content`). They are offered to signed-in adopters in the `/analyse` chat as download cards when relevant to what the adopter is working on. Files live in a private **AWS S3** bucket, and asset records live in `contribution_units`.

## Scope

**In scope**
- Contributor-only asset attach (files ≤ 25 MB: pdf, doc/docx, xls/xlsx, ppt/pptx, zip, png/jpg/jpeg/gif/webp; plus https links)
- AI identification of asset candidates, plus an explicit two-question yes/no confirmation
- Per-asset admin approve/reject gate, including assets added to already-published pathways
- Records in `contribution_units` (toolkit-asset type), files in a private S3 bucket
- Asset reference block written into the pathway document in all corpus locations on approval
- Relevance-driven surfacing in `/analyse` only, for the `adopter` role, as validated download cards (Option B)
- S3 object cleanup when an asset is rejected, a pathway is deleted, or an account is deleted
- Adding the missing Playbook / Toolkit Asset rows to `content/framework.md`'s unit-type table (a dependency, see Architectural Approach §3)

**Out of scope** (per clarifications)
- Backfilling the 36 Toolkit Asset units already described in the committed corpus (O1)
- Admin upload, licence field (O4)
- Revoke/unpublish of an approved asset (O5)
- Surfacing in `/explore`, `/wiki`, the Analysis Document, or the library chat (Q6)
- All enhancement tracks (Q12). They are listed under "Future Upgrade Roadmap" as documentation only.
- Infrastructure-as-code for the bucket. None exists in this repo; the bucket is provisioned manually from a documented checklist.

## Assumptions

- **A1.** "Not stored if the contributor says No" (O3): the file never leaves the browser. It is uploaded only after both answers are Yes.
- **A2.** Candidate files are retained in browser memory for the current session until confirmed. A reload before confirmation loses them, and the contributor re-attaches.
- **A3.** An asset belongs to a `pathways` row (the contributor's workspace pathway), not to a unit number. Unit numbers are renumbered on every revision.
- **A4.** Contributors see the status of their own assets (pending / approved / rejected). Rejection has no reason field in v1.
- **A5.** The download route also allows **admins** (to review) and **the uploading contributor** (to preview their own). Otherwise it is `adopter` only, approved assets only.
- **A6.** One bucket serves all environments, separated by an env-specific key prefix (`TOOLKIT_ASSETS_S3_PREFIX`, e.g. `prod/`, `dev/`). Separate buckets per environment also work with no code change.
- **A7.** AWS credentials come from the default SDK credential chain: access-key env vars on Vercel, or an instance/task IAM role on the Docker/AWS path.

## Affected Areas

| Area | Component(s) | Nature of change |
|---|---|---|
| Dependencies | `package.json` | **New**: `@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post`, `@aws-sdk/s3-request-presigner` |
| Config | `.env.local` / Vercel env, `docs/wiki/diffusion-cube/architecture/configuration.md` (on wiki refresh) | **New env vars**: `AWS_REGION`, `TOOLKIT_ASSETS_S3_BUCKET`, `TOOLKIT_ASSETS_S3_PREFIX`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (the last two only where no IAM role exists) |
| Infra (manual) | `docs/tasks/toolkit-asset-files/s3-setup.md` (new checklist) | Private bucket: Block Public Access on, SSE-S3 encryption, CORS allowing `POST` from the app origins, least-privilege IAM policy (`s3:PutObject`, `GetObject`, `DeleteObject` on the prefix; `ListBucket` for HeadObject 404s) |
| Data | `supabase/migrations/0034_contribution_units_toolkit_assets.sql` (new) | Add asset columns and constraints to `contribution_units`; **drop client insert/update policies** (see Security) |
| Domain logic | `lib/s3.ts` (new, server-only) | S3 client singleton; `presignUpload(key, contentType)` (presigned **POST** with `content-length-range` ≤ 25 MB), `presignDownload(key, fileName)` (60 s GET, `Content-Disposition: attachment`), `headObject`, `deleteObject(s)` |
| Domain logic | `lib/toolkit-assets.ts` (new) | Types, allowed extensions/size, key builder, `renderToolkitAssetBlock` / `applyToolkitAssetBlock` (idempotent markdown block), `loadApprovedToolkitAssets`, `syncToolkitAssetBlock(pathwayId)` |
| Domain logic | `lib/grid-update.ts` | `ParsedGridUpdate` gains contributor-only `toolkitAssetCandidates` and explorer-only `toolkitAssetsReferenced` |
| Domain logic | `lib/system-prompts.ts` | `contributorSystemPrompt`: asset-identification section; `gridUpdateContract` options for both new fields; `explorerSystemPrompt`: approved-assets block + surfacing rule; `pathwayDraftSystemPrompt`: omit the asset block |
| Framework content | `content/framework.md` | Add the Playbook and Toolkit Asset rows to "The five unit types" |
| Client logic | `lib/adoption-conversation.ts`, `lib/extract-text.ts` | Keep asset-eligible `File`s in memory (contributor flow); accept ZIP (and oversize images) as asset-only attachments; handle candidates → confirmation card → S3 upload → register; persist `toolkitAssetsReferenced` on explorer messages |
| Routes/API | `app/api/toolkit-assets/upload-url/route.ts` (new) | `pathway_contributor` + membership + type/size check → S3 presigned POST |
| Routes/API | `app/api/toolkit-assets/route.ts` (new) | POST: register a confirmed asset (both confirmations true, `HeadObject` passes, key under that pathway's prefix) → `contribution_units` row, `review_status='pending'`. GET `?ids=`: approved-asset card metadata for the explorer |
| Routes/API | `app/api/toolkit-assets/[id]/download/route.ts` (new) | Role/status check → 302 to a 60 s presigned GET (file) or the stored `link_url` (link) |
| Routes/API | `app/api/admin/toolkit-assets/approve/route.ts`, `.../reject/route.ts` (new) | `isAdmin`; approve = status + `published_at` + document-block sync; reject = status + delete the S3 object |
| Routes/API | `app/api/pathways/assemble/route.ts`, `app/api/admin/pathways/publish/route.ts` | Re-apply the approved-asset block to content before writing |
| Routes/API | `app/api/chat/route.ts` | Explorer branch only: load approved assets and pass them to `explorerSystemPrompt` |
| Routes/API | `app/api/admin/pathways/delete/route.ts`, `app/api/account/delete/route.ts` | Delete S3 objects before rows cascade / are deleted (account delete: unpublished assets only; published ones survive, matching `0033`) |
| External integration | **AWS S3 (new to this app)**, GitHub (`lib/github.ts`, existing) | New bucket; approval commits the updated `.md` |
| Frontend | `components/ToolkitAssetConfirmCard.tsx` (new), `components/ChatPanel.tsx` | Contributor confirmation card (two explicit Yes/No + Submit) from a client-constructed message marker |
| Frontend | `components/PathwayDocumentPane.tsx` | "Toolkit assets" status list for the contributor |
| Frontend | `components/AdminToolkitAssetsPanel.tsx` (new), `app/admin/page.tsx` | Pending-asset review list (preview, approve, reject) |
| Frontend | `components/ToolkitAssetCard.tsx` (new), `components/ChatPanel.tsx` | Explorer download cards under an assistant message |

## Architectural Approach

**1. Where it lives.** Everything stays inside the existing Contributor → Admin → Explorer pipeline, on the same layering as pathway documents:
- The contributor workspace produces a candidate.
- An admin gate makes it live.
- The explorer companion consumes the live state.

There's no new page and no ninth `/api/chat` mode. It crosses **one new external boundary, AWS S3**: a new vendor SDK, new credentials, and a manually provisioned bucket. That is a deliberate exception to the app's "Supabase is the only stateful dependency" stance, chosen by the requester. It is contained behind one server-only module (`lib/s3.ts`), in the same way `lib/github.ts` isolates GitHub, so a later move (e.g. to Supabase Storage or a new AWS account) is a one-module swap. This matches `lib/wiki-loader.ts`'s stated intent that "S3 is the likely eventual home" for corpus content.

**2. The model signals, the client acts (invariant kept on both sides).**
- *Contributor side:* the companion only adds `toolkitAssetCandidates: [{source: {fileName} | {url}, name, purpose, reuseCondition, dimension?, stage?}]`. The client renders a **confirmation card** with two explicit Yes/No controls. Only when both are Yes does the client upload and register. Consent is stored as `share_consent` + `share_consented_at`, never inferred from chat text.
- *Explorer side (Option B):* the companion only adds `toolkitAssetsReferenced: [assetId]`. The client drops any ID not returned by `GET /api/toolkit-assets?ids=` (approved only), renders a card per surviving ID, and persists the IDs on the message (as `pathwaysReferenced` is today) so the cards survive reload. The model never writes a URL.

**3. Identification uses the existing definition, which must be present.** The "is this a real reusable artifact" test already exists in `content/pathway-generation-prompt.md:108`. But the contributor companion prompt injects `framework.md`, not that file, and `framework.md`'s unit-type table (`:294-300`) lists only 3 of the 5 types. Adding the Playbook and Toolkit Asset rows is a functional dependency.

**4. Upload path: browser → S3 directly.** Vercel route handlers cap bodies at about 4.5 MB, well under 25 MB. The flow is:
1. `upload-url` checks role, membership, extension and declared size.
2. It returns an S3 **presigned POST** for key `<prefix>toolkit-assets/<pathwayId>/<uuid>/<safe-name>`, with a `content-length-range` condition (1 B – 25 MB) and a fixed `Content-Type`. S3 itself therefore enforces the cap.
3. The browser uploads directly.
4. `POST /api/toolkit-assets` runs `HeadObject` to confirm the object exists and its size, checks the key belongs to that pathway, and inserts the row with the service-role client.

Presigned POST is used over presigned PUT because PUT cannot enforce a maximum size.

**5. Records in `contribution_units`.** Each asset is one row:
- `section='micro-innovation'`, `unit_type='toolkit-asset'`
- `unit_internal_id='asset-<uuid>'` as the stable ID
- `published_at` = approval time (the table's documented meaning, "non-null = published")
- `review_status` for pending / approved / rejected
- `storage_key` holds the S3 key

**6. The document block is derived, not hand-edited.** `applyToolkitAssetBlock(markdown, approvedAssets)` replaces everything between `<!-- toolkit-assets:start -->` and `<!-- toolkit-assets:end -->`. If the markers are absent, it inserts the block at the end of Section 4 "Toolkits and playbooks" (before the next Section 5 / 6 / Source Trace heading), falling back to just before Source Trace. It lists name, kind, purpose and reuse condition, each with an `<!-- asset-id: … -->` marker, and **no download link**.

`syncToolkitAssetBlock(pathwayId)` writes it to three places:
- `pathways.content_cache`
- `published_pathways.content` (if live)
- the GitHub `.md` (if assembled)

It runs on approval, and `applyToolkitAssetBlock` also runs inside `assemble` and admin `publish`, so a new contributor draft can never drop approved assets. `pathwayDraftSystemPrompt` is told to omit that block.

**7. Surfacing in `/analyse`.** For `flow==='explorer'` companion turns only, the chat route loads approved assets (`loadApprovedToolkitAssets`: `review_status='approved'`, joined to `pathways.slug`) and passes `id, pathwaySlug, name, purpose, reuseCondition, kind` to `explorerSystemPrompt`. The prompt rule:
- Reuse the existing matching discipline (same sector + same use-case, or close problem match).
- Name the asset in one short framing clause in prose.
- Put its ID in `toolkitAssetsReferenced`.
- Frame it as a suggestion, and never pad.

The download is always `GET /api/toolkit-assets/[id]/download`, which re-checks role and approval on every click.

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Supabase Storage (original default) | Requester chose S3. It would have avoided a new vendor, SDK and credentials; that cost is accepted and contained in `lib/s3.ts`. |
| S3 presigned PUT | Cannot enforce a maximum object size; presigned POST can (`content-length-range`). |
| Proxy uploads/downloads through Next.js routes | Breaks on Vercel above ~4.5 MB, and doubles bandwidth through the app. |
| Model asks the yes/no in prose | Consent would be model-mediated free text with no hard record. An explicit UI control is unambiguous and auditable. |
| Upload every contributor file on attach, delete if declined | Violates O3 ("not stored if No"), even briefly. |
| Option A: model writes inline download links | Rejected at review (D-Q6 = B). A mistyped or invented ID would render a broken link. |
| New dedicated `toolkit_assets` table | Requester chose `contribution_units` (D-Q9/10). |
| DB-only prompt injection, no `.md` update | Requester wants both (D-Q11). The DB-driven prompt block is kept too, because static curated pathways never get the markdown block. |
| GitHub as file storage | Binary bloat in the app repo, publicly served, and no role-checked access. |

## Key Tradeoffs

**Tradeoff: AWS S3 as a second stateful vendor**
- Decision: files in S3; records in Supabase.
- Gained: the requester's preferred storage; aligned with the Docker/AWS deployment direction and `wiki-loader`'s stated S3 intent.
- Given up: a new SDK dependency, new secrets on Vercel, manual bucket provisioning with no IaC, and **no transactional link** between the Supabase row and the S3 object (orphans possible either way). The files also sit in an **AWS account that expires Dec-2026** (see Risks).

**Tradeoff: in-memory file retention until confirmation**
- Decision: keep candidate `File`s in the hook's memory until the contributor answers.
- Gained: nothing stored before consent (O3), no orphan objects from declined files.
- Given up: a reload between upload and confirmation loses the file.

**Tradeoff: `contribution_units` as the anchor**
- Decision: reuse the dormant table and add asset columns.
- Gained: no new table, the existing select RLS (own + published) fits, and account-deletion handling already exists (`0033`).
- Given up: asset rows sit beside the not-yet-built "unit per row" model for the "Enhance Framework/Pathway schema" backlog item, and that future work must respect them.

**Tradeoff: approval edits live published content (accepted at review)**
- Decision: approval regenerates the block in `published_pathways.content` directly.
- Gained: the document always matches approved assets.
- Given up: a new write path into live content outside the pathway-publish click, plus one GitHub commit per approval.

**Tradeoff: tighten `contribution_units` RLS**
- Decision: drop the client insert/update policies; all writes go through service-role routes.
- Gained: closes a self-approval hole (the existing insert policy would allow a row with `published_at` pre-set).
- Given up: nothing today, since no code writes this table.

## Non-Functional Impact

- **Performance/scale:** one extra indexed Supabase query per explorer companion turn, plus one small `GET /api/toolkit-assets?ids=` per assistant message that references assets. The prompt grows by about 50 tokens per approved asset: negligible now, linear later. File bytes never pass through the app (browser ↔ S3 directly).
- **Availability/failure modes:**
  - *S3 unavailable or misconfigured:* upload-url and download fail with a handled error. Contributor chat and explorer chat keep working, and cards show "download unavailable".
  - *Approval:* DB state is set first, then the document sync runs. If sync fails, the route returns `{approved: true, docSync: 'failed'}`, and re-calling approve on an approved row re-runs the idempotent sync.
  - *Browser upload succeeds but register fails:* the object is orphaned; tolerated and flagged.
  - No new Anthropic call is added, so TD-05 exposure is unchanged.
- **Security:**
  - Private bucket with Block Public Access. Every read is a 60 s presigned GET minted only after `hasRole('adopter')` / `isAdmin` / owner and `review_status='approved'` (owner and admin excepted).
  - Keys are server-built with sanitised file names; the client never chooses a key.
  - Links must be https and are admin-reviewed before being served; the redirect target is only the stored `link_url`.
  - Least-privilege IAM limited to the prefix. AWS keys are server-only (never `NEXT_PUBLIC_`).
  - RLS tightening as above.
  - **No malware or PII scanning** of uploads (charter NFR, Not started), flagged.
- **Consistency/coupling:** new dependencies are explorer prompt ← `contribution_units` and approval → `published_pathways` / GitHub. One renderer module is reused by three writers (approve, assemble, publish).

## Data Model / API Changes

**Migration `0034_contribution_units_toolkit_assets.sql`** (additive except the policy drop, and the header comment says so):
- New columns on `contribution_units`:
  - `asset_kind text check (asset_kind in ('file','link'))`
  - `asset_name text`, `purpose text`, `reuse_condition text`
  - `storage_key text`, `file_name text`, `mime_type text`, `size_bytes bigint`
  - `link_url text`
  - `share_consent boolean not null default false`, `share_consented_at timestamptz`
  - `review_status text not null default 'pending' check (review_status in ('pending','approved','rejected'))`
  - `reviewed_by uuid references auth.users(id) on delete set null`, `reviewed_at timestamptz`
- Checks that apply when `unit_type='toolkit-asset'`: `asset_kind` required; `file` ⇒ `storage_key` (unless rejected); `link` ⇒ `link_url`; `share_consent = true`; `review_status='approved'` ⇔ `published_at is not null`.
- Partial index on `(pathway_id, review_status) where unit_type = 'toolkit-asset'`.
- `drop policy` for the two client insert/update policies.

**Routes**

| Method | Path | Auth | Request → Response |
|---|---|---|---|
| POST | `/api/toolkit-assets/upload-url` | `pathway_contributor` + membership | `{pathwayId, fileName, size, mimeType}` → `{key, url, fields}` (presigned POST); 400 on type/size |
| POST | `/api/toolkit-assets` | `pathway_contributor` + membership | `{pathwayId, designId, kind, storageKey?, linkUrl?, fileName?, name, purpose, reuseCondition, dimension?, stage?, isToolkitAsset: true, shareConsent: true}` → `{id, reviewStatus:'pending'}`; 400 if a confirmation ≠ true, the object is missing/oversize, or the key is outside the pathway prefix |
| GET | `/api/toolkit-assets?ids=a,b` | `adopter` | `[{id, name, purpose, kind, fileName?, sizeBytes?, pathwaySlug, pathwayTitle}]` (approved only; unknown IDs omitted) |
| GET | `/api/toolkit-assets/[id]/download` | `adopter` (approved) / `isAdmin` / owner | 302 → presigned GET or `link_url`; 401/403/404 otherwise |
| POST | `/api/admin/toolkit-assets/approve` | `isAdmin` | `{id}` → `{approved: true, docSync: 'ok'\|'failed'\|'skipped'}` |
| POST | `/api/admin/toolkit-assets/reject` | `isAdmin` | `{id}` → `{rejected: true}` (S3 object deleted) |

**`<grid_update>` contract:** contributor gains optional `toolkitAssetCandidates[]`; explorer gains optional `toolkitAssetsReferenced: string[]`.

## Risks & Open Items

1. **AWS account expires December 2026** (Product Charter; plan a new account by Nov-2026). Every stored asset file lives there. **The migration plan must include copying the bucket**, not only the Docker deploy. This is the highest-impact risk this plan introduces.
2. **Manual infrastructure:** bucket, CORS, IAM and env vars are provisioned by hand (no IaC in the repo). A wrong CORS origin shows up as an opaque browser upload failure. `s3-setup.md` is the mitigation.
3. **No malware/PII screening** of uploaded files (charter NFR, Not started). The admin panel labels files "not scanned"; admin review is the only check.
4. **Supabase ↔ S3 consistency:** there is no cross-store transaction. Orphans are possible (upload OK, register failed) and dangling rows are possible (object deleted out-of-band). Download handles a missing object with a 404 card state; an orphan sweep is future work.
5. **Pathway slug collision with static curated pathways** (e.g. a contributor-created `mahavistaar` alongside the static file, since `uniqueSlug` checks only `pathways`). Pre-existing, but it hits the requester's own example. Flagged, not fixed.
6. **Source Trace in the prompt corpus** (`lib/wiki-loader.ts` doesn't strip it). Pre-existing, out of scope. The asset block is placed before Source Trace.
7. **Prompt growth** from the approved-asset list every explorer turn. Negligible now; revisit with retrieval.
8. **TD-16:** the Anthropic account expires **28-Oct-2026**. Candidate identification and explorer surfacing depend on it; S3 upload, admin approval and download do not. No hard delivery date (O9).
9. **Wiki refresh** after landing (`llm-wiki`): TD-04 is no longer inert, S3 is a new integration with new env vars, the migration count becomes 34, and there are new routes.

## Sequencing

1. **S0** Provision the S3 bucket + IAM + CORS + env vars (checklist), and add the AWS SDK dependencies and `lib/s3.ts`
2. **S1** Migration `0034` + `lib/toolkit-assets.ts`
3. **S2** `framework.md` unit-type rows + contributor prompt section + `toolkitAssetCandidates` contract/parse
4. **S3** Contributor client: retention, ZIP/oversize-image as asset-only, confirmation card, `upload-url` + register routes, status list
5. **S4** Admin: panel, approve (with sync) and reject routes; block re-apply in `assemble` + `publish`; draft prompt instruction
6. **S5** Download route + `GET /api/toolkit-assets?ids=`
7. **S6** Explorer surfacing: prompt block + rule + `toolkitAssetsReferenced` + cards
8. **S7** S3 cleanup in pathway-delete and account-delete routes

S0 and S1 come first. S2 and S3 go together. S4 and S5 can run in parallel after S3. S6 needs S5. S7 can go any time after S1.

## Future Upgrade Roadmap (documentation only, not in scope, per Q12)

1. **Structured metadata** aligned to the company-brain toolkit schema: `toolkit_type` vocabulary (Technical Template, Governance Framework, Testing Protocol, Prompt Pattern, Vendor Criteria, Process Playbook), applies-when / fails-when, version.
2. **Toolkit Catalogue** page: browse and filter approved assets by type, stage, dimension and sector.
3. **"Adapt this for me"**: an AI mode that tailors an approved template to the adopter's own grid/meta.
4. **Reuse signals**: download counts and "this helped" feedback shown to the contributor, feeding the *Incentivize Contributors* (15-Jan-27) and *Usage & Reuse* (15-Feb-27) milestones. The download route is the natural place to count.
5. **Versioning, supersession, freshness**, plus the **revoke/unpublish** deferred by O5.
6. **Gap-matched suggestions**: assets matched to the adopter's thin grid cells, and a "Toolkits you can use" section in the Analysis Document.
7. **Upload safety**: malware and file-type sniffing, PII screening (charter NFR).
8. **Backfill** of the 36 corpus-described assets by admins (deferred by O1).
9. **Orphan sweep** reconciling S3 objects against `contribution_units` rows.
