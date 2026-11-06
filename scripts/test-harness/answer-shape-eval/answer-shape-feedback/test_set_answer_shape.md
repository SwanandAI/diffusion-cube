# Test Set: Answer-Shape Rules from Adopter Feedback

This test set checks the prompt change made in response to adopter feedback (2026-11). The change lives in `lib/system-prompts.ts` (`BEST_MATCH_RULE`, `PATHWAY_CONTEXT_RULE`, `NEUTRAL_LANGUAGE_RULE`, `PLAIN_WORDS_RULE`), `lib/explorer-intents.ts` and `lib/retrieval.ts`. The feedback asked for four things:

1. Don't overfit or force-fit. If there is no direct match, say so; if something is relevant, give only the best match.
2. Don't assume adopters know pathway names. Give a few words of context.
3. Keep answers short and to the point.
4. Use non-judgemental language (never words like "flopped") and no jargon.

The rules apply to **Analyse** (Explorer chat and documents) and the **Library** (`/explore`) only. The Contributor prompt is unchanged: its generated text is byte-identical to before the change.

> **Status: run on 2026-11-06, four rounds. Much better than the old prompts, but it doesn't fully pass.** In the final round, 5 of 10 answers fully meet expectations, 5 partly, 0 fail. The old prompts averaged 0.2 fully meeting, 7.5 partly and 2.2 failing across four runs. Two things still miss: on voice-for-farmers questions a second pathway still appears in about half the runs, and Library answers run about twice their word cap. See [Results](#results). Raw answers and grades: [round 1](results_2026-11-06_round1.json), [round 4](results_2026-11-06_round4.json).
>
> **Pass mark:**
> - every new-prompt answer passes rules 1–4 (or marks them n/a);
> - none uses a banned or judgemental word;
> - none uses an insider term;
> - the old prompts are graded the same way, so any improvement shows up as a before/after difference.

## The questions

Questions are written against the 10 pathways published on 2026-11-06 (AxL, Amul / Sarla Ben, African Voice AI Kenya, MahaVISTAAR, Voice AI for Inclusion, Bhili Language Enablement, Nivesh Suvidha, DeepLeaf, Blue Dots, CEEW Climate Intelligence). If that set changes, re-check the "Expected" column.

| # | Surface | Kind | Question | Expected |
|---|---|---|---|---|
| Q1 | Analyse | Direct match | We're a state agriculture department planning a phone-based voice advisory for small farmers in Odia. What should we watch out for? | One best-matching agriculture voice pathway, described in a few words, with a concrete documented lesson. No second or third pathway piled on. |
| Q2 | Analyse | No match | We run a chain of dental clinics in Dubai and want AI to send appointment reminders and answer patient FAQs. What have others learned? | Says plainly that there is no direct match. At most one genuinely related pathway, with the difference stated. No stretching an agriculture pathway to fit. |
| Q3 | Analyse | Vague newcomer | I work at a small NGO and I'm new to AI. Where do I even start? | Short, plain language, no jargon. Doesn't dump several pathways. May ask one clarifying question, but not as the final sentence. |
| Q4 | Analyse | Common patterns (several pathways allowed) | What are the common reasons AI pilots in government struggle to scale? | Several pathways are allowed because the user asked what's common. Each is credited and briefly described. Something is called "common" only if 2+ pathways show it. |
| Q5 | Analyse | Explicit comparison (several pathways allowed) | Compare how MahaVISTAAR and the African Voice AI project in Kenya handled local languages. | Both pathways compared, each described in a few words. Neutral and concise. |
| Q6 | Analyse | Judgement bait | Which of these projects flopped the worst, and why? | Declines to rank or judge. Neutral wording, never "flopped". May describe a documented setback and fix neutrally. |
| Q7 | Analyse | Sector match (education) | We want to use AI to help teachers in government schools in Uttar Pradesh track children's reading levels. | One best match (the literacy pathway), described on first mention, with a concrete lesson. Concise. |
| Q8 | Library, no pathway open | Not covered | Do you have anything on AI for courts or legal systems? | Says in one line that the library doesn't have it. Offers a related pathway only if one genuinely is. Ends plainly, with no closing question. |
| Q9 | Library, no pathway open | Broad question | How did teams get rural users to actually trust and use a voice assistant? | Answers from the single best-fitting pathway, described in a few words. Short, neutral, plain. Ends with a short question about that same pathway. |
| Q10 | Library, `blue-dots` open | Setbacks on one pathway | What did they get wrong early on, and what did they change? | Neutral account of early setbacks and changes, with no "flopped" or "failed miserably". Short, plain. Ends with a question about this same pathway. |
| Q11 | Analyse | Funder role, gaps in the documentation *(added after the 2026-11-06 runs)* | I'm with a philanthropic foundation deciding whether to fund an AI heat-wave early-warning system for city health departments. What should we ask the team before we commit? | One best match (the CEEW climate pathway), described in a few words and framed for a funder. Says plainly where that pathway doesn't document something (e.g. who runs and pays for it day to day) instead of filling the gap. Short, neutral, no jargon. |
| Q12 | Library, `ceew-climate-intelligence` open | Not in the document *(added after the 2026-11-06 runs)* | How much did it cost to build and run, and who paid for it? | Says in one line that this pathway doesn't document the cost or who pays. Invents no figures. Mentions something close only if the document really has it. Ends plainly, with no closing question. |

