# Business Workflows

This page gives the workflow IDs and narrative steps only. The diagrams live in [`../architecture/sequence-diagrams.md`](../architecture/sequence-diagrams.md), and this page links to them instead of repeating Mermaid blocks.

## W1 — Companion chat turn

**Trigger**: any message sent or file uploaded inside an `/analyse` or `/contribute` conversation.
**Endpoint**: `POST /api/chat` with `mode: 'companion'`.
**Diagram**: [`sequence-diagrams.md#w1`](../architecture/sequence-diagrams.md#w1--companion-chat-turn-mode-companion).

1. The client hook (`lib/adoption-conversation.ts`) creates a `designs` row on the first message or first upload for the conversation. Concurrent attempts are de-duplicated.
2. The route rate-limits the caller (per account, scope `chat-user`), checks request size and shape (413/400), and checks the role this `mode` + `flow` needs (`requiredRole`: Contributor work needs `pathway_contributor`, everything else needs `adopter`).
3. **Grounding by retrieval** (`lib/retrieval.ts`): a small Claude Haiku classifier (`CLASSIFIER_MODEL`) reads the latest turns and picks a query kind (`specific`, `situation`, `broad` or `patterns`) plus optional sector/dimension/stage/type filters. `buildGrounding` then fetches only what that kind needs: whole published documents for named pathways, the best-matching lessons (`pathway_units`) from hybrid search (`match_pathway_units`: meaning + keyword search, combined by reciprocal-rank fusion), or lessons grouped across pathways with exact counts. If the classifier fails, a default classification is used. If embedding fails, search falls back to full text + labels. The whole corpus is no longer sent with every message.
4. The framework, the retrieved grounding and the conversation's current `meta`/`grid` state go into the system prompt. Claude (`claude-sonnet-4-6`) streams a reply that ends in a `<grid_update>` JSON block.
5. The client parses and strips the block, merges changed cells into `grid_state`, and persists `meta`.
6. If the block signals `explorerAction` or `pathwayAction`, the client makes a second API call automatically (see W2/W3) and appends a client-constructed message with a document card. If the block lists `toolkitAssetsReferenced`, download cards for those published assets appear under the reply (see W5).

The `/explore` library chat follows the same grounding step with its own surfaces (`explore-pathway`, `explore-overview`). Anonymous callers are rate-limited per IP (scope `explore`).

## W2 — Contributor publish

**Trigger**: a Contributor's conversation reaches a settled stage and generates a draft, and the contributor chooses "Send for review".
**Endpoints**: `POST /api/pathways/assemble` (contributor step), `POST /api/admin/pathways/publish` (admin step). The admin reads the version under review through `GET /api/admin/pathways/document`.
**Diagram**: [`sequence-diagrams.md`](../architecture/sequence-diagrams.md) (W2).

There are two separately gated steps, both inside the app's own database. Nothing is committed to GitHub and nothing needs a redeploy (`docs/features/pathway-storage/`).

1. **Send for review** (contributor; route still named `assemble`): takes the latest `design_documents` draft for this contributor's own workspace, adds the pathway's shared toolkit-asset files to Section 4 (`applyToolkitAssetFiles`), and saves it as the next numbered `pathway_versions` row (`saveVersion`, `source='contributor'`). It also sets `pathways.content_cache`, `review_requested = true` and `assembled_design_doc_id`. A `draft` pathway moves to `in_review`. An already-published pathway stays `published` and visible while its new version waits. Nobody else can see the new version (migration `0040` limits pathway reads to its contributors and admins).
2. **Publish** (admin, from `AdminPathwaysPanel`, which can filter by status): `publishVersion` points `pathways.published_version_id` at the latest version, sets `status = 'published'`, copies card fields (title, sector, stage, location, tags, organisation) from the document's frontmatter, and replaces the pathway's `pathway_units` with the units parsed from Section 3, embedded for search. Units with invalid labels are skipped and reported back to the admin. If embedding fails, the units are saved without vectors and stay findable by keyword. The toolkit assets listed in the published document are published at the same time, and the contributor is emailed. The pathway shows up in the library (`published_pathways` view) and in Analyse grounding on the next request.

> **Note:** `CLAUDE.md` once described the Contributor's own "Publish" button as fully self-serve, and the wiki before November 2026 described a GitHub commit at the assemble step. Neither matches the code any more. `lib/github.ts` and all `GITHUB_*` settings were removed by the pathway-storage feature.

## W3 — Explorer analysis document

**Trigger**: the companion judges there is enough conversational substance, or an upload establishes sector + problem straight away.
**Endpoint**: `POST /api/chat` with `mode: 'analysis-doc'`, then optionally `mode: 'executive-summary'`.
**Diagram**: [`sequence-diagrams.md#w3`](../architecture/sequence-diagrams.md#w3--explorer-produces-an-analysis-document).

1. The companion sets `explorerAction: "analysis"` in its `<grid_update>` block.
2. The client calls `analysis-doc` mode. The route grounds the document on the adoption's own summary (sector, name, summary, hypothesis) through the same retrieval step as W1 (surface `document`). The result is stored in `design_documents` (`doc_type='analysis'`) and cached by content hash, so an unchanged conversation is served without a new model call.
3. A client-constructed chat message with an `<analysis_doc/>` card is appended. It reopens the stored document.
4. The Executive Summary (`doc_type='plan'`) can be generated afterwards as a smaller, separate second document.

## W4 — Signup and access

**Trigger**: a new visitor signs up.
**Endpoints**: Supabase `auth.signUp` (client SDK) → database trigger → (admin action later, contributors only) `POST /api/admin/contributor-registrations/approve` or `POST /api/admin/roles`.

1. Two-step signup form on `/login`: details first, then a 6-digit email OTP (`verifyOtp`). The OTP can be resent after a 60-second cooldown.
2. When Supabase Auth creates the account, the `on_auth_user_created_grant_adopter` trigger inserts the `adopter` role in the same transaction (migration `0039_default_adopter_role.sql`). There is no client call and no pending/approval state. The old `/api/auth/grant-default-role` route has been removed.
3. `/analyse` works straight away. `/contribute` also needs the one-time registration form (`ContributorRegistrationGate.tsx`) and an admin's approval, which grants `pathway_contributor`.

## W5 — Toolkit asset sharing and reuse

**Trigger**: a contributor has a reusable file or link behind a Toolkit Asset in their pathway (a template, a checklist, a dataset description), or the companion finds one in their uploaded material.
**Endpoints**: `POST /api/toolkit-assets/upload-url` (signed upload URL, files only) → `POST /api/toolkit-assets` (register the asset row) → `DELETE /api/toolkit-assets/[id]` (contributor removes an unpublished asset); `POST /api/chat` `mode: 'asset-reuse'` (drafts the asset's purpose + reuse condition); public `GET /api/toolkit-assets` and `GET /api/toolkit-assets/[id]/download`.
**Diagram**: none yet in `sequence-diagrams.md`.

1. **Find and decide** — in the contributor's chat, a **resource review card** (`ResourceReviewCard.tsx`) lists each potentially reusable resource found in their material. The contributor decides on each one, can add any number of other files, and clicks Done, which updates the draft once. Under a generated pathway draft, an **asset share card** (`AssetShareCard.tsx`) lists each asset that Section 4 names, with an upload or link slot for each (or asks "do you have any?" when Section 4 lists none). The **Reusable assets** panel in the workspace header (`ReusableAssetsPanel.tsx`) shows the same list in one place.
2. **Consent** — nothing is stored until the contributor explicitly agrees to public sharing. A single-asset **consent card** (`ToolkitAssetConsentCard.tsx`) asks the one question; on the share card, the note above Confirm acts as the consent. "No" stores nothing.
3. **Store** — a file goes to the private `toolkit-assets` bucket (25 MB cap, fixed MIME list, no ZIP). A link must be `https://`. Each asset is one `contribution_units` row (`unit_type='toolkit-asset'`, `share_consent = true`, `published_at` null). For an asset the contributor adds themselves, `asset-reuse` mode drafts a one-sentence purpose and a reuse condition from the contributor's own words.
4. **Review with the pathway** — "Send for review" (W2 step 1) writes the assets into Section 4 of the saved version with an asset-id marker. An admin can preview unpublished assets.
5. **Publish** — the admin's publish (W2 step 2) sets `published_at` on exactly the assets listed in the reviewed document. An asset shared after the last Send for Review waits for the next round.
6. **Reuse** — when an Analyse reply (`<grid_update>.toolkitAssetsReferenced`) or an Explore reply (`<toolkit_assets>` tag) cites a published asset, `ToolkitAssetCards.tsx` shows a download card. Downloads need no sign-in. They are streamed through the route so the storage URL is never exposed, and an unknown or unpublished id shows nothing.

Feature docs: `docs/features/toolkit-asset-files/`.

## W6 — Seeding pathways (operator, one-time)

**Trigger**: an operator loads a set of source documents into a Supabase project (dev first, then prod), after migration `0042` and the `embed` Edge Function are deployed.
**Command**: `npm run seed:pathways -- --manifest <path> [--dry-run] [--only slug1,slug2] [--regenerate]` (`scripts/seed-pathways.ts`, helpers in `lib/seed.ts`, example manifest `scripts/seed-manifest.example.json`).
**Diagram**: none (a CLI script, not a request flow).

1. The manifest lists each pathway's slug, title, optional sector/organisation, and its files (pdf, docx, xlsx/xls, pptx, txt, md). Files are contributor-only unless marked `"public": true`.
2. For each pathway, the script extracts the text of each file and generates the pathway document with Claude, using the same generation prompt as contributor drafts. The result is cached in `.seed-cache/<slug>.md` so a re-run doesn't pay for generation again.
3. Only then does it write: the `pathways` row (`is_seed = true`), the original files in the private `pathway-sources` bucket, their text as embedded `pathway_source_chunks`, a `pathway_versions` row (`source='seed'`), and a publish. Seeded pathways skip admin review (a business decision recorded in the feature docs).
4. Re-running for a slug adds a new version and replaces its sources, so nothing is duplicated. `--dry-run` only validates and extracts.

Seeded source passages are a fallback in chat: they are used only when a pathway's write-up doesn't answer the question, and the answer names the source file (`pathwayPassages` in `lib/retrieval.ts`).

## W7 — Admin deletes (and so unpublishes) a pathway

**Trigger**: an admin deletes a pathway from the admin pathways panel.
**Endpoint**: `POST /api/admin/pathways/delete`.

1. Stored files go first: every toolkit-asset file for the pathway (in any status) and a seeded pathway's original documents. A storage failure is logged and does not block the delete.
2. The `pathways` row is deleted. `pathway_versions`, `pathway_units`, `pathway_sources`/`pathway_source_chunks`, `pathway_contributors` and `contribution_units` cascade with it. Because `published_pathways` is a view over `pathways` (migration `0042`), the pathway leaves the library and stops grounding answers in the same statement.
3. Contributors' own workspaces (`designs`) survive, just unlinked (`designs.pathway_id` is set to null, migration `0024`).

## Pathway lifecycle status

There is no batch-processing concept in this application. The closest analogue is a pathway's lifecycle, held in `pathways.status` (migration `0042`):

```
draft ──(contributor Send for review)──▶ in_review ──(admin publish)──▶ published
                                                                          │
published ──(contributor sends a new version)──▶ stays published, review_requested = true
published / any ──(admin delete)──▶ row removed (W7)
retired — allowed by the check constraint; no code sets it today
```

Seeded pathways go straight to `published`. Only `published` pathways are public (`published_pathways` view, `getPublishedDocument`). Comparing `pathways.published_version_id` with the latest `pathway_versions` row (or `assembled_design_doc_id` with `published_design_doc_id`) shows whether a newer version is waiting for review.

## Planned Workflows (Roadmap — not yet implemented)

Source: `docs/raw_documents/AI DIffusion Cube - Product Charter.docx`. These are listed as named future workflows so they aren't confused with W1–W7 above. (Before November 2026 they were numbered W5–W7.)

- **W8 — Contributor reuse/incentive loop.** A contributor would see how much their pathway has been reused and get insights from the questions other users asked about it. This would read `adoption_queries` (write-only today — see [`business-rules.md#monitoring-rule`](business-rules.md#monitoring-rule)) and needs a new read/aggregation surface. Toolkit-asset downloads are not counted anywhere yet either.
- **W9 — Pathway curation lifecycle (remaining parts).** Versioning, admin review and removal now exist (W2, W7). Still missing from the charter's "Contribute & Curate Pathways" scope: retiring or unpublishing a pathway without deleting it (the `retired` status is reserved but unused), and ongoing curation workflows beyond "send a new version".
- **W10 — Guided Adopter-to-Contributor transition.** Offering the option to contribute when an adopter's own analysis shows real maturity, without a hard mode switch. Today `flow` is fixed by the entry point — see [`users-and-personas.md#planned-vs-current-adoptercontributor-relationship`](users-and-personas.md#planned-vs-current-adoptercontributor-relationship).

## Where raw product docs describe steps not implemented

`SIGNUP_APPROVAL_OPTIONS.md` describes an email-link admin approval flow for *every* new signup, with roles set by hand in the Supabase Table Editor. That was superseded first by self-serve OTP with an admin dashboard, and then by automatic `adopter` at signup (W4). `CLAUDE.md`'s Contributor-flow description assumes single-step self-serve publish, which the two-step process in W2 superseded. The Product Charter's planned workflows (W8–W10) describe genuinely future work.

## Source files

`lib/adoption-conversation.ts`, `app/api/chat/route.ts`, `lib/retrieval.ts`, `lib/pathway-store.ts`, `lib/pathway-units.ts`, `app/api/pathways/assemble/route.ts`, `app/api/admin/pathways/publish/route.ts`, `app/api/admin/pathways/delete/route.ts`, `app/api/toolkit-assets/*`, `lib/toolkit-assets.ts`, `lib/toolkit-assets-server.ts`, `components/ResourceReviewCard.tsx`, `components/AssetShareCard.tsx`, `components/ToolkitAssetConsentCard.tsx`, `components/ReusableAssetsPanel.tsx`, `components/ToolkitAssetCards.tsx`, `scripts/seed-pathways.ts`, `lib/seed.ts`, `app/login/page.tsx`, `supabase/migrations/0034`, `0039`, `0040`, `0042`, `docs/features/pathway-storage/`, `docs/features/toolkit-asset-files/`, `docs/raw_documents/AI DIffusion Cube - Product Charter.docx`.
