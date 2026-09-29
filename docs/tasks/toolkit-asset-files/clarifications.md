# Clarifications: Toolkit Asset Files

Stage 2 of `brd-task-creator`. **Answered 2026-09-29.** See "Answers" at the bottom. Any gap still open is carried into `plan.md` as a labelled Assumption.

## Repo / DB findings these questions are based on (2026-09-29)

- A Toolkit Asset is **one of five unit types** (`lib/dimensions.ts` `UNIT_TYPES`). In a pathway `.md` it appears as a Section 3 unit (`Type: Toolkit Asset` with the fields *Toolkit asset / Purpose / Reusable as-is / Condition — applies when*) and as a row in the Section 4 "Toolkits and playbooks" table (max 6 rows). Section 6 "Retrieval guide" points to units by number. Source spec: `content/framework.md` §4, `content/pathway-generation-prompt.md`.
- **Nothing stores files.** There are no Supabase Storage buckets (checked live, `listBuckets()` → `[]`) and no storage code. Uploads are text-extracted in the browser (`lib/extract-text.ts`) and then discarded.
- `contribution_units` (migrations `0022`/`0025`/`0033`) already has `unit_type = 'toolkit-asset'`, `pathway_id`, `dimension`, `stage`, `content`, `published_at` and correct RLS. It has **0 rows** and no code writes to it (TD-04).
- Live DB: `pathways` = 2 (`langchat` assembled with review requested, and `documenting-insights`). `published_pathways` = 0. 3 `draft` design documents, **none with a Toolkit Asset unit**. All real toolkit content today is in the committed grounding corpus (`content/wiki/pathways/`, 36 Toolkit Asset units across 8 files, 17 of them in MahaVISTAAR). The Library corpus (`content/library-wiki/`) has none.
- A precedent already exists for "surface a link in conversation": `content/resources.md` is injected into the Explorer prompt and rendered as markdown links (`lib/system-prompts.ts:292`).
- The company brain (`anurag14-10/Anurag-Brain`) models `toolkit` as a first-class entity: `toolkit_type` from a controlled vocabulary (Technical Template, Governance Framework, Testing Protocol, Prompt Pattern, Vendor Criteria, Process Playbook), `purpose`, `conditions_for_reuse`, a `pathway` ref, `external_refs`, supersession and review fields. Units link to toolkits many-to-many. Its one toolkit entry is asserted, not corroborated.

## Questions

### A. What gets stored, and by whom
1. **Uploader:** contributors attach files while in `/contribute`, admins attach them from `/admin`, or both? Who backfills the 36 assets in the committed corpus? *Default: both. Admins backfill.*
2. **Asset forms:** uploaded files only, external links only (GitHub repo, openagri.net, etc.), or both? Which file types, and what size cap? *Default: both; PDF/DOCX/XLSX/PPTX/CSV/MD/images/ZIP; 25 MB.*
3. **Licensing and permission:** must each asset declare a licence and "OK to share with other adopters"? Some assets are request-only ("contact EkStep Foundation"). Should those appear as *request access* instead of *download*? *Default: licence and share-permission are required. Request-only assets show contact info, not a file.*

### B. Who can access it
4. **Audience:** any signed-in user with a role, `adopter` only, or public `/explore` visitors too? *Default: any signed-in user with a role. Not public.*
5. **Review gate:** does a file go live only with an admin publish (same as the two-step pathway publish), or does it need its own per-file review? *Default: per-file admin approval, independent of the document, so a new asset on an already-published pathway doesn't need a full republish.*

### C. How it appears in conversation
6. **Surfaces:** `/analyse` companion, `/explore` library chat, `/wiki/<slug>` page, the Analysis Document, or a subset? *Default: companion + `/wiki` page + Analysis Document in phase 1; library chat later.*
7. **Presentation:** (a) the model writes an inline markdown link, as `resources.md` does today, or (b) the model signals asset IDs in a new `<grid_update>` field (e.g. `toolkitAssetsReferenced`) and the client renders validated download cards? *Default: (b). The model cannot invent URLs, and the existing rule that the model signals and the client acts is kept.*
8. **Download mechanism:** a private bucket with short-lived signed URLs issued by an API route that checks the role, or a public bucket? *Default: private + signed URLs.*

### D. Data model and architecture
9. **Storage backend:** Supabase Storage (new to this app, but same vendor and same RLS model), GitHub (as `assemble` does), or S3 (the AWS path)? *Default: Supabase Storage.*
10. **Anchor table:** revive `contribution_units` (TD-04) as the unit record and hang files off it, or add a dedicated `toolkit_assets` table keyed by pathway plus a stable asset ID? Note: unit **numbers** get renumbered when a pathway is revised, so they cannot be the key. *Default: a new `toolkit_assets` table with a stable ID, a `<!-- asset-id: … -->` marker in the markdown, and files in `toolkit_asset_files`. Leave `contribution_units` for the separate "Enhance Framework/Pathway schema" item.*
11. **Corpus:** grounding corpus only (`content/wiki/pathways/` + `published_pathways`)? The Library corpus has no toolkit units (TD-02). *Default: grounding corpus only.*

