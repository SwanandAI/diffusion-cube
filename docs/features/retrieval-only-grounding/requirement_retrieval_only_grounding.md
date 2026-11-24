# Requirement: Retrieval-Only Grounding with Complete MD Chunking

> Status: **Draft (2026-11-23)**. Restated from the product owner's ask in
> conversation. `brd-validation` was **not** run for this feature. The
> architecture questions are in
> [`architecture_clarifications_retrieval_only_grounding.md`](architecture_clarifications_retrieval_only_grounding.md).
> No plan exists yet.

## The ask (as stated)

> "In every use case, retrieval must be embeddings + keyword search only. The
> MD / whole corpus must not go into context. Fix the chunking strategy, and
> make sure nothing in the MD file is left behind."

## Plain-language summary

Today, a question about one pathway sends that pathway's whole write-up to
the AI. Some cross-pathway questions also send two whole write-ups. With
this change, no question ever sends a whole write-up again. The app looks up
only the passages that match the question. It finds them two ways at once:
by meaning (embeddings) and by exact words (keyword search). Only those
passages go to the AI.

For that to work, every part of a write-up has to be findable. Three things
in the current way of cutting write-ups into passages get in the way:

- Tables are cut in half.
- A passage from the middle of a lesson loses the lesson's name and labels.
- The header block at the top of each write-up (title, description, sector,
  location, tags, stage) is never indexed at all.

The new passage-cutting keeps tables, lessons and sections whole. Every
passage carries its own context. We will check that every line of the
write-up lands in some passage. The one exception is the contributor-only
Source Trace, which is subject to an existing product rule (see open
question 8).

## Why

- **Cost and focus:** a whole write-up is ~7–15k tokens on every question.
  Retrieval sends only what the question needs.
- **One consistent approach** across every chat surface and generated
  document, in line with the retrieval direction agreed in the November
  retrieval review. Kamesh's position was that a question about one pathway
  is a classic retrieval problem.
- **Findability:** test questions show facts that exist in a write-up but
  can't be found by search. For example, MahaVISTAAR's "who adopted it"
  answer sits in a table fragment that ranks 15th for that question.

## Affected use cases

| Use case | Today | After |
|---|---|---|
| UC1: question about one pathway (Library pathway chat, a named pathway in Analyse) | Whole write-up; original documents added when a check says the write-up falls short | Only the matching passages of that write-up; matching passages of its original documents when those fall short |
| UC2 "situation" (Analyse, generated documents, contributor chat) | Matching lessons, plus 2 whole write-ups | Matching lessons and matching passages; no whole write-ups |
| UC2 "broad" / UC3 "patterns" | Matching lessons only | Unchanged in approach; header and identity facts become findable too |

## Success criteria (to confirm)

- No request ever puts a whole published write-up into the AI's context.
- Every line of every published write-up, apart from the Source Trace, is in
  at least one indexed passage. This is checked automatically whenever a
  pathway is indexed.
- Answer quality on the agreed test questions is at least as good as today.
  The test questions are the MahaVISTAAR set and
  `docs/features/pathway-storage/test_set_pathway_storage.md`.
