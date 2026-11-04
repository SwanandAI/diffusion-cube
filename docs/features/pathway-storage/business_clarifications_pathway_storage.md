# Business Clarifications: Pathway Storage in the App Database

Business clarifications (`brd-validation`). **Answered 2026-11-03** by Anurag Goutam (questions asked in Hinglish at the requester's request; answers recorded here in English).

## What we found

- **Source.** The Claude Doc *"Diffusion Cube — Pathway Storage Architecture"* (Swanand Kulkarni, 2026-11-03) recommends storing pathways only in the app's own database, keeping both the reviewed write-up and the contributor's original documents, breaking each write-up into tagged lessons (micro-innovation units), and searching them by meaning as well as by keyword. Its goal is three use cases: specific answers from one pathway (UC1), answers across pathways (UC2), and common patterns across pathways (UC3).
- **Where pathways live today (on Swanand's `cube-dev`).** In three places that drift apart:
  - the pathway files that ship with the app, plus hard-coded library cards;
  - the GitHub commit a contributor's "assemble" step makes;
  - the published-pathways table an admin's Publish copies into.

  The contributor's uploaded file is thrown away once its text is read.
- **A different approach exists on `main`.** "Cube-Brain as the knowledge source" keeps pathways in the Cube-Brain GitHub repository. **The requester confirmed this feature is separate and unrelated to it.** It is built on Swanand's `cube-dev`, not on `main`, and does not touch the brain.
- **Product rules this touches:**
  - only an admin makes a pathway live;
  - provenance is shown to contributors only (original documents are a new kind of provenance);
  - absence is stated plainly;
  - the two pathway collections (the one the assistant reasons over and the public library), which this feature merges into one.
- **Roadmap fit.** This partly covers the charter's "Enhance the Framework and Pathway schema" and "Corpus synthesis process (LLM Wiki approach)" items (both *Not started*) and W6 "Pathway curation lifecycle" (versions, removal).
- **Wiki currency.** The wiki predates the Vitest test suite (`da2c3aa`). The requester chose to carry on without regenerating it.

## Business questions

| # | Theme | Question | Answer / decision |
|---|-------|----------|-------------------|
| 1 | Scope | Does this replace the Cube-Brain knowledge source on `main`? What happens to Cube-Brain? | **Unrelated to the brain.** A new, standalone feature built on a fresh branch from Swanand's `cube-dev`. Nothing in it reads from or writes to Cube-Brain. |
| 2 | Scope | Which pathways seed the new store on switch day? | **The requester will provide a list of documents.** Every document on that list becomes a published pathway. *(List still to come.)* |
| 3 | Journey | Must converted pathways be re-reviewed by an admin before going live? | **Automatic convert.** Read as: the provided documents are turned into pathways in the new format automatically and published without a separate admin review. *(To confirm at requirement review.)* |
| 4 | Actors | Program Team editing: app only, or Google Docs too? An in-app editor for admins? | **No editing of pathways by the Program Team** ("Why to edit pathway?"). No in-app editor and no Google Docs. A pathway changes only when its contributor revises it in conversation and it is reviewed again. |
| 5 | Policy | Who sees version history and who can roll back? | Admins only; a contributor sees their own pathway's versions. |
| 6 | Journey | Is the fidelity check advisory or blocking? | Advisory. The contributor and the admin both see it, and it never blocks Send for review. |
| 7 | Policy | Who sets an original's "public / contributor-only" flag, and the default? | The contributor chooses at upload. The default is contributor-only, and an admin can change it. |
| 8 | Policy | May answers draw on public originals on `/explore` (no login), or only in Analyse? | **Both Explore and Analyse.** Only originals flagged public are ever used for adopters. |
| 9 | Policy | Originals when a contribution is deleted or a pathway removed; how long kept? | Deleted with the contribution; kept for as long as the pathway exists. |
| 10 | Scope | Import the curated pathways' originals from Google Drive? | **No. The curated pathways are not wanted** ("these are hard-coded things"). Read as: the pathway files that ship with the app and the hard-coded library cards are retired. Drive originals are not imported. |
| 11 | Scope | Common patterns: worked out live, or admin-reviewed write-ups at 20+ pathways? | Live now; reviewed pattern write-ups go on the roadmap. |
| 12 | Scope | Batch regeneration after a framework change: this release or later? | *Not answered.* Assumed: later. Originals are kept now so it stays possible. |
| 13 | Non-functional | Searching by meaning needs an embedding provider. Is a new vendor acceptable? | **Use an open-source model**, not a paid vendor. Which model and where it runs is parked for `architecture-plan`. (HNSW, mentioned in the answer, is the kind of search index, not the model itself.) |
| 14 | Success | Measure with the ~20-question test set and an 85–90% target for answers across pathways? | Yes. |
| 15 | Rollout | Keep the old behaviour behind a switch, and move each environment only after the test set passes? | Yes. |
| 16 | Non-functional | Deadline? Anthropic account renewed past 28-Oct-2026? | **No deadline.** Account renewal not confirmed; kept as a risk. |
| 17 | Process | Regenerate the wiki first, or carry on? | Carry on. |
| 18 | Process | Branch to work on? | **Take Swanand's latest `cube-dev` and create a new branch; all work goes there only.** Done: `feature/pathway-storage` from `upstream/cube-dev` at `0189677` (2026-11-03), with tracking removed so a push can't land on Swanand's `cube-dev` by mistake. |

## Round 2 (2026-11-04): scope narrowed

| # | Theme | Feedback | Decision |
|---|-------|----------|----------|
| 19 | Scope | "Why was the flow of contribution changed? It should be the same. The only thing is it saves into the DB, not GitHub. The flow stays the same, and for Analyse and Explore it's what we discussed." | **The contribute flow is unchanged.** Same steps, cards and messages. The only change is that Send for review saves a version in the app's database instead of committing to GitHub. Behind the scenes, uploaded files are kept and each lesson in the draft is labelled, with no new step for the contributor. The new behaviour (UC1–UC3 retrieval, meaning search, follow-ups from public originals) is in **Explore and Analyse**. |
| 19a | Scope | Follows from 19 | **Dropped from this release:** the per-file disclosure question at upload (supersedes Q7) and the fidelity check after drafting (supersedes Q6). Also dropped: admin screens beyond today's panel (version history, compare, rollback, claim tracing, disclosure editing; Q5's history is still *kept*, just not shown). |

## Round 3 (2026-11-04): confirmations

| # | Theme | Question | Answer / decision |
|---|-------|----------|-------------------|
| 20 | Journey | Seeded pathways go live without admin review? | **Confirmed.** |
| 21 | Scope | Pathways not on the seed list (including HealthBot, Naya Sathi, A4Kiosk, Doora) leave the library and answers? | **Confirmed.** |
| 22 | Policy | Seeded documents contributor-only unless the list marks them public? | **Confirmed.** |
| 23 | Policy | Contributors' uploaded documents, with no per-file question: (a) handled exactly as today, or (b) also save their text with the pathway, for the contributor and admins only? *(Today: the text is read into the conversation; the file is discarded. Only toolkit asset files are stored, and they go public on approval.)* | **(a) Exactly as today.** File not kept, never used for adopters. Original documents exist only for seeded pathways. Supersedes Q7 and Q9 for contributor uploads. |

Requirement **validated 2026-11-04**.

## Open items

- **The seed document list** (Q2): the requester to provide it, with which pathway each document belongs to.
- **Seed publish without review** (Q3): the requester to confirm at requirement review that seeded pathways go live without an admin looking at them.
- **What retiring the curated pathways means for live pathways** (Q10): any pathway live today that is not on the seed list disappears from the library and from answers. The requester to confirm. This includes community-published ones such as HealthBot, Naya Sathi, A4Kiosk and Doora.
- **The disclosure flag on seeded originals** (Q7 × Q2): there is no contributor to choose for these. Assumed contributor-only unless the requester marks them public in the list.

## Technical questions for architecture-plan

- Which open-source embedding model, its dimensions, and where it runs (Supabase's built-in model, in the app, or a self-hosted service); the HNSW index settings; re-embedding when the model changes.
- How vector, full-text and tag ranks are merged (hybrid search), and the per-question limits for UC1/UC2/UC3.
- The new and changed tables (`pathways` status and published-version pointer, `pathway_versions`, `pathway_sources`, `pathway_units`, `pathway_grid_cells`, `pathway_gaps`), their row-level security, and retiring `published_pathways` (kept as a view during migration), `content_cache` and the inert cache tables.
- Supabase Storage bucket(s) for originals, access rules for public vs contributor-only files, and file size limits.
- The v2 Markdown format (per-unit YAML tag block using the Cube-Brain field names and vocabulary) and a parser that rejects malformed units on publish.
- Replacing the GitHub commit on "assemble" with saving a version; removing `lib/github.ts` use and `GITHUB_*` env vars from the publish path.
- The `get_source_text(pathway)` tool for UC1 follow-ups in Explore and Analyse, and its token budget (up to ~35K tokens at 50 pages).
- The fidelity-check call (a second Claude call after drafting), and where its result is stored and shown.
- The seed import: a one-time script or an admin screen, how documents map to pathways, and idempotent re-runs.
- The switch between old and new behaviour (env flag), and reusing the ~20-question test set.
- How the hard-coded library cards (`lib/library-pathways.ts`) and the shipped `content/wiki/pathways/` files are retired without breaking `/explore`, `/wiki` and Analyse grounding during the switch.