## How each answer is checked

**Automatic checks:**
- word count;
- which pathways are named (to spot extra pathways piled on);
- banned words (`flopped`, `failed miserably`, `disaster`, `botched`, `got it wrong`, `fiasco`);
- insider terms (`corpus`, `micro-innovation`, `condition tag`, `adjacent match`, `failure-and-fix`, `use-case category`, `sub-category`, `density`);
- whether the reply ends with a question.

**Graded by a separate model call:** rules 1–4 are each scored pass, fail or n/a, and the case's "Expected" column is scored pass, partial or fail. The grader sees the question, the expected behaviour, the list of published pathways and the answer.

**Before/after:** each question is answered twice from the *same* search results, once with the committed prompts (HEAD `0a1ca00`) and once with the new ones.

## How to run it

```bash
npm install                     # once: the harness needs the dev dependencies (vite-node)
npm run eval:answers            # all 10 questions, current prompts
npm run eval:answers -- --baseline HEAD           # also answer with HEAD's prompts, side by side
npm run eval:answers -- --only Q1,Q9 --baseline main
npm run eval:answers -- --judge-model claude-sonnet-4-6 --out my-run.json
```

The harness lives in [`scripts/test-harness/answer-shape-eval/`](../), this folder's parent. The questions are in `cases.ts` (keep them in step with the table above), and the runner is `run.ts`. It calls the app's real retrieval and prompt builders with the same model and `max_tokens` as `/api/chat`. Search results are fetched once per question and shared by every variant, so `--baseline` compares prompts only.

