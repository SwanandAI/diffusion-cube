# Architecture Clarifications: Pathway Storage in the App Database

Technical clarifications (`architecture-plan`). **Round 1 answered 2026-11-04** by Anurag Goutam (questions asked in Hinglish). Business decisions are in [`business_clarifications_pathway_storage.md`](business_clarifications_pathway_storage.md).

## Repo findings these questions are based on

Branch `feature/pathway-storage` from `upstream/cube-dev` at `0189677`. The wiki (`docs/wiki/diffusion-cube/`) predates the Vitest suite, so this round is checked against the code directly.

- **Send for review:** `app/api/pathways/assemble/route.ts`.
  - It commits the latest `design_documents` draft (plus toolkit-asset links) to GitHub at `content/wiki/pathways/<slug>.md` through `lib/github.ts`.
  - It also sets `pathways.content_cache`, `review_requested` and `assembled_design_doc_id`.
  - The GitHub file is never served: `lib/wiki-loader.ts` serves only files listed in `index.md`. So removing the commit changes nothing anyone sees.
- **Admin publish:** `app/api/admin/pathways/publish/route.ts`.
  - It upserts `content_cache` into `published_pathways`, with card fields parsed from the frontmatter.
  - It publishes the toolkit assets and emails the contributor.
  - `app/api/admin/pathways/delete/route.ts` also deletes the `published_pathways` row.
- **Readers of `published_pathways`:**
  - `app/explore/page.tsx`
  - `app/api/pathways/route.ts`
  - `app/api/pathways/check-similar/route.ts`
  - `app/admin/page.tsx`
  - `app/api/chat/route.ts` (library mode)
  - `lib/wiki-loader.ts`, `lib/wiki-content.ts`, `lib/library-documents.ts`
- **Readers of the static corpus:**
  - `content/wiki/pathways/*.md` through `index.md`: `lib/wiki-loader.ts` (whole corpus, plus slug reservation), `lib/library-documents.ts` and `lib/wiki-content.ts`.
  - The hard-coded cards in `lib/library-pathways.ts`: `/explore`, `/wiki`, `app/api/wiki-pathways`, `app/api/wiki-stats`, `components/HeatmapGrid.tsx` and `app/admin/usage`.
- **Whole-corpus prompts** (`app/api/chat/route.ts:314`, `needsCorpus`):
  - companion, for both Explorer and Contributor;
  - analysis-doc and executive-summary.

  At 100 pathways (0.5–1M tokens) the corpus no longer fits a prompt.
- **Explore** (`mode: 'library'`) has two prompts: a per-pathway chat (`pathwayId` set; one document, Source Trace stripped) and a library overview chat (all card frontmatter).
- **Unit format today** (`content/pathway-generation-prompt.md` Section 3; e.g. `content/wiki/pathways/naya-sathi.md`):
  - Each micro-innovation is `**N. Title**` followed by bold bullet tags: Dimension, Stage, optional Also relevant at, Type.
  - Then come per-type fields, ending in `Condition — applies when`.
  - Section 6 maps adopter questions to unit numbers.
  - There is no sub-category, no "fails when" and no stable ID.
- **Database:**
  - No pgvector extension, no `supabase/functions/`, and no Supabase CLI config; migrations end at `0041`.
  - `pathways` (`0020`) has `slug`, `title`, `sector`, `created_by` (nullable), `content_cache` and RLS insert gated on `pathway_contributor`, so a seeded pathway with no contributor is representable.
  - The toolkit asset bucket is `toolkit-assets`.
- **Tests:** Vitest (`vitest.config.mts`, `tests/{api,client,db,features,unit,…}`).
- **Invariants kept:**
  - the model never writes to Supabase (companion persistence stays client-side through `<grid_update>`);
  - two-step publish (Send for review ≠ live);
  - Source Trace stays contributor-only;
  - no retry on Anthropic calls (TD-05, matched, not fixed).

## Technical questions

