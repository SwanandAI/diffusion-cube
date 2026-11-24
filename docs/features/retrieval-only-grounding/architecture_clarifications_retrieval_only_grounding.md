# Architecture Clarifications: Retrieval-Only Grounding with Complete MD Chunking

Technical clarifications (`architecture-plan`). **Answered 2026-11-23.**
There is no business clarifications file: `brd-validation` was not run. The
restated requirement is in
[`requirement_retrieval_only_grounding.md`](requirement_retrieval_only_grounding.md).

## Repo findings these questions are based on

Verified on `feature/message-feedback` (which includes `cube-dev`) and the
dev Supabase project, 2026-11-23.

**Where whole write-ups are sent today**

- **UC1, Library pathway chat:** `app/api/chat/route.ts` (mode `library`
  with `pathwayId`) puts the whole adopter document into
  `libraryPathwaySystemPrompt`, in the prompt-cached part
  (`lib/system-prompts.ts` ~L900).
  - `pathwayPassages()` (`lib/retrieval.ts` L432) adds original-document text
    after `PROMPT_CACHE_BREAK`. It adds that text only when the Haiku
    coverage gate (`writeUpAnswers`, which looks at the top 5
    `pathway_doc_chunks`) says the write-up doesn't answer the question.
  - If the source is under `SOURCE_TEXT_BUDGET` = 60,000 chars, the whole
    source is added.
- **UC1, named pathway in Analyse / overview:** `buildGrounding` kind
  `specific` sends up to 2 whole documents (`documentBlock`).
- **UC2 situation:** surfaces `analyse`, `document` (analysis-doc,
  executive-summary) and `contribute` send top-30 units plus **2 whole
  documents** (`LIMITS.situation.documents = 2`).
- **UC2 broad and UC3 patterns:** units only (`match_pathway_units`, which
  is hybrid: vector + FTS + label filters + RRF).

**Search functions**

- `match_pathway_doc_chunks` (migration 0043) and `match_source_chunks`
  (0042) are **vector-only**: HNSW, no full-text search.
- Only `pathway_units` has an `fts` column.

**Chunker:** `documentChunks()` / `chunkText()` in `lib/text-chunks.ts`

- It splits at `#`/`##` headings only. `###` subsections (e.g. Persona,
  Solution, Coverage map) and units (`**N. Title**`) aren't boundaries.