### E. Enhancements and upgrade plan scope
12. **Which enhancement tracks should the upgrade plan cover** (select any)?
    - (a) Structured toolkit metadata aligned with the brain schema: `toolkit_type`, dimension/stage, applies-when/fails-when, licence, version
    - (b) A **Toolkit Catalogue** page to browse and filter assets across pathways (type, stage, dimension, sector)
    - (c) **"Adapt this for me"**: the AI tailors a template or checklist to the adopter's own context (a new chat mode)
    - (d) Reuse signals: download counts, "this helped" and "we adapted it" feedback, visible to the contributor. This feeds the *Incentivize Contributors* and *Usage & Reuse* milestones
    - (e) Versioning and supersession of assets, plus a "last reviewed" freshness indicator
    - (f) A "Toolkits you can use next" section in the Analysis Document, and asset suggestions tied to the adopter's grid gaps
    - (g) Safety on upload: malware/type sniffing, PII screening (a charter NFR)
13. **Timeline:** must phase 1 ship before the **28-Oct-2026** Anthropic account expiry (TD-16), or can it follow? *Default: storage and download (no AI dependency) first; conversation surfacing second.*
14. **Frontend placement:** should a catalogue page (if 12b is chosen) get its own `AppShell` + `Sidebar` like `/analyse` and `/contribute`, or live under the `(app)` route group next to `/wiki`? *Default: under `(app)` next to `/wiki`.*

## Answers (Anurag Goutam, 2026-09-29), with our interpretation

| # | Answer as given | Interpretation used for the plan |
|---|---|---|
| 1 | Contributor only | Only `pathway_contributor` users attach assets, and only inside their own `/contribute` workspace. No admin upload path. |
| 2 | PDF, docs, ZIP, images, GitHub links | Allowed asset forms: PDF, DOC/DOCX (and other office docs), ZIP, images, and GitHub/URL links. |
| 3 | Must ask "OK to share with other adopters?", yes/no. First identify whether it's an appropriate asset | The contributor companion first judges whether the upload is a genuine Toolkit Asset (the existing "actual reusable artifact" bar in `pathway-generation-prompt.md`). Only if it is, it asks the contributor to confirm (a) it's a toolkit asset and (b) it's OK to share with other adopters. It needs an explicit yes or no; nothing is inferred. |
| 4 | Audience is Explorers | Visible only to signed-in `adopter` users. |
| 5 | Review gate, including for assets added after a pathway is already published | Per-asset admin approval, independent of the pathway document's publish step. Every new asset, including one added to an already-published pathway, waits for admin "publish or not". |
| 6 | Only in `/analyse`, for signed-in users | Surfaced only in the `/analyse` companion chat. Not `/explore`, not `/wiki`, not the Analysis Document. |
| 7 | Shown when relevant. E.g. a new analyser building something related to MahaVISTAAR sees the assets MahaVISTAAR used | Relevance-driven: the companion surfaces an approved asset when its pathway/unit matches what the adopter is working on, using the existing matching rule (same sector + same use-case, or a close problem match). |
| 9/10 | Store in the anchor table `contribution_units`, under a dedicated toolkit-asset type | Asset records live in `contribution_units` (`section='micro-innovation'`, `unit_type='toolkit-asset'`), with new columns added by migration. `published_at` doubles as the admin approval flag (null = pending). |
| 11 | Update the pathway `.md` and `published_pathways`, both | When an asset is approved, its reference is written into the pathway document in both places the corpus reads from: `pathways.content_cache` / the GitHub `.md`, and `published_pathways.content`. |
| 12 | No enhancements now | Scope is only the explicit gate: contributor adds asset → AI checks it → contributor confirms toolkit + share → admin approves → adopters see it in `/analyse`. Enhancement ideas go into `plan.md` as a future roadmap only, not built. |
| 14 | n/a | No catalogue page in scope, so no new page placement decision. |

## Follow-up answers (2026-09-29)

| # | Decision |
|---|---|
| O1 | Default: **no backfill**. Only newly uploaded assets. |
| O2 | Default: **25 MB** per file. |
| O3 | Default: if the contributor answers No, **the file is not stored**. |
| O4 | Default: **no licence field**, just the share yes/no. |
| O5 | **No revoke/unpublish function in this version**, for admin or contributor. |
| O6 | **Open, to be discussed.** How an asset is presented in `/analyse` chat (inline link written by the model vs asset IDs in `<grid_update>` rendered as client cards). Carried into `plan.md` as the one open decision. |
| O7 | Default: record in `contribution_units`, **file in a private Supabase Storage bucket**, short-lived signed download links. |
| O8 | Default: the `.md` / `content_cache` / `published_pathways` update happens **at admin approval**. |
| O9 | **No hard date.** The 28-Oct-2026 Anthropic expiry is flagged as a risk only. |

## Plan-review decisions (2026-09-29)

| Item | Decision |
|---|---|
| Storage backend (O7 revised) | **AWS S3** (private bucket), not Supabase Storage. Records stay in `contribution_units`. |
| D-Q6 | **Option B**: the explorer companion returns `toolkitAssetsReferenced` IDs in `<grid_update>`; the client validates them and renders download cards. |
| Approval edits live content | **Accepted**: approving an asset regenerates the asset block in `published_pathways.content` without a separate publish click. |
