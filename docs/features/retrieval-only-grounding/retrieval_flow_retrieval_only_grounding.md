# Retrieval Flow: Retrieval-Only Grounding

> Status: **Proposed (2026-11-23)**. This is the design in the draft plan, which
> has not been approved yet. Requirement:
> [`requirement_retrieval_only_grounding.md`](requirement_retrieval_only_grounding.md).
> Decisions:
> [`architecture_clarifications_retrieval_only_grounding.md`](architecture_clarifications_retrieval_only_grounding.md).

The change works in two parts:

- **Part A, indexing:** chunks are built once, whenever a pathway is
  published or re-indexed.
- **Part B, query time:** search runs on every question.

The examples use MahaVISTAAR.

---

## Part A: Indexing (once, at publish time)

Three triggers start indexing:

- an admin clicks **Publish**;
- `npm run seed:pathways` runs;
- the new `reindex-pathways` script runs.

All three call the same function, `indexPublishedVersion`
(`lib/pathway-store.ts`).

```
pathway_versions.content (the full MD)
        │
        ├─ 1. Remove the Source Trace appendix (contributor-only rule)
        ├─ 2. Parse the frontmatter (title, sector, tags, ...)
        │
        ├─ 3. Structure-aware CHUNKER ─────────────► pathway_doc_chunks
        │        └─ 4. Coverage check                    (text + embedding + fts + kind + labels)
        │
        ├─ 5. parseUnits (Section 3) ──────────────► pathway_units      (unchanged)
        │
        └─ 6. Public source files (extracted DOCX/PDF text)
                 └─ chunkText ─────────────────────► pathway_source_chunks
                                                         (now includes contributor files)
```

### Step 3: How the chunker cuts the MD

The chunker reads the MD as a tree:

```
frontmatter → ## section → ### subsection → unit (**N. Title**)
```

Every chunk belongs to exactly one place in that tree. It starts with a
**breadcrumb** that gives its full location, and the breadcrumb is embedded and
keyword-indexed together with the text.

**Atomic blocks** are a prose paragraph, a bullet, a table row and a
retrieval-guide line. Blocks are packed into chunks of at most about 1,600
characters, because gte-small reads about 512 tokens. A block is never split.
The one exception is a block that is longer than the cap on its own, which is
split at sentence ends. Chunks do not overlap.

#### Chunk kinds

**`card`: the frontmatter.** It is not indexed anywhere today.

```
MahaVISTAAR › Pathway card
Title: MahaVISTAAR
Description: AI-powered voice advisory enabling Maharashtra's smallholder farmers...
Stage: Scale · Sector: Agriculture · Location: Maharashtra, India
Tags: Smallholder Farmers, Voice AI, Federated Data, Rural Inclusion
As of: 2026-07-01
```

**`table`: for example, the Section 1 identity table.** Today it is cut
mid-table. Under the new chunker a row is never split, and the header row is
repeated in every chunk.

```
MahaVISTAAR › Section 1 — Pathway Identity (part 2 of 2)
| Field | Detail |
|---|---|
| **Build effort** | 9 months to reach production scale; 30 partner organisations... |
| **Known downstream adopters** | Ethiopia's ATI (3 months...); Amul/Sarlaben (3 weeks...) |
| **Scope / does not transfer when** | ... |
```

Today, "Who adopted MahaVISTAAR?" ranks this row's chunk 15th of 49. With the
row's own label and the section in the chunk, it should rank near the top.

**`unit`: one micro-innovation per chunk.**

```
MahaVISTAAR › Section 3 — Micro-innovations › Persona › Unit 1: Start with the excluded user
[persona · Explore · Strategic Decision]
- Decision: Define the target user as the specific person currently excluded...
- Alternative considered: ...
- Why: ...
```

A unit longer than the cap is split at a bullet boundary, and the next chunk
repeats the unit header as "Unit 1 … (cont.)". That ends the mid-word fragments
the current chunker produces, such as "ry the most forward-looking material."

**`guide`:** the retrieval-guide lines in Section 6.

**`prose`:** everything else, such as the Section 0 reading guide, the
Section 2 gaps and the Section 4 toolkits.

### Step 4: Coverage check ("nothing left behind")

The check takes every frontmatter value and every non-blank line of the body,
leaving out the Source Trace. It normalises each line and confirms that the
line appears inside some chunk.

- If every line is covered: `index_status = 'indexed'`.
- If any line is not covered, the chunks are **still saved**, so search keeps
  working. `index_status` becomes `'failed'`, `index_error` lists the uncovered
  lines, and the admin panel shows its existing index warning.

### Steps 5 and 6: Embeddings and the keyword index

- Each chunk's breadcrumb and text go to the `embed` Edge Function (gte-small,
  384 dimensions), and the vector is stored with the chunk.
- The keyword index (`fts`) is a Postgres generated column, so Postgres
  maintains it automatically. Indexing does not have to do anything for it.
- Source files are chunked and embedded the same way. That now includes
  contributor uploads, which today are never embedded.

---

## Part B: Query time (every question)

```
User question
   │
   ├─ 1. Where did it come from? (surface)
   │     Library, pathway open      → UC1, no classifier
   │     Library overview, Analyse  → the Haiku classifier picks the kind
   │     Documents, Contribute      → "situation"
   │
   ├─ 2. Embed the question ONCE (the vector is reused by every search)
   │
   ├─ 3. HYBRID SEARCH according to the kind (details below)
   │
   ├─ 4. Build the prompt: [rules + card + unit index] (cached) ║ [excerpts] (new each turn)
   │
   └─ 5. Sonnet answers from the excerpts only
```

