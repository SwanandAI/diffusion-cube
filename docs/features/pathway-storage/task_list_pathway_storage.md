# Task List: Pathway Storage in the App Database

> Status: **Approved 2026-11-04** (task-creation), derived from the approved
> [`plan_pathway_storage.md`](plan_pathway_storage.md). Requirement:
> [`requirement_pathway_storage.md`](requirement_pathway_storage.md). Clarifications:
> [business](business_clarifications_pathway_storage.md), [architecture](architecture_clarifications_pathway_storage.md).

> **Testing note.** This branch has a **Vitest suite** (`npm test`, `vitest.config.mts`, `tests/` with Supabase and Anthropic mocks in `tests/helpers/`). It is **not run in CI**: `.github/workflows/deploy.yml` only deploys. So "Vitest" below means a test added to `tests/` and run locally before the PR. Cases marked **Manual** need a live dev Supabase project (pgvector, Edge Function, Storage), so they are run by hand against the dev app. Cases marked 💲 call the real Anthropic API or the deployed Edge Function and cost money. Run them on dev only.

## Build order

```
PS-01 (migration 0042) ──┬─► PS-04 (pathway store) ──┬─► PS-05 (Send for review → version)
PS-02 (embed function) ──┤                           ├─► PS-06 (publish indexes units; delete)
PS-03 (unit parser) ─────┘                           ├─► PS-10 (readers → store)
                                                     └─► PS-12 (seed script)
PS-01 + PS-02 + PS-04 ─► PS-07 (retrieval) ─┬─► PS-08 (Analyse + contributor grounding)
                                            └─► PS-09 (Explore UC1 / UC2 / UC3)
PS-05 + PS-08 + PS-09 + PS-10 ─► PS-11 (retire static corpus, library cards, GitHub)
everything ─► PS-13 (test set on dev → prod rollout)
```

## Stories

### PS-01: Migration 0042: pathway store schema, hybrid-search RPCs, `published_pathways` view

**As a** Solution Team engineer
**I want** pgvector, the version, unit and source tables, the search RPCs, and `published_pathways` as a view
**So that** every later story reads and writes pathways in one place, and the ~10 existing readers of `published_pathways` keep working unchanged

**Priority:** P0
**Depends on:** None

**Acceptance Criteria:**
- **Header:** `supabase/migrations/0042_pathway_storage.sql` starts with a comment stating its purpose. The comment also says it is **destructive**: it drops the `published_pathways` table and its rows (business Q21, confirmed).
- **Extension:** it runs `create extension if not exists vector`.
- **`pathways`:**
  - It gains `status` (`draft` | `in_review` | `published` | `retired`, default `draft`), `published_version_id`, `is_seed` (default false), `stage`, `location`, `tags` (default `'{}'`) and `organisation`.
  - Existing rows get `status = 'in_review'` where `review_requested` is true, and `'draft'` otherwise. No existing row is `published` after the migration.
- **New tables:** `pathway_versions`, `pathway_units`, `pathway_sources` and `pathway_source_chunks`, with exactly the columns, keys and cascades in the plan's "Data Model".
  - `pathway_units.id` is text (`<slug>-uNN`), and `fts` is a generated tsvector over title, body, applies_when, fails_when and adopter_intents.
  - `embedding` is `vector(384)`, nullable on `pathway_units`.
  - Indexes: GIN on `fts`, HNSW (`vector_cosine_ops`) on both `embedding` columns, and btree on `pathway_units(pathway_id)` and `(dimension, stage)`.
- **RLS:**
  - `pathway_units` is readable by anyone (anon included), with no write policy;
  - `pathway_versions` is readable by admins and by members of the pathway (`pathway_contributors`), with no write policy;
  - `pathway_sources` and `pathway_source_chunks` have RLS on and **no policies** (service role only).
- **`match_pathway_units`:** given `(query_embedding, query_text, filter_slugs, filter_dimension, filter_stage, filter_types, match_count)`, it returns units of `status = 'published'` pathways only, ranked by reciprocal-rank fusion of cosine similarity and `ts_rank_cd`.
  - Null filters are ignored.
  - A null `query_embedding` ranks by full text alone (the degraded mode in the plan).
- **`match_source_chunks`:** given `(query_embedding, pathway_slug, match_count)`, it returns chunks only from sources with `is_public = true` for that pathway.
- **The view:** `published_pathways` is recreated as a view with the old columns (`slug, title, description, category, content, sector, location, tags, stage, contributor_org, published_by, created_at`). It shows only `status = 'published'` pathways and their published version's content. It is readable by anon, as the old `using (true)` table was.
- **Storage:** a private Storage bucket `pathway-sources` exists (created in the migration or a documented one-off step), with no public access.

**Test Plan:**
- *Positive:*
  - **Vitest:** extend `tests/db/migrations.test.ts`:
    - `0042` exists, is the highest number, and has a leading comment that says "destructive";
    - it contains `create extension if not exists vector`, `vector(384)` and both RPC names.
  - **Manual:** apply `0042` on the dev project with the SQL editor.
    - `select * from published_pathways` returns 0 rows without error.
    - Insert a test pathway, a version and a published pointer by hand; the view now returns that row.
