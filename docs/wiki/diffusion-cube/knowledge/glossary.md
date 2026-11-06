# Glossary

## Product and framework terms

| Term | Meaning |
|---|---|
| **Pathway** | One real AI deployment's documented journey (e.g. MahaVISTAAR, Blue Dots). Stored as a `pathways` row (slug, status, card fields) with its document text in numbered `pathway_versions`. For a contributor it is also the shared workspace container that several contributors can join |
| **Corpus** | The whole body of **published** pathways the model can be grounded in. Since the pathway-storage feature it lives entirely in Supabase (no committed pathway files). Only the slice retrieved for each question reaches the prompt — see [`../integrations/ai-llm.md`](../integrations/ai-llm.md). In user-facing answers the model says "the documented pathways", never "corpus" |
| **Adoption** / **Design** | One user's conversation workspace. The UI calls it an "adoption" or "conversation"; the database table is `designs` (a legacy name predating the current terminology) |
| **Role** | One of `adopter`, `pathway_contributor`, `admin`. A user can hold several at once (multiple rows in `user_roles`). Every account gets `adopter` at signup from a database trigger (migration `0039`) |
| **Explorer** | A user with the `adopter` role (every signed-in user), analysing their own AI adoption against the documented pathways. Entry point `/analyse` |
| **Contributor** | A user with the `pathway_contributor` role (plus an approved registration), turning their own deployment into a new pathway. Entry point `/contribute` |
| **Organisation** | A shared registry row (`organisations`), found or created by name at join time and de-duplicated across contributors |
| **Grid** | A 4 dimensions × 4 stages matrix (16 cells) tracking how much is known about a user's adoption. Lives in `designs.grid_state` |
| **Dimension** | One of four: Persona, Solution, Institution, Ecosystem — four different questions about the same deployment, not four project phases |
| **Stage** | One of four: Explore → Define → Pilot → Scale — where a deployment is in its life. (Also a card field on `pathways.stage`, copied from the published document's frontmatter) |
| **Density** | How well established a grid cell is (0–3), shown as `○`/`●`/`●●`/`●●●` |
| **Sub-category** | A lettered subdivision within a dimension (4/5/7/6 respectively), each weighted Primary/Secondary/Dormant per stage |
| **Flow** | `'explorer'` or `'contributor'`. Fixed on an adoption at creation (`designs.meta.flow`); decides which system prompt runs and which role a chat call needs |
| **flowStep** | Which numbered step of its script the model reports being on for a given turn. Persisted and re-injected every turn, since the `<grid_update>` block is stripped before storage |
| **Design document** | A generated artifact stored in `design_documents`, one of three `doc_type`s: `analysis`, `plan` (Executive Summary), `draft` (pathway document) |
| **Micro-innovation** | A small practice borrowed from another adoption's lived experience, always framed as a suggested choice, never a recommendation. Each one is a **pathway unit** once published. Users hear "a practice another team used" |
| **Unit** | An individually tagged piece of pathway knowledge: Strategic Decision, Tactical Decision, Failure and Fix, Playbook, or Toolkit Asset, each with a condition tag. In the document it is an entry in Section 3; in the database it is a **pathway unit** row. Never said to users |
| **Condition tag** | The "applies when / fails when" annotation on every unit (`pathway_units.applies_when`, `fails_when`). Users hear "the conditions it worked under" |
| **Provenance / Source Trace appendix** | A section on each pathway document recording where its material came from. Contributor-only, stripped before any adopter-facing surface (`lib/provenance.ts`) |
| **Library** | `/explore` — the public, no-login pathway browsing + chat surface |
| **30/70 thesis** | Persona + Solution = building the right thing (30%); Institution + Ecosystem = the larger adoption work of governing, sustaining and scaling it (70%) |

## Pathway storage and lifecycle

| Term | Meaning |
|---|---|
| **Pathway version** | One saved copy of a pathway's full document (`pathway_versions` row, numbered per pathway, `source` = `contributor` or `seed`). Each "Send for review" or seed run adds one; `pathways.published_version_id` points at the live one |
| **Pathway status** | `pathways.status`, one of: **`draft`** (created, never sent for review), **`in_review`** (first version sent, waiting for an admin), **`published`** (live in the library and grounding; stays `published` while a newer version waits), **`retired`** (allowed by the check constraint, but no code sets it yet). Only `published` is public |
| **Send for review** | The contributor-side step (route `POST /api/pathways/assemble`, historically called "assemble"): saves the latest draft as the next pathway version and flags `review_requested`. It does not make anything public |
| **Publish (admin)** | The admin step (`POST /api/admin/pathways/publish`): makes the latest version live, copies card fields from its frontmatter, re-indexes its pathway units for search, and publishes its listed toolkit assets |
| **Published pathways** | Since migration `0042`, `published_pathways` is a **view** over `pathways` + `pathway_versions` showing only `status = 'published'`. It used to be a separate table that the admin copied into |
| **Pathway unit** | One micro-innovation from a published pathway's Section 3, stored as a searchable `pathway_units` row: title, type, dimension, sub-category, stage, "also relevant at", applies/fails when, body, a full-text index and a 384-dimension embedding. Parsed by `lib/pathway-units.ts`; rebuilt on every publish |
| **Pathway source / source chunk** | A seeded pathway's original document (`pathway_sources`, file kept in the private `pathway-sources` bucket) and its embedded text passages (`pathway_source_chunks`). Used only as a fallback when the write-up doesn't answer |
| **Seed pathway** | A pathway created by the one-time operator script `npm run seed:pathways` (`scripts/seed-pathways.ts`) from a manifest of source documents. Generated with Claude, published without admin review, flagged `pathways.is_seed = true` |
| **Delete (admin)** | `POST /api/admin/pathways/delete`. Removes the pathway and everything that hangs off it, and so also unpublishes it. Contributors' workspaces survive, unlinked |

## Retrieval and search

| Term | Meaning |
|---|---|
| **Grounding** | The pathway material put into a prompt for the current question, built by `buildGrounding` in `lib/retrieval.ts` |
| **Query kind** | The classifier's label for a question, which decides what grounding is fetched: **`specific`** (about named pathways: their documents, plus source passages for seeded ones), **`situation`** (the user's own case: best-matching lessons, the top few pathways), **`broad`** (a general question: lessons across up to 8 pathways), **`patterns`** (what's common: lessons grouped by pathway with exact counts) |
| **Classifier** | A forced-tool-use Claude Haiku call (`CLASSIFIER_MODEL` in `lib/retrieval.ts`) that picks the query kind, named pathways and optional sector/dimension/stage/type filters. Falls back to a default classification on failure. Recorded in `ai_usage` as `retrieval-classify` |
| **Hybrid search** | `match_pathway_units` (migration `0042`): ranks pathway units by vector similarity and by full-text match, combines the two with reciprocal-rank fusion, and applies label filters. Published pathways only. Without an embedding it runs on full text + labels |
| **Embed function** | The `embed` Supabase Edge Function (`supabase/functions/embed/`), which turns text into 384-dimension `gte-small` vectors inside Supabase (no external vendor or key). Called by `lib/embeddings.ts` in batches of 4, with retries on 503/504/546 |
| **Surface** | Which part of the app a grounding request is for: `analyse`, `contribute`, `explore-pathway`, `explore-overview`, `document` (`lib/retrieval.ts`) |
| **Answer-shape rules** | The shared prompt constants `BEST_MATCH_RULE`, `PATHWAY_CONTEXT_RULE`, `NEUTRAL_LANGUAGE_RULE`, `PLAIN_WORDS_RULE` in `lib/system-prompts.ts` — see [`../business/business-rules.md#answer-shape-rules`](../business/business-rules.md#answer-shape-rules) |

## Toolkit assets

| Term | Meaning |
|---|---|
| **Toolkit asset** | The actual reusable file (or https link) behind a Toolkit Asset unit — a template, checklist, form. Stored as one `contribution_units` row (`unit_type='toolkit-asset'`); files in the private `toolkit-assets` bucket. Shared only with the contributor's explicit consent; public once its pathway is published |
| **Contribution unit** | A `contribution_units` row. Today these rows are used for toolkit assets (migration `0034`); the broader per-unit contribution model the table was first built for is still unused |
| **Resource review card** | The chat card where a contributor decides, one by one, on each reusable resource found in their material (`components/ResourceReviewCard.tsx`) |
| **Asset share card** | The card under a pathway draft listing the assets Section 4 names, with an upload/link slot for each; Confirm is the consent (`components/AssetShareCard.tsx`) |
| **Consent card** | The single "OK to share this publicly?" question asked before one asset is stored (`components/ToolkitAssetConsentCard.tsx`) |
| **Reuse condition** | The one-sentence "who else could reuse this, and what they'd adapt" text in Section 4, drafted by `asset-reuse` chat mode from the contributor's own words |

## Legacy / historical terms

| Term | Status |
|---|---|
| **`general_user`** | *Removed.* Dropped from the role check constraint and deleted from `user_roles` by migration `0039` |
| **Intent** | *Historical.* Was four Explorer modes (browse/validate/troubleshoot/guidance); now a single `analyse` flow. Old stored values still resolve without crashing |
| **Assemble (GitHub commit)** | *Obsolete meaning.* The route is still called `assemble`, but it no longer commits to GitHub — see **Send for review**. `lib/github.ts` and the `GITHUB_*` settings are gone |
| **Two corpora / `content/wiki/`, `content/library-wiki/`** | *Obsolete.* Committed pathway markdown and the separate library corpus have been removed; all pathways live in Supabase |
| **Awaiting approval / pending signup** | *Obsolete for new signups.* The screen still exists for an account with zero roles, which can now only happen through a direct database edit |

## Source files

`content/framework.md`, `lib/dimensions.ts`, `lib/roles.ts`, `lib/retrieval.ts`, `lib/embeddings.ts`, `lib/pathway-store.ts`, `lib/pathway-units.ts`, `lib/system-prompts.ts`, `lib/toolkit-assets.ts`, `scripts/seed-pathways.ts`, `supabase/migrations/0034`, `0039`, `0042`, `ARCHITECTURE.md` §1.