### How hybrid search ranks (used by every search)

One query builds two ranked lists:

1. **Vector list.** These are the chunks closest to the question's embedding,
   found through the HNSW index. This list matches on **meaning**.
2. **Keyword list.** This is Postgres full-text search. It matches **exact
   words**, such as "OpenAgriNet", "Ethiopia" or "₹9.4".

Reciprocal Rank Fusion (RRF) merges the two lists into one score:

```
score = 1/(50 + vector_rank) + 1/(50 + keyword_rank)
```

A chunk near the top of both lists wins. A chunk very high in only one list
still makes the cut.

**Example: "What are the seven layers of OpenAgriNet?"** Vector search alone
ranks the right source chunk 15th. "OpenAgriNet" and "layers" are exact terms,
so the keyword list ranks the chunk 1st–2nd, and the merged score puts it in
the top 5.

All three search functions use this ranking:

- `match_pathway_units` (already hybrid);
- `match_pathway_doc_chunks` (vector-only today; becomes hybrid);
- `match_source_chunks` (vector-only today; becomes hybrid).

---

## The flow for each use case

### UC1: A pathway is open in the Library and the user asks a question

Example: *"Who has adopted the MahaVISTAAR approach, and how fast?"*

```
1. Hybrid search on pathway_doc_chunks (mahavistaar only)    → top 8 chunks
      e.g. the Section 1 table (adopters row), a diffusion unit, a Section 2 gap...
2. Add neighbours: the next/previous chunk of the same unit or table
3. Always add: card + unit index
      (titles and labels of all 22 units, ~1.5k chars, from pathway_units)
4. Haiku gate: "Do these chunks answer the question?"
      ├─ yes → no source search
      └─ no  → hybrid search on pathway_source_chunks → top 6 + neighbours
5. Prompt:
      [cached]   rules + card + unit index
      [per turn] "EXCERPTS FROM THE WRITE-UP" (8 chunks) [+ "FROM ITS SOURCE DOCUMENTS"]
6. Sonnet answers.
      - If the answer comes from a source document, it names the file.
      - If nothing matches, it says "I couldn't find that in what I retrieved",
        not "the pathway doesn't cover it".
```

Input tokens per question drop from **~14k** (the whole MD) to **~4–5k**.

### UC1: The opening overview when a pathway is opened (no question yet)

There is no question, so there is no similarity search. A fixed set of chunks
is sent, chosen by kind and section:

- `card`;
- Section 0 (reading guide);
- Section 1 (identity);
- Section 2 (coverage map);
- the unit index.

That is enough for an overview, and the whole MD is still not sent.

### UC1: "Summarise the whole pathway" or "List all the micro-innovations"

The unit index (every unit's title, dimension and stage) goes with every UC1
turn, so lists and summaries are built from it. Any detail asked about a
specific unit comes from search.

### Specific: A pathway is named in Analyse or the Library overview

Example: *"How did MahaVISTAAR bring its cost down?"*

The classifier returns `specific` with slug `mahavistaar`, and the UC1 flow
runs:

- card + unit index;
- the top 8 chunks;
- source chunks if needed.

When two pathways are named, this runs for each of them.

### Situation: "Who did something like my situation?"

This covers Analyse, the analysis document, the executive summary and the
contributor chat.

```
1. Hybrid search on pathway_units (all pathways, sector filter) → top 30 units
2. Pick the top 2 pathways from those units
3. For each: card + top 4 doc chunks          (today: 2 WHOLE MDs are sent here)
4. Prompt: the units + the excerpts from the two pathways
```

### Broad: "How did teams work with government departments?"

```
1. Hybrid search on pathway_units                             → top 30 units, ≤8 pathways
2. New: hybrid search on doc chunks (card/table/prose only;
   unit chunks are skipped because the units already cover them) → top 6
```

Step 2 makes Section 1 facts findable across pathways: cost, scale, adopters,
geography and dates. A question like "Which pathway has the lowest cost per
query?" can now be answered.

### Patterns: "What problems are common at the Pilot stage?"

Hybrid search on units, with the dimension and stage filters, plus the top 6
non-unit chunks. The code, not the model, counts how many pathways show each
pattern. That part is unchanged.

---

## What happens when something fails

| What failed | What happens |
|---|---|
| The embedding function is down | Every search ranks by keywords alone; chat keeps working |
| The Haiku gate errors | Source chunks are added anyway (wasted tokens are acceptable) |
| A pathway has no doc chunks (indexing failed) | Only the card + unit index are sent, and the gap is logged. The whole MD is **never** sent |
| The coverage check fails | Search keeps working; the admin sees a warning |
| Database error | The request fails (500), the same as today |

---

## Before and after at a glance

| | Today | After the change |
|---|---|---|
| UC1 context | The whole MD (~14k tokens) | Card + unit index + 8 chunks (~4–5k) |
| Situation context | 30 units + **2 whole MDs** | 30 units + 4 chunks each from the top 2 pathways |
| How MD chunks are searched | Vector only, used only by the gate | Hybrid; they ground the answer in every use case |
| Source fallback | Whole source text if under 60k characters | Hybrid top 6 chunks + neighbours |
| Contributor source files | Not searchable | Embedded and searchable |
| Frontmatter | Not indexed anywhere | A `card` chunk |
| Splits inside tables or units | The header and labels are lost | Every chunk has a breadcrumb; tables repeat their header row |
| "Is anything left out?" | Not checked | Coverage check at index time |