- *Edge cases:*
  - **Manual:** running `0042` twice fails cleanly or is a no-op for the `if not exists` parts. Note in the PR which, so nobody re-runs it on prod.
  - **Manual:** `match_pathway_units` with a null embedding and `query_text = 'MoU'` returns full-text matches only.
- *Negative cases:*
  - **Manual:** as anon (anon key), `select` from `pathway_sources` or `pathway_source_chunks` returns 0 rows.
  - **Manual:** as anon, `insert` into `pathway_units` is rejected.
  - **Manual:** a `draft` pathway's units, if inserted by hand, are not returned by `match_pathway_units`.
- *Non-functional:*
  - Supabase's linter flags the security-definer view. This is expected (plan → Key Tradeoffs); record it in the PR so it isn't "fixed".

---

### PS-02: Embedding Edge Function (`gte-small`) and `lib/embeddings.ts`

**As a** Solution Team engineer
**I want** a Supabase Edge Function that turns texts into 384-dimension `gte-small` vectors, and one server helper that calls it
**So that** units, source chunks and questions are embedded with an open-source model, with no new vendor (architecture Q5)

**Priority:** P0
**Depends on:** None (deploying it needs a dev project)

**Acceptance Criteria:**
- **The function:** `supabase/functions/embed/index.ts` accepts `POST {texts: string[]}` and returns `{embeddings: number[][]}`. It uses `Supabase.ai.Session('gte-small')` with mean pooling and normalisation; each vector has 384 numbers.
- **Auth:** a request without a valid service-role bearer gets 401, and no model runs.
- **Bad input:** an empty `texts`, more than 32 texts, or a non-string entry gets 400.
- **The helper:** `embedTexts(texts)` in `lib/embeddings.ts`:
  - derives the function URL from `NEXT_PUBLIC_SUPABASE_URL` and sends `SUPABASE_SERVICE_ROLE_KEY`;
  - splits the input into batches of ≤ 32;
  - returns vectors in input order;
  - **throws** on any non-2xx response or timeout (~10s). It never returns partial or zero vectors, so callers can fall back (plan → Availability).
- **Logging:** a thrown error is logged through `logError` with no text content in the log (pathway text is not sensitive, but this keeps `sys_errors` small).
- **Docs:** the deploy step (`supabase functions deploy embed --project-ref <ref>`, once per project, Q4) is written in the PR description.

**Test Plan:**
- *Positive:*
  - **Vitest:** `tests/unit/server/embeddings.test.ts`, with `fetch` mocked:
    - 70 texts make 3 calls (32/32/6);
    - the output order matches the input;
    - the auth header and URL are right.
  - 💲 **Manual:** after deploying to dev, `curl` the function with the service-role key and `{"texts":["data sharing MoU"]}`. It returns one vector of length 384, with norm ≈ 1.
- *Edge cases:*
  - **Vitest:** `embedTexts([])` returns `[]` without calling `fetch`.
  - 💲 **Manual:** a ~600-token text still returns a vector (the model truncates at its ~512-token limit). Units and ~400-token chunks are below that limit.
- *Negative cases:*
  - **Vitest:** a mocked 500 or a timeout makes `embedTexts` throw.
  - **Manual:** `curl` without auth gets 401; with `{"texts":[1]}` it gets 400.

---

### PS-03: Unit parser and the two new unit fields in generation

**As a** contributor (and the seed)
**I want** each micro-innovation in the draft to carry `Sub-category` and `Condition — fails when`, and the app to turn Section 3 into validated unit records
**So that** units can be filtered, counted and searched (requirement item 2; architecture Q1 (a)) while the draft keeps its look

**Priority:** P0
**Depends on:** None

**Acceptance Criteria:**
- **Generation prompt:** `content/pathway-generation-prompt.md` Section 3 asks for two more tag bullets in today's bold-bullet style:
  - `**Sub-category:**` after Dimension, chosen from that dimension's sub-categories in the framework;
  - `**Condition — fails when:**` after "applies when", written as "Not documented in the source" when the source is silent.

  Nothing else about the draft's structure changes. The self-check list includes both.
