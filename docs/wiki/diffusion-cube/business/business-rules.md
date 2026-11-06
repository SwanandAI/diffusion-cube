# Business Rules

Every rule below traces to `content/framework.md`, `lib/system-prompts.ts`, `lib/explorer-intents.ts`, `lib/retrieval.ts`, `lib/dimensions.ts`, or the specific route or migration named. "Prompt-level" means the rule is an instruction to the model, not something code checks.

## Matching and presentation

| Rule | Source | Enforcement |
|---|---|---|
| "Relevant" means same sector **and** same use-case category. One test, applied everywhere | `content/framework.md`; `lib/system-prompts.ts` (`explorerSystemPrompt` relevance section) | Prompt-level |
| An exact match is presented directly. A related but not exact match (asked "healthcare", the pathway is "public health") is offered only after saying plainly there is no direct match, with the difference stated in a few words | `lib/system-prompts.ts` (`BEST_MATCH_RULE`, Explorer relevance section), `lib/explorer-intents.ts` step 2 | Prompt-level |
| Micro-innovations are always framed as suggested choices, never recommendations | `content/framework.md`; analysis-doc rule 6 | Prompt-level |
| Absence is stated plainly, never softened or backfilled with general knowledge. "None of the documented pathways covers this yet" is a complete answer. Pathway absence and micro-innovation absence are reported as two separate absences | `content/framework.md`, `lib/explorer-intents.ts` step 2 | Prompt-level |
| Every pathway point is attributed to its contributor in the same sentence ("EkStep Foundation's account of Blue Dots shows…"), and carries the conditions it worked under and when it didn't hold | `lib/system-prompts.ts` (`groundingRules`) | Prompt-level |
| Call something a common pattern only when the grounding says 2 or more pathways show it. Those counts are computed in code and must not be recounted. A lesson only one pathway shows is described as such | `lib/system-prompts.ts` (`groundingRules`), `lib/retrieval.ts` (`groupPatterns`) | Counts code-computed; wording prompt-level |
| A seeded pathway's source-document passage is a fallback: use it only when the pathway's write-up doesn't answer, and name the source file | `lib/system-prompts.ts` (`groundingRules`), `lib/retrieval.ts` (`pathwayPassages`) | Prompt-level; passages only exist for seeded pathways |
| Answers draw only on the pathways and lessons retrieved for the current question (per-kind caps in `LIMITS`: e.g. at most 2 whole documents for `specific`, 8 pathways for `broad`, 40 lessons for `patterns`), not on the whole corpus | `lib/retrieval.ts` (`buildGrounding`, `LIMITS`) | Code-enforced (what reaches the prompt) |

## Answer-shape rules

Added in November 2026 from adopter feedback. Answers were pulling in loosely related pathways, naming pathways without saying what they were, running long, and using loaded or insider words. They are defined once as shared constants in `lib/system-prompts.ts` and interpolated into each prompt, so every surface says the same thing.