- **Reads, never writes:** it reads Supabase (published pathways, hybrid search, toolkit assets). The `ai_usage` and `sys_errors` loggers are swapped for console stubs by `scripts/test-harness/answer-shape-eval/vite-node.config.mts`.
- **Needs:** `.env.local` or `.env` with `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The key needs access to `claude-sonnet-4-6` (answers), `claude-haiku-5-5` (the retrieval classifier) and the grading model (default `claude-opus-5-5`; if it doesn't call the grading tool, `claude-sonnet-4-6` grades instead).
- **Cost:** live, paid model calls — about 2 per question, doubled with `--baseline` (about 40 for the full set with a baseline). It is deliberately **not** part of `npm test`.
- **Output:** a summary table in the console, plus every answer, check and grade as JSON in `scripts/test-harness/answer-shape-eval/results/` (gitignored), or in `--out`. Copy a run worth keeping into this folder, as was done for `results_2026-11-06_round*.json`.
- **Noise:** answers vary from run to run, so treat a one-question difference between runs as noise.

## Results

**Run:** 2026-11-06. Answers came from `claude-sonnet-4-6` and grades from `claude-opus-5-5`. Every round used the live Supabase project (10 published pathways) and wrote nothing to the database. Each round re-ran the old prompts (HEAD `0a1ca00`) beside the new ones, so the old figures below are averaged over four runs.

### Rounds

| Round | Prompt changes in that round |
|---|---|
| 1 | The four answer-shape rules (single best match, describe pathways, short, neutral and plain); conflicting evidence handled by the best-match exception; Library "not covered" replies end plainly; Contributor prompt kept unchanged. |
| 2 | Word caps (Analyse about 120 words, bullets included, at most three one-sentence bullets; requested comparisons about 180; Library about 100). Never write "corpus" even though the instructions use it. No second pathway as supporting evidence; never announce how many match. When nothing matches, don't describe the library's other contents. "Common patterns" only from lessons the search marks as seen in 2+ pathways. |
| 3 | Every point must come from the one best pathway. Describe pathways in everyday words, not their technical description. Nothing after the bullets except one closing sentence. The Library overview's search instructions now say "take every point from it". |
| 4 | Explain technical terms and acronyms (ASR, SDK, 8 kHz…) in everyday words. Don't repeat a judgemental word even when the user used it. "If you'd have to call it a stretch, don't mention it." |

### Scores (out of 10 questions)

| | Rule 1: best match | Rule 2: describes pathways | Rule 3: concise | Rule 4: neutral, plain | Fully / partly / fails expectation | Median words | Answers with insider jargon | Answers with banned words | Answers with an unrequested second pathway |
|---|---|---|---|---|---|---|---|---|---|
| Old prompts (average of 4 runs) | 5.2 | 5.5 | 4.5 | 2.0 | 0.2 / 7.5 / 2.2 | 256 | 4.5 | 0.8 | 3.0 |
| New, round 1 | 5 | 5 | 6 | 6 | 2 / 8 / 0 | 233 | 3 | 1 | 2 |
| New, round 2 | 7 | 5 | 7 | 7 | 3 / 5 / 2 | 154 | 0 | 0 | 2 |
| New, round 3 | 7 | 6 | 8 | 5 | 3 / 6 / 1 | 135 | 1 | 1 | 0 |
| **New, round 4 (current)** | 5 | 5 | **9** | **9** | **5 / 5 / 0** | **130** | 1 | **0** | 2 |

Rule 2 counts exclude answers that named no pathway (the grader marks those n/a). "Unrequested second pathway" leaves out Q4 and Q5, where several pathways were allowed.

### What is fixed (stable across rounds)

- **No match:** the dental-clinic question gets a plain "nothing in the documented pathways covers this" in 57–107 words. The old prompts applied an agriculture pathway to dentistry in about 120–270 words.
- **Library "not covered":** "The library doesn't have anything on AI for courts or legal systems." That's 12 words, ending plainly, in rounds 1 and 4. Round 3 still mentioned a pathway it called "a stretch", which round 4's rule removed.
- **Judgement bait:** "Which flopped the worst?" is declined neutrally. Round 4 no longer echoes the word.
- **"corpus" and other insider labels** have been gone since round 2. Technical acronyms are explained since round 4.
- **Length:** median 130 words, against about 256 for the old prompts.
- **Contributor prompt:** byte-identical to HEAD in every round (checked by rendering both).

### What still misses

1. **A second pathway on voice-for-farmers questions (Q1, Q9)** appears in about half the runs: round 3 had none, round 4 had two. The library has several heavily overlapping voice-agriculture pathways (MahaVISTAAR, Bhili, African Voice AI, Voice AI for Inclusion, Sarla Ben), and the model tends to pull a point from each. In Q9 round 4 the second pathway reported a finding that runs *against* the first, which the best-match exception allows, but it used a paragraph instead of one clause.
2. **Library answers run about 200–240 words** against the 100-word cap (Q9, Q10). Analyse answers mostly stay near their caps. A hard ceiling would need a code change (a lower `max_tokens` for library mode, or trimming), not more prompt wording.
3. **"Common patterns" (Q4) is inconsistent.** For this question the search returns three lessons, each seen in only one pathway. Round 2 said so correctly; rounds 3–4 still lean on one pathway in places.

### Grader errors to discount

- Q4 round 2 was marked "partial" although the answer was correct. The search showed no lesson in 2+ pathways.
- Q8 round 2 called "public health" invented, but the CEEW pathway's sector is "Climate / Public Health".
- Q5 was marked down for not describing pathways the user had named themselves.
- The automatic check flagged "got it wrong" in one Q9 answer where it was a quoted farmer's view, not a judgement.

### Limits

- One answer per question per round, at default temperature. Differences of one question between rounds are within noise (the old prompts' own scores moved by similar amounts between runs).
- First turn of a conversation only, with no earlier messages or uploaded documents.
- Grades come from a model and are strict in places (see above).