- **The parser:** `parseUnits(markdown, slug)` in `lib/pathway-units.ts` (pure, no I/O) returns `{units, skipped}`. Each unit has:
  - `id` `<slug>-uNN` (two-digit unit number), `unit_number`, `title`;
  - `unit_type`, `dimension`, `sub_category`, `stage`, `also_relevant_at[]`;
  - `applies_when`, `fails_when`, `body` (the unit's own markdown);
  - `adopter_intents[]`: the Section 6 questions that cite this unit number;
  - `source_ids[]`: the Source Trace rows whose "Covers" names this unit, or `[]`.
- **Validation:** dimension, sub-category, stage and type are checked against `lib/dimensions.ts` and the five unit types.
  - Labels are matched case- and whitespace-insensitively, and a sub-category may be given by its id or its name.
  - A unit with a missing or unknown required label goes to `skipped` as `{unit, reason}`. It is never guessed (plan: skip and warn).
- **Old drafts:** a document written before this change (no Sub-category and no fails-when, e.g. today's `naya-sathi.md`) parses with every unit in `skipped`, reason "missing sub-category". It does not throw.
- **Source Trace:** the appendix is never included in any unit's `body`.

**Test Plan:**
- *Positive:*
  - **Vitest:** `tests/unit/lib/pathway-units.test.ts` with a fixture draft of 3 units in the new format:
    - 3 units, with the right ids, labels, `fails_when`, and intents from Section 6;
    - `source_ids` from a fixture Source Trace.
- *Edge cases:*
  - **Vitest:** a unit with "Also relevant at: Pilot, Scale" gives `also_relevant_at = ['Pilot','Scale']`.
  - **Vitest:** a unit with no Section 6 mention gives `adopter_intents = []`.
  - **Vitest:** unit numbers 1–12 give ids `-u01` … `-u12`.
  - **Vitest:** a sub-category written as its name rather than its id still resolves.
- *Negative cases:*
  - **Vitest:** an unknown dimension, a sub-category from another dimension, or a misspelled type puts that unit in `skipped` with a reason; the other units still parse.
  - **Vitest:** a document with no Section 3 gives `{units: [], skipped: []}`.
  - **Vitest:** today's `naya-sathi.md`, used as a fixture, gives no units and every unit skipped.
- *Non-functional:*
  - 💲 **Manual:** in `/contribute`, generate one draft on dev. The units show the two new bullets and the draft otherwise looks as before (requirement item 2).

---

### PS-04: `lib/pathway-store.ts`: save, publish and read pathways

**As a** Solution Team engineer
**I want** one module that saves versions, publishes them (pointer + units + vectors) and reads published pathways
**So that** routes, chat, readers and the seed all go through the same code (plan → Coupling)

**Priority:** P0
**Depends on:** PS-01, PS-02, PS-03

**Acceptance Criteria:**
- **`saveVersion({pathwayId, content, source, designDocumentId?, createdBy?, changeNote?})`:**
  - inserts the next `version_number` for that pathway (1 for the first) and returns the row;
  - sets `pathways.status = 'in_review'` for `source = 'contributor'`;
  - a concurrent second save for the same pathway either gets the next number or fails on the unique key. It never writes a duplicate number.
- **`publishVersion({pathwayId, versionId, publishedBy})`:**
  1. sets `published_version_id` and `status = 'published'`, and copies the card fields (title, description, stage, sector, location, tags) from the version's frontmatter, as publish does today;
  2. parses units (PS-03) and **replaces** that pathway's `pathway_units`: old rows deleted, new rows inserted with `version_id`;
  3. embeds the units (PS-02) and stores the vectors;
  4. returns `{skippedUnits}`.
- **If embedding fails:** units are saved with `embedding = null`, the failure is recorded in `sys_errors`, and `publishVersion` still succeeds. A later publish of the same pathway fills in the vectors.
- **Readers:**
  - `listPublished()` returns card rows for published pathways only, newest first;
  - `getPublishedDocument(slug)` returns the published content (with `created_at` for `datedLine`), or null for an unknown, draft or retired slug;
  - `buildOverview()` returns `{overview, count}`, with the same shape `lib/library-documents.ts` returns today;
  - `isSlugTaken(slug)` is true for any existing `pathways.slug`, any status.
- **Client:** all writes use the admin client; nothing here runs as the user.

**Test Plan:**
- *Positive:*
  - **Vitest:** `tests/unit/server/pathway-store.test.ts`, with `createAdminClient` mocked (`tests/helpers/supabase-mock.ts`) and `embedTexts` mocked:
    - `saveVersion` on a pathway with 2 versions inserts version 3;
    - `publishVersion` deletes the old units, inserts the parsed ones with vectors, and updates `pathways`.
- *Edge cases:*
  - **Vitest:** publishing a version where every unit is skipped still sets the pointer and returns all of them in `skippedUnits`. The pathway is live with no searchable units.
  - **Vitest:** `getPublishedDocument` on a `retired` pathway returns null.
- *Negative cases:*
  - **Vitest:** `embedTexts` rejects → units are inserted with null embeddings, `logError` is called, and no throw.
  - **Vitest:** the unit insert fails → `publishVersion` throws, so the route answers with the generic message. Note the partial state in the PR: the pointer is already moved, and a re-publish fixes it.
  - **Vitest:** `saveVersion` for a pathway id that doesn't exist throws.

---

### PS-05: Send for review saves a version, not a GitHub commit

**As a** `pathway_contributor`
**I want** "Send for review" to work exactly as today
**So that** my pathway reaches the admin with no GitHub step, and earlier versions are kept (requirement items 1–2; W2 step 1)

**Priority:** P0
**Depends on:** PS-04

**Acceptance Criteria:**
- **Unchanged checks:** given a valid caller (session, any role, `pathway_contributor`, a member of the pathway, their own design), when they POST `/api/pathways/assemble`, then every one of today's checks runs in the same order with the same status codes (401 / 403 / 400 / 404).
- **The save:** `lib/github.ts` is no longer imported. The route calls `saveVersion` with the assembled document (draft + toolkit-asset block, as today), `source = 'contributor'`, `designDocumentId` and `createdBy`. It still sets `content_cache`, `review_requested = true` and `assembled_design_doc_id`. The response body shape is unchanged.
- **Reserved slugs:** the curated-slug check uses `isSlugTaken` semantics for curated names no longer. Only `isValidSlug` remains, because there are no curated files to overwrite (PS-11).
- **Not live yet:** after Send for review, the pathway is **not** live. `published_pathways` and `match_pathway_units` don't return it until an admin publishes (business rule: two-step publish).
- **No repo files:** nothing is written under `content/wiki/pathways/`, and no GitHub API call is made.

**Test Plan:**
- *Positive:*
  - **Vitest:** update `tests/api/pathways/assemble.test.ts`. Remove the `@/lib/github` mock and assert `saveVersion` is called with the assembled content and a 200 with today's body shape.
  - 💲 **Manual:** on dev, a contributor sends a pathway for review.
    - `pathway_versions` gains row N+1 and `pathways.status = 'in_review'`.
    - No new commit appears on GitHub.
    - `/explore` doesn't show the pathway.
- *Edge cases:*
  - **Manual:** sending for review twice without changes gives two versions (N+1, N+2), and both are kept.
  - **Vitest:** a pathway with toolkit assets: the saved content includes the Section 4 file column, as today.
- *Negative cases:*
  - **Vitest:** an `adopter` without `pathway_contributor` gets 403 from the route itself.
  - **Vitest:** a non-member gets 403.
  - **Vitest:** another user's `designId` gets 403.
  - **Vitest:** no draft row gives 400.
  - **Vitest:** `saveVersion` throws → the generic error message, and `sys_errors` is recorded (`withErrorHandling`).

---

### PS-06: Admin publish indexes units (with a skipped-units warning); delete cascades

**As an** `admin`
**I want** Publish and Delete to work from the same panel as today, with a warning when some units couldn't be indexed
**So that** a published pathway is live and searchable at once, without the admin flow changing (requirement item 3; plan decision "skip and warn")

**Priority:** P0
**Depends on:** PS-04

**Acceptance Criteria:**
- **Publish:** given an admin, when they publish a pathway that has a latest saved version, then `/api/admin/pathways/publish` calls `publishVersion` for that version instead of upserting `published_pathways`.
  - The toolkit-asset publishing and the contributor email are unchanged.
  - The response is `{ok, slug, assetsPublished, skippedUnits}`.
- **"Nothing to publish":** the check uses "no saved version" (`pathway_versions` empty) instead of empty `content_cache`, with the same 400 wording.
- **The warning:** when `skippedUnits` is non-empty, the admin pathway card (`components/AdminPathwayRowCard.tsx`) shows a short warning naming the unit numbers and reasons, for example "Published. 2 lessons weren't indexed: Unit 3 (unknown sub-category), Unit 7 (missing stage)". Otherwise the card behaves as today.
- **Delete:** `/api/admin/pathways/delete` no longer deletes from `published_pathways` (it's a view). Deleting the pathway cascades to its versions, units, sources and chunks. Toolkit asset file cleanup is unchanged.
  - Seed `pathway-sources` Storage objects are removed the same way, best-effort and logged.
- **Admin only:** non-admins still get 403 from both routes.

**Test Plan:**
- *Positive:*
  - **Vitest:** update `tests/api/admin/pathways-publish.test.ts`. Assert `publishVersion` is called, assets are published, the email helper is called, and `skippedUnits` is in the body.
  - **Vitest:** update `tests/features/admin/AdminPathwayRowCard.test.tsx` to show the warning when `skippedUnits` has 2 entries.
  - 💲 **Manual:** on dev, publish the PS-05 pathway.
    - `pathways.status = 'published'`, and `pathway_units` has a row per unit with non-null `embedding`.
    - `/explore` shows the card on the next load, with no redeploy.
    - The contributor's email arrives.
- *Edge cases:*
  - **Manual:** re-publishing the same pathway after a new Send for review replaces its units (count changes to the new version's), and the old version stays in `pathway_versions`.
  - **Manual:** a draft generated before PS-03 (no sub-categories) publishes live with every unit listed in the warning.
- *Negative cases:*
  - **Vitest:** a non-admin gets 403 on publish and delete.
  - **Vitest:** an unknown `pathway_id` gives 404.
  - **Vitest:** no saved version gives 400.
  - **Manual:** with the Edge Function stopped, publish still succeeds, units have null `embedding`, and `/admin/errors` shows the embedding failure.
  - **Manual:** after delete, `pathway_versions`, `pathway_units` and `pathway_source_chunks` have no rows for that pathway.

---

### PS-07: `lib/retrieval.ts`: Haiku classifier, hybrid search, pattern grouping, source passages

**As a** Solution Team engineer
**I want** one function that turns a conversation into grounding text for the answer
**So that** Explore and Analyse answer UC1, UC2 and UC3 from what's relevant, not from the whole corpus (requirement items 4–6; plan → Architectural Approach)

**Priority:** P0
**Depends on:** PS-01, PS-02, PS-04

**Acceptance Criteria:**
- **`classifyQuery({messages, surface, openSlug?, publishedTitles})`:**
  - calls `claude-haiku-5-5` with **forced tool use**, as in `app/api/pathways/check-similar/route.ts`;
  - sends `thinking: {type: 'disabled'}`, `output_config.effort: 'low'` and `max_tokens` ≈ 300;
  - sends the last ≤ 6 turns, each capped;
  - returns `{kind: 'specific'|'situation'|'broad'|'patterns', slugs, dimension?, stage?, unitTypes?, searchText}`;
  - records usage with `recordAiUsage({mode: 'retrieval-classify', …})`.
- **Classifier fallback:** on any error, refusal, or tool input that doesn't validate (unknown kind, or slugs not in the published list), it returns the per-surface default with no throw:
  - Explore with a pathway open → `specific` of that slug;
  - Analyse → `situation`;
  - Explore overview → `broad`;
  - `searchText` = the last user message.
- **`hybridSearch({searchText, filters, k})`:** embeds `searchText` (PS-02) and calls `match_pathway_units`. If embedding throws, it calls the RPC with a null embedding (full text + labels) and logs once.
- **`buildGrounding(...)`** produces, per kind (starting limits from architecture Q7):
  - `specific`: that pathway's published write-up with Source Trace stripped (`stripProvenanceAppendix`), plus up to 5 public source passages (`match_source_chunks`) when the pathway is seeded;
  - `situation`: ≤ 3 pathways matched on the design's sector, the top 2 as whole write-ups, plus their top units;
  - `broad`: the top 30 units from ≤ 8 pathways, each prefixed with its pathway title and slug;
  - `patterns`: the top 40 units grouped. Each group is stated with **the number of distinct pathways counted in code**, and groups from one pathway are marked "only one pathway shows this".
- **No N+1:** write-ups are fetched in one `in (...)` query.
- **Output:** it returns `{text, slugs}`, where `slugs` are the pathways actually used (for `adoption_queries`, as today).
- **Source Trace:** it never appears in any grounding text.

**Test Plan:**
- *Positive:*
  - **Vitest:** `tests/unit/server/retrieval.test.ts`, with Anthropic mocked (`tests/helpers/anthropic-mock.ts`), and `embedTexts` and the RPC mocked:
    - each kind builds the expected grounding;
    - `patterns` with units from 3, 1 and 2 pathways labels the groups with those counts and marks the single one.
  - 💲 **Manual:** on dev with seeded data, log `buildGrounding` output for "How did MahaVISTAAR bring its cost down?" → `specific`, and for "What usually goes wrong at Pilot on the institutional side?" → `patterns` with dimension `institution` and stage `Pilot`.
- *Edge cases:*
  - **Vitest:** zero units returned → grounding text says plainly that no documented pathway covers this, so the prompt's absence rule has something to read.
  - **Vitest:** the classifier names a slug that isn't published → that slug is dropped.
  - **Vitest:** a `specific` question on a contributor pathway (no sources) → no source passages and no RPC call for chunks.
- *Negative cases:*
  - **Vitest:** Haiku throws, refuses, or returns an invalid kind → the default per surface, and no throw.
  - **Vitest:** `embedTexts` throws → the RPC is called with a null embedding.
  - **Vitest:** the RPC errors → it throws (the route's `withErrorHandling` handles it).
  - **Vitest:** a passage from an `is_public = false` source never appears, even if the mocked RPC returns one (defence in depth: filter in code too).
- *Non-functional:*
  - 💲 **Manual:** time 10 Analyse messages on dev. Classifier plus search should add ≤ ~2s before the first token. Record the numbers in the PR.

---

### PS-08: Analyse and contributor chat grounded by retrieval

**As an** `adopter` in `/analyse` (and a `pathway_contributor` in `/contribute`)
**I want** the assistant to answer from the pathways relevant to my question or situation, credited to each pathway
**So that** answers are precise and still work at 100 pathways (requirement items 4–5; architecture Q9)

**Priority:** P0
**Depends on:** PS-07

**Acceptance Criteria:**
- **Modes:** in `app/api/chat/route.ts`, `loadWikiContext()` is no longer called. Each mode gets grounding from `buildGrounding`:
  - `companion` with `flow = 'explorer'`: surface `analyse`;
  - `companion` with `flow = 'contributor'`: surface `analyse`, kind defaulting to `situation`;
  - `analysis-doc` and `executive-summary`: kind `situation`, from the design's grid and meta.

  `extract-insights` and `pathway-draft` still load no corpus.
- **Prompt placement:** in `lib/system-prompts.ts`, the grounding goes **after** `PROMPT_CACHE_BREAK`, so the framework part stays cached. The explorer, contributor, analysis-doc and executive-summary prompts take the grounding text where they took `wikiContent`.
- **New explorer rules** (prompt-level, as in the requirement's "How the assistant behaves"):
  - every point names its pathway;
  - a "common pattern" needs 2+ pathways, using the counts given in the grounding;
  - state "fails when" when it matches the adopter's situation, and say when it isn't documented;
  - an answer from a source document is labelled with the file name.

  The existing matching, suggestions-not-recommendations and absence rules are unchanged.
- **Unchanged:** the role re-check on `flow`, the `<grid_update>` contract and the client-side persistence. The model still never writes to Supabase.
- **`adoption_queries`:** it is still tagged, now with the retrieval's `slugs`.

**Test Plan:**
- *Positive:*
  - **Vitest:** update `tests/api/chat.test.ts`:
    - `companion` explorer and contributor, `analysis-doc` and `executive-summary` call `buildGrounding` (mocked) and never `loadWikiContext`;
    - the system prompt contains the grounding after the cache break.
  - **Vitest:** update `tests/unit/lib/system-prompts.test.ts` for the new rules' presence.
  - 💲 **Manual:** on dev, an adopter describes a health voice-bot pilot. The reply cites only health and voice pathways by name, and the Analysis Document is generated from them.
- *Edge cases:*
  - 💲 **Manual:** ask "What usually goes wrong at Pilot?" in Analyse. The reply says how many pathways show each pattern, or "only one pathway shows this".
  - 💲 **Manual:** a generic, off-topic turn ("thanks!") still works, and the grid is not populated by it (existing rule).
- *Negative cases:*
  - **Vitest:** a `companion` call with `flow = 'contributor'` from a user without `pathway_contributor` is still refused by the route.
  - **Vitest:** `buildGrounding` throws → the generic message and `sys_errors`. The stream is not left hanging.
  - 💲 **Manual:** ask about a sector no pathway covers. The assistant says plainly that nothing documented covers it, with no general AI advice.

---

### PS-09: Explore: UC1 in the pathway chat, UC2 and UC3 in the library chat

**As a** public visitor on `/explore`
**I want** precise answers about one pathway (including from its public source documents) and answers across pathways and patterns from the library chat
**So that** all three use cases work without signing in (requirement items 5–6; business Q8; architecture Q8)

**Priority:** P0
**Depends on:** PS-07

**Acceptance Criteria:**
- **Pathway chat:** given `mode = 'library'` with a valid `pathwayId`, the document comes from `getPublishedDocument` (no static file). An unknown, draft or retired slug gets 404, as today.
  - Grounding = the write-up with Source Trace stripped, plus `buildGrounding` kind `specific` passages for seeded pathways with public originals.
  - The library pathway prompt adds the rule: the write-up first; source passages only when it doesn't answer; label them *"…its source document (X) says…"*; otherwise "the pathway doesn't document this".
- **Library chat:** given `mode = 'library'` with no `pathwayId`, the prompt gets `buildOverview()` (count stated, as today) **plus** `buildGrounding` for surface `explore-overview`. That gives `broad` / `patterns` grounding with each point's pathway named and pattern counts.
- **Unchanged:** the rate limit, the input checks (`lib/explore-guard.ts`) and the kickoff turn. They still run **before** any Haiku or embedding call, so a rate-limited visitor causes no model or Edge Function cost.
- **Toolkit asset cards** in Explore are unchanged.

**Test Plan:**
- *Positive:*
  - **Vitest:** update `tests/api/chat.test.ts` library cases: the per-pathway case reads `getPublishedDocument`, and the overview case includes the grounding.
  - 💲 **Manual:** open a seeded pathway with a public original, and ask something only the original contains. The reply names the file.
  - 💲 **Manual:** in the library chat, "How did deployments get departments to share their data?" → points from several pathways, each named.
- *Edge cases:*
  - 💲 **Manual:** the same follow-up on a contributor pathway (no originals) → "the pathway doesn't document this".
  - 💲 **Manual:** a seeded pathway whose originals are all contributor-only → the same absence answer, and the passage text never appears.
  - **Vitest:** an empty history still gets the kickoff turn.
- *Negative cases:*
  - **Vitest:** `pathwayId = '../../x'` gives 404 before any lookup (`isValidSlug`, as today).
  - **Vitest:** a rate-limited request gets 429, and neither `classifyQuery` nor `embedTexts` is called.
  - **Vitest:** the Source Trace of the document never reaches the system prompt.

---

### PS-10: Every pathway reader moves to the store

**As a** visitor, adopter, contributor or admin
**I want** library cards, `/wiki`, the duplicate check, Published badges and the admin pages to show exactly the published pathways in the database
**So that** there is one collection, and a publish shows up everywhere without a code change (requirement items 1 and 7)

**Priority:** P0
**Depends on:** PS-04

**Acceptance Criteria:**
- **`/explore` cards** (`app/explore/page.tsx`, `ExploreLibrary.tsx`) come only from the store or view; there is no merge with `lib/library-pathways.ts`.
- **`/wiki`, `/wiki/[slug]`, `app/api/wiki-pathways` and `app/api/wiki-stats`** list and read published pathways from the store. Source Trace is still stripped on `/wiki` (`stripProvenanceAppendix`).
- **`components/HeatmapGrid.tsx` and `app/admin/usage/page.tsx`** read pathway names and slugs from the store.
- **Duplicate check and Published badges:** `app/api/pathways/check-similar/route.ts` and `app/api/pathways/route.ts` use the view. Their behaviour is unchanged.
- **Slug reservation:** `app/api/pathways/route.ts` (`uniqueSlug`) relies on `pathways.slug` uniqueness / `isSlugTaken`, not on `curatedPathwaySlugs()`.
- **Anon reads:** `/explore` (anon) renders cards from the view without a session.

**Test Plan:**
- *Positive:*
  - **Vitest:** update `tests/api/wiki-pathways.test.ts`, `tests/api/wiki-stats.test.ts`, `tests/api/pathways/pathways.test.ts`, `tests/api/pathways/check-similar.test.ts`, `tests/unit/server/library-documents.test.ts`, `tests/unit/server/wiki-content.test.ts` and `tests/helpers/server-corpus.ts` to mock the store or view instead of static files.
  - **Manual:** on dev after the seed, `/explore`, `/wiki` and the admin panel all list the same N pathways.
- *Edge cases:*
  - **Manual:** with 0 published pathways (fresh dev before the seed), `/explore` and `/wiki` render their empty states with no error.
  - **Manual:** a newly published pathway appears on all three pages on the next load, with no redeploy.
- *Negative cases:*
  - **Manual:** `/wiki/<draft-slug>` and `/wiki/<unknown>` give not-found.
  - **Vitest:** a new pathway named like a deleted curated one (e.g. `mahavistaar`) is allowed if no `pathways` row has that slug, and suffixed if one does.

---

### PS-11: Retire the static corpus, the hard-coded library cards and GitHub

**As a** Solution Team engineer
**I want** the shipped pathway files, `lib/library-pathways.ts`, `lib/github.ts` and their env vars removed
**So that** nothing reads pathways from Git or the repo (requirement item 1; business Q10; architecture Q14)

**Priority:** P1
**Depends on:** PS-05, PS-08, PS-09, PS-10

**Acceptance Criteria:**
- **Deleted:** `content/wiki/pathways/` (all files incl. `index.md`), `lib/library-pathways.ts` and `lib/github.ts`.
- **`lib/wiki-loader.ts`:** loses `loadWikiContext`, `curatedPathwaySlugs`, `isReservedPathwaySlug` and `WIKI_PATH`. It keeps the framework, generation-prompt and resources loaders, and `datedLine`.
- **Search clean:** `grep -r "library-pathways\|lib/github\|content/wiki/pathways\|loadWikiContext\|WIKI_PATH\|GITHUB_TOKEN" app lib components scripts` returns nothing.
- **Env vars:** `.env.example` no longer lists `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH` or `WIKI_PATH`.
- **Build and tests:** `npm run build`, `npm run lint` and `npm test` pass.
- **Tests:** `tests/unit/lib/library-pathways.test.ts` and `tests/unit/server/github.test.ts` are deleted.

**Test Plan:**
- *Positive:*
  - **Manual:** run the grep above; it returns nothing.
  - **Manual:** `npm run build && npm run lint && npm test` all pass.
- *Edge cases:*
  - **Manual:** a fresh `npm run dev` with **no** `GITHUB_*` vars set: Send for review, publish, `/explore` and `/wiki` all work.
- *Negative cases:*
  - **Manual:** with `WIKI_PATH=` set to an empty string (the old pitfall), nothing changes, because the variable is no longer read.

---

### PS-12: Seed script: provided documents become published pathways

**As the** requester (run by a Solution Team engineer)
**I want** a script that turns the document list into published pathways, keeps their originals, and indexes them
**So that** the live library is rebuilt from the provided set (requirement item 7; business Q2, Q3, Q20, Q22; architecture Q12, Q13)

**Priority:** P0
**Depends on:** PS-02, PS-04

**Acceptance Criteria:**
- **Running it:** `npm run seed:pathways -- --manifest <file> [--dry-run]` runs `scripts/seed-pathways.ts`. The manifest (`scripts/seed-manifest.example.json`) lists pathways, each with:
  - `slug`, `title`, optional `sector`;
  - `files[]: {path, public?: boolean}` (default `public: false`, business Q22).
- **Manifest checks:** the manifest is validated first: slugs valid and unique, files exist, supported types only (PDF, DOCX, XLSX, PPTX, TXT, MD). Any problem stops the run before anything is written.
- **Extraction:** text is extracted server-side (pdfjs-dist, mammoth, xlsx, jszip). A file with no text (e.g. a scanned PDF) is reported and skipped; the pathway continues with its other files, or is skipped if it has none left.
- **Per pathway:**
  1. upsert a `pathways` row (`is_seed = true`, `created_by = null`);
  2. upload each file to `pathway-sources/<slug>/<file>`;
  3. insert `pathway_sources` (`source_key` `src-01…`, `extracted_text`, `is_public`);
  4. split into ~400-token chunks, embed them (PS-02) and insert `pathway_source_chunks`;
  5. generate the pathway with Sonnet 4.6 using the framework and `content/pathway-generation-prompt.md`, with the extracted texts as raw material and Source Trace keyed by `src-NN`;
  6. `saveVersion(source='seed')`;
  7. `publishVersion` with **no admin review** (Q3/Q20).
- **Idempotent by slug:** re-running for an existing seeded slug adds a new version and republishes it. Sources and chunks for that pathway are replaced, not duplicated.
- **Summary:** the run ends with a summary: pathways published, skipped units per pathway, files skipped, failures. Exit code is non-zero if any pathway failed.
- **`--dry-run`:** validates and extracts only. No Storage, database or Anthropic calls.

**Test Plan:**
- *Positive:*
  - **Vitest:** `tests/unit/server/seed-manifest.test.ts` covers manifest validation and chunking (chunk sizes ≤ the limit; overlap if implemented).
  - 💲 **Manual:** on dev, a 2-pathway manifest (one with a public PDF, one all private).
    - Both are in `/explore`.
    - `pathway_sources.is_public` matches the manifest.
    - The chunks have embeddings.
    - The summary lists any skipped units.
- *Edge cases:*
  - 💲 **Manual:** re-run the same manifest → version 2 for both, the same number of chunks (no duplicates), and still published.
  - **Manual:** a scanned PDF in the manifest is reported as "no readable text" and the rest of the pathway proceeds.
  - **Manual:** `--dry-run` writes nothing (check that the row counts are unchanged).
- *Negative cases:*
  - **Vitest/Manual:** a missing file path, a duplicate slug or a `.zip` stops the run before any write, with the reason.
  - 💲 **Manual:** with the Anthropic key invalid, each pathway fails with a clear line, the exit code is non-zero, and no half-published pathway is left (no version is saved without generation).
- *Non-functional:*
  - Note in the PR: the seed is blocked on the requester's document list for the real run; development and the dev run use sample documents.

---

### PS-13: Test set on dev, then prod rollout

**As the** Program Team and Solution Team
**I want** the ~20-question test set run on the dev app before prod is touched
**So that** the live app only gets the new search once UC2 reaches 85–90% (requirement item 8; business Q14; architecture Q14)

**Priority:** P0
**Depends on:** PS-01 to PS-12

**Acceptance Criteria:**
- **The test set:** `docs/features/pathway-storage/test_set_pathway_storage.md` is created from `main`'s `docs/features/cube-brain-knowledge-source/test_set_cube_brain_knowledge_source.md`. Its questions are adapted to the seeded pathways, with ≥ 5 per use case (UC1, UC2, UC3) plus ≥ 3 that should find nothing. Each has its expected pathways or units.
- **The run:** done on dev in **both** Explore (library chat and pathway chat) and Analyse, judged and recorded in the file. UC2 recall is ≥ 85%, and every "should find nothing" question gets a plain absence answer.
- **Prod rollout order:**
  1. migration `0042`;
  2. `supabase functions deploy embed`;
  3. the `pathway-sources` bucket;
  4. the seed with the final manifest;
  5. app deploy.

  It is written as a checklist in the PR. Prod is not touched until the dev run passes (no switch exists).
- **Open items closed before prod:** `claude-haiku-5-5` confirmed enabled for the prod key, and the Anthropic account renewal confirmed (plan → Risks).

**Test Plan:**
- *Positive:*
  - 💲 **Manual:** run the full set on dev and record pass/fail per question in the test-set file.
- *Edge cases:*
  - 💲 **Manual:** repeat 3 UC3 questions twice. The pattern counts are identical across runs (they are computed in code).
- *Negative cases:*
  - 💲 **Manual:** UC2 < 85% → stop; tune the limits or prompts (PS-07/08/09) and re-run. Prod stays untouched.
  - **Manual:** stop the Edge Function on dev and ask 3 questions. The answers still come (full-text fallback), and `/admin/errors` shows the embedding failures.

## Not covered by these stories

- **Waiting on others:**
  - the real seed run is blocked on the requester's document list (PS-12 builds and dry-runs the script only);
  - confirming the Anthropic account renewal and Haiku 5.5 access is an action for the account owner (PS-13 only checks it).
- **Left as is** (TD-05): adding retries to Anthropic calls.
- **Separate pieces of work:**
  - upgrading Sonnet 4.6 to 5.5;
  - removing `pathways.content_cache`.
- **Docs after merge:** refreshing the wiki (`llm-wiki`), including the new Edge Function deploy step in `operations/deployment.md`.
- **Out of scope by the requirement:**
  - admin version history, compare and rollback screens;
  - claim tracing;
  - disclosure editing;
  - the fidelity check;
  - keeping contributor uploads;
  - batch regeneration;
  - reviewed pattern syntheses;
  - a public read API;
  - Cube-Brain.