- Inside a section, it cuts by character count (1,600 chars, 200-char
  overlap) at a paragraph or sentence where it can. Effects:
  - Tables are cut mid-table, and the header row is lost.
  - A continuation chunk carries only the `##` heading. The unit title,
    dimension and stage are lost.
  - The overlap creates fragments starting mid-word (e.g. "ry the most
    forward-looking material.").
- It drops the **frontmatter**: title, description, stage, sector,
  location, tags, contributor, timestamp. That is never indexed anywhere.
- It drops the **Source Trace appendix**, which is contributor-only by
  rule (`stripProvenanceAppendix`).

**Measured effect:** MahaVISTAAR Section 1's identity table splits across
chunks #3 and #4. "Who adopted MahaVISTAAR" ranks the right chunk **15th**
of 49. The coverage gate only looks at the top 5.

**Units:** `parseUnits` (`lib/pathway-units.ts`) indexed every unit heading
in all 10 published MDs (22/22 for MahaVISTAAR, and so on); none were
skipped. Units cover Section 3 only. Section 1 (identity, cost, scale,
adopters), Section 2 (coverage gaps), Section 4 (toolkits), Section 6
(retrieval guide) and the frontmatter are in **no** unit.

**Sources:** contributor originals (`pathway_sources.origin = 'contributor'`)
are **not embedded**. Seeded originals have `pathway_source_chunks` with 395
rows in dev.

**Dev state:** `pathway_doc_chunks` was backfilled today (392 chunks; all 10
pathways `index_status = indexed`). Any chunker change makes those chunks
stale, and re-indexing replaces them.

**Production:** per-pathway SQL exports of the **current** chunks are in
`docs/features/pathway-storage/md-index-backfill/sql/`. One file
(african-voice-ai) was run on a non-dev project.

**Prior decisions this revisits**

- Product rule: Source Trace is contributor-only.
- `pathway-storage` architecture clarifications Q7 ("UC1: the pathway's
  whole write-up") and Q10 ("no tool loop"). This requirement **supersedes
  Q7**.

**Conventions**

- The next migration is **0047**.
- Tests live in `tests/unit/lib/text-chunks.test.ts`,
  `tests/unit/server/retrieval.test.ts`,
  `tests/unit/server/pathway-store.test.ts` and
  `tests/db/migrations.test.ts`.
- Prompt caching is in `lib/prompt-cache.ts` (`library` and `companion`
  modes).

**Inherited debt:** TD-05 (no Anthropic retry policy), TD-16 (Anthropic
account; today's key was invalid until it was replaced), TD-17 (pathway data
only in Supabase), TD-26 (units without vectors only re-embedded on
re-publish).

## Technical questions

| # | Theme | Question | Recommended default | Answer / decision |
|---|-------|----------|---------------------|-------------------|
| 0 | Scope | Is the restated requirement right: no whole write-up in any surface, hybrid search everywhere, and a complete-coverage chunker? | Yes | Accepted (recommended default). |
| 1 | Scope: no-question turns | The Library "opening overview" (`LIBRARY_KICKOFF_PROMPT`) has no question to search with. What grounds it? | A fixed set of chunks chosen by section, not by similarity: frontmatter card, Section 0 reading guide, Section 1 identity, Section 2 coverage map. Still not the whole write-up | Accepted (recommended default). |
| 2 | Scope: whole-document asks | "Summarise the whole pathway" or "list all micro-innovations" can't be answered from top-k passages. How do we handle them? | Answer from structured data, not the write-up: unit titles and labels from `pathway_units`, plus the overview chunks from Q1. Say plainly when an answer is a summary of retrieved parts | Accepted (recommended default). |
| 3 | Scope: surfaces | Do analysis-doc, executive-summary and the contributor chat (`contribute` surface) also drop their 2 whole write-ups? | Yes, all surfaces. Use top-k chunks of the matched pathways instead | Accepted (recommended default). |
| 4 | Chunking: boundaries | Approve a structure-aware chunker? It would make one chunk per unit (`**N.**` heading), per `###` subsection, per table (every chunk keeps the header row) and per retrieval-guide question. A block over the size cap splits at bullet or row boundaries, never mid-sentence or mid-row | Yes. Size cap ~1,600 chars (gte-small reads ~512 tokens) | Accepted (recommended default). |
| 5 | Chunking: context header | Should every chunk start with a breadcrumb that is embedded and keyword-indexed? It would hold pathway title › section › subsection › unit title, plus dimension/stage/type for unit chunks | Yes | Accepted (recommended default). |
| 6 | Chunking: overlap | Drop the 200-char overlap? Structure-aware chunks are self-contained, and continuation chunks repeat the breadcrumb instead | Yes, drop it | Accepted (recommended default). |
| 7 | Coverage: frontmatter | Index the frontmatter (title, description, stage, sector, location, tags, contributor, timestamp) as a "pathway card" chunk? | Yes | Accepted (recommended default). |
| 8 | Coverage: Source Trace | "Nothing left behind" conflicts with the contributor-only Source Trace rule. Keep it out of the adopter index? | Keep it **out** (the rule wins). Optionally index it with `audience = contributor` for contributor surfaces later. Not in this scope | Accepted (recommended default). |
| 9 | Coverage: guarantee | Enforce coverage at index time? Every non-blank line of the indexed document (frontmatter values + body, minus Source Trace) must appear in some chunk, or indexing fails with `index_status = 'failed'` and a clear `index_error`. A Vitest test runs the check over fixture MDs | Yes | Accepted (recommended default). |
| 10 | Search: hybrid | Add hybrid search to doc chunks and source chunks? That means `fts` generated columns, GIN indexes and RRF functions mirroring `match_pathway_units`, in migration 0047 | Yes. Same `english` config as units | Accepted (recommended default). |
| 11 | Search: one index or two | **A:** doc chunks become the single index for every use case. Unit chunks carry dimension/stage/type labels, so UC2 filters and UC3 pattern counts read from them, and `pathway_units` search retires. **B:** keep `pathway_units` for UC2/3 labels and counts, and add a doc-chunk hybrid search alongside it (merged by RRF) so identity, gaps and toolkits become findable | **B** for this phase (smaller change; UC3 counting stays as is). Revisit A later | Accepted (recommended default). |
| 12 | Search: k and neighbours | How many chunks per use case? | UC1: top 8 chunks plus the adjacent chunk of the same unit or table. Situation: top 30 units + top 4 chunks for each of the top 2 pathways. Broad/patterns: as now + top 6 non-unit chunks. Tune with the test set | Accepted (recommended default). |
| 13 | Sources | Does the source fallback also go retrieval-only (hybrid top-k source chunks; remove the 60k "whole source" rule)? Do contributor originals get chunked and embedded as part of this work? | Yes to both | Accepted (recommended default). |
| 14 | Coverage gate | Keep the Haiku gate (does the retrieved write-up content answer this?) before adding source chunks, or always add top source chunks? | Keep the gate, now judging the same retrieved chunks that go to Sonnet. Revisit after evaluation | Accepted (recommended default). |
| 15 | Rollout | Ship behind an env flag (e.g. `GROUNDING_MODE=retrieval\|full`, default `retrieval`) so we can flip back without a deploy? | Yes, for one release | **No flag.** Retrieval-only is the default and only behaviour; rollback = revert deploy. |
| 16 | Rollout: re-index | The new chunker makes today's `pathway_doc_chunks` and the prod SQL exports obsolete. Re-index every published pathway with the backfill script after deploy, and stop running the remaining prod SQL files? | Yes | Accepted (recommended default). |
| 17 | Acceptance | Acceptance gate: on the MahaVISTAAR 10 + `test_set_pathway_storage.md`, retrieval-only answers are correct at least as often as today's whole-write-up baseline, with input tokens per question reported | Yes | Accepted (recommended default). |

## Plan-review decisions

None yet.

## Open items

- Confirm Q11 (one index or two) and Q13 (sources go retrieval-only;
  contributor originals get embedded) with Kamesh before the build starts.