| Rule | Constant / source | Applies to | Enforcement |
|---|---|---|---|
| **Single best match.** Answer with the one best-matching pathway only. If nothing matches directly, say so plainly first; then offer one genuinely related pathway as the closest match, saying how it differs. Never stretch a pathway to fit or add a second or third because it was retrieved. Use more than one only when the user asks to compare pathways or asks what's common across them; then credit each point to its pathway and name any part of the question none of them covers | `BEST_MATCH_RULE`; `lib/explorer-intents.ts` step 2 ("pick the single best one"); `evidenceHandlingRules` ("by default, answer from the single best match only"); broad-kind grounding header in `lib/retrieval.ts` ("Use only the lessons that directly answer the question") | Analyse and Contribute companion (`groundingRules`), Library overview chat (`libraryOverviewSystemPrompt`). The analysis document has its own equivalent: "If nothing is genuinely relevant, omit rather than force" | Prompt-level |
| **Describe a pathway on first mention.** Never assume the user knows a pathway by name; add a few plain words on what was built, for whom and where — e.g. "MahaVISTAAR (a phone advisory service Maharashtra's government runs for farmers)" | `PATHWAY_CONTEXT_RULE` | Analyse/Contribute companion, Analysis Document and Executive Summary (rule 7), both Library prompts | Prompt-level |
| **Short, answer first.** No preamble, no restating the question; open with the answer. Companion: at most 4 sentences of prose (Explorer: 2–4 for most replies, longer only when a step calls for it or the user asked to compare, then one lead-in + up to three bullets). Library: one short paragraph is the normal reply | `speakingRules`, `explorerSystemPrompt` length section, `libraryPathwaySystemPrompt` / `libraryOverviewSystemPrompt` "Length" | Companion, Library | Prompt-level |
| **Neutral, non-judgemental language.** Describe what happened in factual words — never "flopped", "failed miserably", "a disaster", "botched", "got it wrong". Say "the first version didn't reach enough farmers, so the team changed X" | `NEUTRAL_LANGUAGE_RULE` | Companion (`speakingRules`, for other adopters; the user's own approach is never evaluated at all), Analysis Document and Executive Summary (rule 7), both Library prompts | Prompt-level |
| **No insider jargon.** Say "the documented pathways" / "other deployments", not "the corpus"; "a practice another team used", not "micro-innovation"; "the conditions it worked under", not "condition tag"; never "unit", "adjacent match", "failure-and-fix", "use-case category" | `PLAIN_WORDS_RULE` (alongside the older framework-jargon translations in `speakingRules`) | Companion, both Library prompts. The documents have their own rule 4 (no classification machinery) | Prompt-level |

> **Note:** Live testing on 2026-11-06 led to firmer versions of these rules: word caps (Analyse about 120, Library about 100), every point taken from the one best pathway, technical terms explained, no repeating a judgemental word even when the user used it, and nothing mentioned that would be "a stretch". See [`test_set_answer_shape.md`](../../../../scripts/test-harness/answer-shape-eval/answer-shape-feedback/test_set_answer_shape.md) for the 10-question test set and results.

> **Note:** These rules apply to the adopter-facing surfaces only (Analyse and the Library); the Contributor prompt is unchanged. The surfaces differ on how a reply ends. Companion replies must not end on a question (`speakingRules`). Library replies end with one short follow-up question about the same pathway — except a "not covered" reply, which ends plainly (`libraryPathwaySystemPrompt`, `libraryOverviewSystemPrompt`). When another pathway got a directly different result on the same question, the answer stays with the best match and mentions the other in one clause, offering to show it. This is intended: the Library prompts are no longer copied verbatim from the old Diffusion Library app, but they keep its house style apart from the shared answer-shape rules.

## Grid / density rules

| Rule | Source | Enforcement |
|---|---|---|
| `designs.meta.stage` is only ever set from the user's own statement, never assigned by the model | `ARCHITECTURE.md`, confirmed against `lib/system-prompts.ts` | Prompt-level |
| Only *changed* cells are reported in `<grid_update>`; the client merges rather than replaces | `lib/adoption-conversation.ts` | Code-enforced (merge logic) |
| A generic turn that doesn't engage any pathway populates nothing in the grid, however useful the reply | `lib/system-prompts.ts` | Prompt-level |
| Each sub-category is weighted Primary/Secondary/Dormant **per stage**, not fixed — e.g. *Performance, Reliability and Scale* is dormant at Explore, primary at Pilot | `lib/dimensions.ts` | Data-encoded (`SubCategory.weights`) |
| Density 0 means "not yet established", never "failed". Unsettled items are framed as a question or decision, never a deficiency | `content/framework.md`; analysis-doc rule 5 | Prompt-level |

## Provenance and framework-naming rules

| Rule | Source | Enforcement |
|---|---|---|
| The Provenance/Source Trace appendix is contributor-only and never surfaced in any adopter-facing response | `content/framework.md`, `lib/provenance.ts` (`stripProvenanceAppendix`, re-exported by `lib/wiki-content.ts`), `lib/pathway-store.ts` (`adopterDocument`) | Code-enforced for `/wiki` display and adopter documents; prompt-level for chat |
| A seeded pathway's original source files are contributor-only unless the seed manifest marks them `"public": true` | `scripts/seed-pathways.ts`, `lib/seed.ts`; `match_source_chunks` is service-role only (migration `0042`) | Code/RLS-enforced |
| The framework itself is never named as a process in user-facing prose (no sub-category codes, densities, unit-type labels). The four dimension and four stage names are public vocabulary | `content/framework.md`, `groundingRules` | Prompt-level |

## Access and usage limits

| Rule | Source | Enforcement |
|---|---|---|
| Every account is an Explorer (`adopter`) from signup. There is no approval step, and an admin cannot grant or remove `adopter` | migration `0039_default_adopter_role.sql`, `app/api/admin/roles/route.ts` (`VALID_ROLES`) | DB trigger + code |
| The role each chat call needs follows its mode and flow (`pathway-draft`, `asset-reuse` and contributor-flow `companion`/`extract-insights` need `pathway_contributor`; everything else needs `adopter`), whatever the UI sent | `app/api/chat/route.ts` (`requiredRole`) | Code-enforced |
| Chat is rate-limited before the body is parsed: signed-in users per account (`chat-user`, default 30/min · 300/day), anonymous callers per IP (`explore`, 20/min · 200/day); env-overridable via `<SCOPE>_PER_MIN`/`_PER_DAY`. Oversized bodies, too many messages (>500) or over-long text are rejected with 413 | `app/api/chat/route.ts`, `lib/rate-limit.ts`, migration `0037` | Code + DB-enforced |
| A signed-in session sees only the `pathways` rows it contributes to, plus all of them for an `admin` role. Unpublished drafts are not readable by other users | migration `0040_pathways_member_rls.sql` | RLS-enforced |
| Only `published` pathways are public: the library, `/wiki/<slug>`, and chat grounding all read through the `published_pathways` view / `getPublishedDocument(s)`. `draft`, `in_review` and `retired` are not public | migration `0042` (view `where p.status = 'published'`; `match_pathway_units` filters on `published`), `lib/pathway-store.ts`, `lib/wiki-content.ts` | DB + code-enforced |

## Process control (publishing)

| Rule | Source | Enforcement |
|---|---|---|
| Contributor "Send for review" (save a new `pathway_versions` row) and admin "publish" (point the pathway at that version and index its units) are two separately gated actions. Neither touches GitHub | `app/api/pathways/assemble/route.ts`, `app/api/admin/pathways/publish/route.ts`, `lib/pathway-store.ts` | Code-enforced (separate routes, separate role requirements) |
| A contributor can only send their own workspace's draft for a pathway they are a member of | `app/api/pathways/assemble/route.ts` (membership + `designs` ownership checks) | Code-enforced |
| Version numbers are never reused: two saves racing for the same number hit the `(pathway_id, version_number)` unique key and the loser fails | `lib/pathway-store.ts` (`saveVersion`), migration `0042` | DB-enforced |
| Sending a new version of a live pathway does not take it out of the library: a `published` pathway stays published while `review_requested` marks the waiting version. Only a `draft` moves to `in_review` | `lib/pathway-store.ts` (`saveVersion`) | Code-enforced |
| On publish, units whose dimension, sub-category, stage or type is missing or outside the framework vocabulary are skipped (never guessed) and reported to the admin; the rest of the pathway publishes | `lib/pathway-units.ts` (`parseUnits`), `app/api/admin/pathways/publish/route.ts` | Code-enforced |
| Seeded pathways publish without admin review | `scripts/seed-pathways.ts` (business decisions Q3/Q20 in `docs/features/pathway-storage/`) | Operator-run script |
| Deleting a pathway also unpublishes it in the same statement and removes its stored files (toolkit assets, seed sources); contributors' workspaces survive, unlinked | `app/api/admin/pathways/delete/route.ts`, migrations `0024`, `0042` | Code + FK cascade |
| A pathway insert requires the `pathway_contributor` role, checked at the database layer via an `exists` subquery on `user_roles` | `supabase/migrations/0020_pathways.sql` | RLS-enforced |
| An organisation's `url` is set only on first creation and never overwritten by a later contributor's registration for the same org | `lib/organisations.ts` (`ensureOrganisation`) | Code-enforced |
| A pathway keeps the same slug/URL across versions and re-publishes (the slug lives on `pathways`; versions hang off `pathway_id`) | `lib/pathway-store.ts`, migration `0042` | Code-enforced |

## Toolkit asset rules

| Rule | Source | Enforcement |
|---|---|---|
| Nothing is stored for an asset until the contributor explicitly agrees to public sharing; "No" stores nothing. Every asset row has `share_consent = true` | `components/ToolkitAssetConsentCard.tsx`, `AssetShareCard.tsx`, migration `0034` (`contribution_units_toolkit_asset_shape` check) | Code + DB check |
| An asset goes live only with its pathway: admin publish sets `published_at` on exactly the assets listed in the reviewed document. An asset added after the last Send for Review waits for the next round | `app/api/admin/pathways/publish/route.ts` | Code-enforced |
| Contributors cannot self-publish assets: every write goes through service-role routes (migration `0034` dropped the client insert/update policies) | migration `0034`, `app/api/toolkit-assets/*` | RLS + code |
| Files: max 25 MB, fixed extension → MIME list, no ZIP; links must be `https://` | `lib/toolkit-assets.ts` (`MAX_ASSET_BYTES`, `ASSET_MIME_BY_EXTENSION`), bucket limits and `link_url` check in migration `0034` | Storage bucket + DB check (UI checks early) |
| Published assets are downloadable by anyone; unpublished ones only by their uploader or an admin; everyone else gets the same 404 as a missing id. The storage URL is never exposed | `app/api/toolkit-assets/[id]/download/route.ts` | Code-enforced |
| The model only ever supplies asset ids; anything shown comes from the public asset API, which drops unknown or unpublished ids, so an invented id renders nothing | `components/ToolkitAssetCards.tsx`, `app/api/toolkit-assets/route.ts` | Code-enforced |
| The drafted purpose and reuse condition use only what the contributor wrote and the asset title — no invented numbers, names or results | `lib/system-prompts.ts` (`assetReuseSystemPrompt`) | Prompt-level |

## Data quality / de-duplication

| Rule | Source | Enforcement |
|---|---|---|
| A new pathway's title is checked against existing pathways for likely duplication (a forced-tool-use Claude call over every pathway, read with the service role) before it is created as a fresh pathway | `app/api/pathways/check-similar/route.ts` | Best-effort. Anthropic failures fall back to "no match found", so this is advisory, not a hard gate |
| Pathway slugs are made unique against **any** existing `pathways` row, whatever its status, by adding a numeric suffix. There are no shipped pathway files to collide with any more | `app/api/pathways/route.ts` (`uniqueSlug`; `lib/pathway-store.ts` also exports an equivalent `isSlugTaken` that nothing calls yet) | Code-enforced + unique constraint |
| A malformed slug is refused at send-for-review | `app/api/pathways/assemble/route.ts` (`isValidSlug`) | Code-enforced |

> **Note:** The earlier rule that `content/wiki/pathways/index.md` was the only way into the grounding corpus no longer applies. `content/wiki/` has been removed. Every pathway, seeded or contributed, now lives in Supabase and is found by status and search, not by a hand-maintained index.

## Monitoring rule

Every companion-mode user message is logged (fire-and-forget) to `adoption_queries`, tagged with the pathway slugs the response drew on. It is kept for future cross-adoption insight, but nothing reads this table back yet. Every Claude call (including the retrieval classifier, as `retrieval-classify`) is recorded in `ai_usage`. See [`../integrations/async-processing.md`](../integrations/async-processing.md) and [`../operations/monitoring.md`](../operations/monitoring.md).

## Product Non-Rules (raw docs state rules the code does not enforce)

- `CLAUDE.md` once stated that the Explorer flow "never sets an agenda outside [the chosen] flow, never switches intent without asking first". That is moot today: there is only one flow (`ANALYSE_FLOW`) and no intent choice to switch away from.
- `SIGNUP_APPROVAL_OPTIONS.md` implies every signup needs manual admin sign-off before any access. The opposite is now enforced: `adopter` is granted by a database trigger at signup (migration `0039`).

## Source files

`content/framework.md`, `lib/dimensions.ts`, `lib/system-prompts.ts`, `lib/explorer-intents.ts`, `lib/retrieval.ts`, `lib/pathway-store.ts`, `lib/pathway-units.ts`, `lib/provenance.ts`, `lib/rate-limit.ts`, `lib/toolkit-assets.ts`, `lib/organisations.ts`, `app/api/chat/route.ts`, `app/api/pathways/route.ts`, `app/api/pathways/assemble/route.ts`, `app/api/pathways/check-similar/route.ts`, `app/api/admin/pathways/publish/route.ts`, `app/api/admin/pathways/delete/route.ts`, `app/api/toolkit-assets/*`, `scripts/seed-pathways.ts`, `supabase/migrations/0020_pathways.sql`, `0034`, `0037`, `0039`, `0040`, `0042`.