| # | Theme | Question | Answer / decision |
|---|-------|----------|-------------------|
| 1 | Data contract (parked: v2 format) | Lesson (micro-innovation unit) format: (a) today's bullet tags plus `Sub-category` and `Condition — fails when`, a stable ID made by the app (`<slug>-uNN`), adopter intents from Section 6; or (b) Swanand's per-unit YAML block? | **(a)** (round 2, 2026-11-04). The contributor's draft keeps its look. |
| 2 | Data contract (parked: tables) | New `pathway_versions`, `pathway_units` (full-text + vector), `pathway_sources` (seed originals only); `pathways` gains `status` and `published_version_id`; no `pathway_grid_cells` / `pathway_gaps` tables (grid computed from units; gaps unused)? | **Yes.** |
| 3 | Data contract (parked: retiring tables) | Turn `published_pathways` into a view over the new store so its ~10 readers keep working; delete current rows at seed; keep `content_cache` this release, remove later? | **Yes.** |
| 4 | Environments | Are dev and prod separate Supabase projects? | **Separate.** Migrations, the embedding function and the seed run once per project. |
| 5 | Integration (parked: embedding model) | Where the open-source embedding model runs: (a) a Supabase Edge Function with `gte-small`; (b) transformers.js in the app; (c) self-hosted on AWS? | **(a) Supabase Edge Function, `gte-small`** (384 dimensions). |
| 6 | AI/LLM (parked: per-question limits) | Detect the kind of question: (A) a small Claude call per message before searching; (B) no classifier, always hybrid search; (C) rules first, Claude only when unsure? | **A, on Haiku** (round 2, 2026-11-04): `claude-haiku-5-5`, forced tool use as in `check-similar`, with `thinking: {type: "disabled"}` and low effort (Haiku 5.5 thinks by default, and forced tool use needs thinking off). On a failure or refusal, it falls back to B with a per-surface default kind. Haiku 5.5 has no server-side refusal fallback, so the code's fallback covers it. |
| 7 | AI/LLM | Starting limits: UC1 the pathway's whole write-up; UC2 the top 30 units from ≤ 8 pathways; UC3 the top 40 units grouped by pathway count; tuned with the test set? | **Yes.** |
| 8 | Chat surfaces | Explore: per-pathway chat = UC1; library overview chat = UC2/UC3? | **Yes.** |
| 9 | Chat surfaces | Analyse companion, analysis-doc and executive-summary move from the whole corpus to retrieval; the contributor companion gets the same retrieval (no visible change)? | **Yes.** |
| 10 | AI/LLM (parked: `get_source_text`) | Originals follow-up: (a) a `get_source_text` tool with a streaming tool loop; or (b) chunk and embed the originals' text and put the top passages, labelled, into UC1's context? | **(b)** (recommended option accepted). No tool loop. |
| 11 | Publish | Admin publish with invalid unit labels: block, or publish, skip the bad units and warn? | **Publish, skip the bad units, warn the admin.** The admin flow stays as it is. |
| 12 | Seed (parked: seed import) | Seed by a CLI script with a manifest (pathway → files, public flag), or an admin screen? | **CLI script** run by a developer, per environment. |
| 13 | Seed | Server-side extraction of PDF, DOCX, XLSX, PPTX, TXT/MD; no scanned PDFs? | **Yes.** |
| 14 | Rollout (parked: switch) | Does the switch toggle only retrieval (whole corpus vs hybrid search), with static files deleted in a cleanup PR after the prod switch? | **Only hybrid search; no switch.** There is no legacy whole-corpus mode to fall back to. This **changes business decision Q15** (old behaviour behind a switch). The requirement's final-scope update must reflect it: the test set is used to validate on dev before prod is deployed, not to flip a switch. The static files and `lib/library-pathways.ts` go in this release. |
| 15 | Testing | Vitest tests for the parser, retrieval and routes; copy the ~20-question test set from `main` into this folder and update it for the seed corpus? | *Not answered.* Assumed **yes**. |

## Plan-review decisions

- **2026-11-04: models confirmed.**
  - **Claude Haiku 5.5** classifies the question;
  - **Claude Sonnet 4.6** stays for answers, documents and drafts (the 5.5 upgrade is a separate piece of work);
  - **gte-small** (open source, MIT, 384 dimensions, ~512-token input) does the embeddings, in a Supabase Edge Function.
- **2026-11-04: vectors stored in Supabase Postgres (pgvector).** Unit vectors go in `pathway_units.embedding` and seed source passages in `pathway_source_chunks.embedding`, each with an HNSW index. Original files go in the private Storage bucket `pathway-sources`. There is no separate vector database.
- **2026-11-04: invalid unit labels.** On publish, both for contributor pathways and the seed, invalid units are skipped and reported, and the rest of the pathway is published. This replaces the requirement's earlier seed wording ("pathway skipped").
- **2026-11-04: plan approved.** See [`plan_pathway_storage.md`](plan_pathway_storage.md).

## Open items

- **Haiku access on the app's Anthropic account:** confirm `claude-haiku-5-5` is enabled for the key in each environment before the classifier ships (the account's renewal after 28-Oct-2026 is itself unconfirmed).
- **The seed document list** (business open item): the seed run is blocked on it; development is not.
