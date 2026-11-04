# Test Set: Pathway Storage in the App Database

This is the go-live gate for the pathway-storage feature (requirement item 8; task PS-13). It covers the three use cases, follow-ups answered from source documents, and questions that should find nothing. It is adapted from the Cube-Brain retrieval test set on `main` (`docs/features/cube-brain-knowledge-source/test_set_cube_brain_knowledge_source.md`, run 2026-10-30).

> **Status: not run yet.** The questions name pathways from today's corpus.
>
> **Before running:**
> - Once the seed document list is final, keep each question whose pathway is seeded.
> - Replace the others with a question of the same kind about a seeded pathway.
> - Check the "Expected" column against the seeded documents.
>
> **Pass mark:**
> - UC2 recall ≥ 85% (the expected pathways that the answer actually names);
> - every "Nothing" question answered with a plain absence;
> - no answer quoting a contributor-only document.
>
> **Prod is not updated until this passes on dev.** There is no switch back (architecture Q14).

## How to run it

1. On the **dev** Supabase project, set things up in this order:
   1. apply migration `0042`;
   2. deploy the Edge Function (`supabase functions deploy embed --project-ref <dev-ref>`);
   3. run the seed (`npm run seed:pathways -- --manifest <file>`).
2. Run the dev app (`npm run dev`) against that project. Confirm that `claude-haiku-5-5` is enabled for the dev Anthropic key.
3. Ask each question in a **new conversation**, on the surface its table names:
   - **Library**: `/explore` with no pathway open;
   - **Pathway**: `/explore` with that pathway open;
   - **Analyse**: `/analyse`, after one line of context such as "We run a farmer helpline in Maharashtra".
4. Judge each answer against its expectation and record ✅ / ❌ with a one-line note. 💲 Every answer is a real Anthropic call (Haiku plus Sonnet).
5. To see what retrieval picked, look at `ai_usage`: one `retrieval-classify` row per question in Library and Analyse.

## UC1: specific information from one pathway

| # | Surface | Question | Expected | Result |
|---|---|---|---|---|
| S1 | Library, Analyse | How did MahaVISTAAR bring its cost per question down? | From MahaVISTAAR only: ₹9.4 → ₹0.05 (180×), moved off Azure OpenAI to a self-hosted model; input tokens ~80% of spend → prefix caching | |
| S2 | Library | Which districts did Blue Dots start in? | Dharwad, Karnataka (pioneer, 2024), then Ghaziabad, UP | |
| S3 | Pathway (CEEW) | What two AI systems were built? | A conversational climate-data agent (CRAVIS.AI) and a dengue early-warning system | |
| S4 | Analyse | Would MahaVISTAAR's three-vendor approach work for our small NGO? | Its "applies when" / "fails when" conditions stated; if "fails when" isn't documented, says so; the unit is credited to MahaVISTAAR | |

## UC1 follow-ups from source documents (seeded pathways with public originals)

| # | Surface | Question | Expected | Result |
|---|---|---|---|---|
| O1 | Pathway (a seeded pathway with a public original) | A detail only in its original, not in the write-up (e.g. "Which telephony vendor did they choose?") | Answered, with the label "isn't in the write-up, but its source document <file> says…" | |
| O2 | Pathway (same) | A detail only in a **contributor-only** original | "The pathway doesn't document this." The private text never appears. | |
| O3 | Pathway (a contributor pathway, no originals) | A detail not in its write-up | "The pathway doesn't document this." No guessing. | |

## UC2: relevant answers across pathways

| # | Surface | Question | Expected pathways (recall) | Result |
|---|---|---|---|---|
| B1 | Library | How have teams handled working with government departments and data ownership? | Data DHARA, MahaVISTAAR (+ others), each point credited | |
| B2 | Library | What have deployments learned about supporting low-resource languages and dialects? | African Voice AI, Bhili, Voice AI for Inclusion | |
| B3 | Analyse | How did different teams deal with data readiness before building the AI? | MahaVISTAAR, Data DHARA, CEEW | |
| B4 | Library | What do the pathways say about making voice AI work over phone calls? | MahaVISTAAR, Voice AI Adoption Barriers, African Voice AI | |
| B5 | Library | How did deployments get departments to share their data? *(worded differently from the units: tests search by meaning)* | Units worded "MoU" / "federated access" are found | |

## UC3: common patterns across pathways

| # | Surface | Question | Expected | Result |
|---|---|---|---|---|
| P1 | Library | What problems commonly come up across deployments at the Pilot stage? | Patterns each naming ≥ 2 pathways | |
| P2 | Analyse | What usually goes wrong at Pilot on the institutional side? | Institution × Pilot × Failure and Fix groups; counts stated; one-pathway groups called "only one pathway shows this" | |
| P3 | Library | What do the deployments that reached scale have in common? | Shared traits named with their pathways | |
| P4 | Library | Is there a common pattern in using prefix caching to cut GPU inference cost? | **"Only one pathway shows this"**: MahaVISTAAR | |
| P5 | Library | P2 asked twice, in two new conversations | Identical pathway counts both times (counted in code) | |

## Nothing in the corpus (absence stated plainly)

| # | Surface | Question | Expected | Result |
|---|---|---|---|---|
| N1 | Library | Do you have a pathway on AI for fisheries in Kerala? | Says plainly there's none; any adjacent pathway is labelled as adjacent | |
| N2 | Analyse | How did the Tamil Nadu education department roll out chatbots in schools? | Says plainly there's none | |
| N3 | Library | What did a hospital learn from deploying AI for radiology image triage? | Says plainly there's none; no general medical advice | |

## Degraded mode (dev only)

| # | Check | Expected | Result |
|---|---|---|---|
| D1 | Undeploy or break the `embed` function, then ask B1 and P1 | Answers still come (full text + labels); `/admin/errors` shows the embedding failures | |
| D2 | Use an Anthropic key without Haiku access, then ask B1 | Answer still comes (default kind, plain hybrid search); `ai_usage` shows `retrieval-classify` `ok=false` | |
