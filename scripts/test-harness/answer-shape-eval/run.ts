/*
 * Live check of how Claude actually answers under the adopter-facing prompts
 * (the answer-shape rules: single best match, describe pathways, short,
 * neutral and plain — ./answer-shape-feedback/). Runs the
 * test set in ./cases.ts through the app's real retrieval and
 * prompt builders, with the same model and max_tokens as /api/chat, then
 * grades each answer with automatic checks plus a separate model call.
 *
 *   npm run eval:answers -- [--baseline <git-ref>] [--only Q1,Q8] [--out file.json] [--judge-model <id>]
 *
 * --baseline also answers every question with that commit's
 * lib/system-prompts.ts + lib/explorer-intents.ts, from the same retrieval
 * results, so the two can be compared side by side.
 *
 * NOT part of `npm test`: it makes live, paid model calls (about 2 per
 * question, doubled with --baseline) and its results vary run to run. It
 * reads from Supabase (published pathways, hybrid search, toolkit assets)
 * and writes nothing there — ai_usage and sys_errors logging is swapped for
 * console stubs by ./vite-node.config.mts. Results are written as JSON to
 * scripts/test-harness/answer-shape-eval/results/ (gitignored) unless --out is given.
 *
 * Reads .env.local or .env (or the environment): ANTHROPIC_API_KEY (with
 * access to claude-sonnet-4-6, claude-haiku-5-5 and the judge model),
 * NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import Anthropic from '@anthropic-ai/sdk';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BANNED_WORDS, CASES, INSIDER_TERMS, MULTI_PATHWAY_ALLOWED, PATHWAY_ALIASES, type EvalCase } from './cases';

for (const file of ['.env.local', '.env']) if (existsSync(file)) process.loadEnvFile(file);

// The same model and per-mode max_tokens as app/api/chat/route.ts.
const ANSWER_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = { companion: 8192, library: 1024 } as const;
// The default judge doesn't accept a forced tool_choice; Sonnet does, and is
// the fallback when the judge answers in prose.
const FALLBACK_JUDGE = 'claude-sonnet-4-6';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const baselineRef = arg('--baseline');
const only = arg('--only')?.split(',').map((s) => s.trim().toUpperCase());
const judgeModel = arg('--judge-model') ?? 'claude-opus-5-5';
const resultsDir = path.join('scripts', 'test-harness', 'answer-shape-eval', 'results');
const outFile = arg('--out') ?? path.join(resultsDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

// --baseline: that commit's prompt builders, written next to this script and
// removed again when the run ends. Its system-prompts.ts imports the
// baseline explorer-intents.ts instead of the current one.
const baselineDir = path.join('scripts', 'test-harness', 'answer-shape-eval', '.baseline');
function writeBaseline(ref: string): string {
  mkdirSync(baselineDir, { recursive: true });
  const show = (file: string) => execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf-8' });
  writeFileSync(path.join(baselineDir, 'explorer-intents.ts'), show('lib/explorer-intents.ts'));
  writeFileSync(
    path.join(baselineDir, 'system-prompts.ts'),
    show('lib/system-prompts.ts').replaceAll("'@/lib/explorer-intents'", "'./explorer-intents'")
  );
  return path.resolve(baselineDir, 'system-prompts.ts');
}

type Prompts = typeof import('@/lib/system-prompts');

const { buildGrounding, pathwayPassages } = await import('@/lib/retrieval');
const { buildOverview, getPublishedDocument, adopterDocument, listPublished } = await import('@/lib/pathway-store');
const { loadFrameworkContent, loadResourcesContent, datedLine } = await import('@/lib/wiki-loader');
const { loadPublishedToolkitAssets } = await import('@/lib/toolkit-assets-server');
const { systemForMode, messagesForMode } = await import('@/lib/prompt-cache');
const { stripGridUpdate } = await import('@/lib/grid-update');
const { EMPTY_GRID } = await import('@/lib/dimensions');
const { TOOLKIT_ASSETS_TAG_START } = await import('@/lib/toolkit-assets');
const current: Prompts = await import('@/lib/system-prompts');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface Checks {
  words: number;
  pathwaysNamed: string[];
  banned: string | null;
  insiderTerm: string | null;
  endsWithQuestion: boolean;
}

function checks(answer: string, openSlug?: string): Checks {
  return {
    words: answer.split(/\s+/).filter(Boolean).length,
    pathwaysNamed: Object.entries(PATHWAY_ALIASES)
      .filter(([slug, re]) => slug !== openSlug && re.test(answer))
      .map(([slug]) => slug),
    banned: answer.match(BANNED_WORDS)?.[0] ?? null,
    insiderTerm: answer.match(INSIDER_TERMS)?.[0] ?? null,
    endsWithQuestion: /\?["')*\s]*$/.test(answer.trim()),
  };
}

interface Grade {
  best_match: 'pass' | 'fail' | 'n/a';
  pathway_context: 'pass' | 'fail' | 'n/a';
  concise: 'pass' | 'fail';
  neutral_plain: 'pass' | 'fail';
  meets_expectation: 'pass' | 'partial' | 'fail';
  notes: string;
  gradedBy: string;
}

const GRADE_TOOL: Anthropic.Tool = {
  name: 'grade',
  description: 'Grade one assistant answer against the adopter-feedback rules.',
  input_schema: {
    type: 'object',
    properties: {
      best_match: { type: 'string', enum: ['pass', 'fail', 'n/a'], description: 'Rule 1: single best match, or plainly says no direct match; no force-fitting; several pathways only when the user asked to compare / what is common. n/a only if no pathway question arises.' },
      pathway_context: { type: 'string', enum: ['pass', 'fail', 'n/a'], description: 'Rule 2: every pathway named is described in a few plain words (what/for whom/where) on first mention. n/a if no pathway is named.' },
      concise: { type: 'string', enum: ['pass', 'fail'], description: 'Rule 3: short and to the point, opens with the answer, no preamble/padding.' },
      neutral_plain: { type: 'string', enum: ['pass', 'fail'], description: 'Rule 4: non-judgemental wording (no "flopped" etc.) and no jargon a lay user would not understand.' },
      meets_expectation: { type: 'string', enum: ['pass', 'partial', 'fail'], description: 'Overall vs the case-specific expectation.' },
      notes: { type: 'string', description: 'One or two sentences: the most important strength or problem.' },
    },
    required: ['best_match', 'pathway_context', 'concise', 'neutral_plain', 'meets_expectation', 'notes'],
  },
};

function gradePrompt(c: EvalCase, answer: string, library: string): string {
  return `You are grading a chatbot answer for 100 Pathways, an app that answers AI-adoption questions from a library of documented deployment "pathways". Grade strictly against these four rules from user feedback:
1. Don't overfit or force-fit. If there is no direct match, say so; if relevant, give only the single best match. More than one pathway is fine only when the user asked to compare or asked what is common.
2. Don't assume the user knows pathway names — give a few words of context for each pathway named.
3. Short and to the point.
4. Non-judgemental language (never words like "flopped") and no jargon a lay user wouldn't understand.

Published pathways in the library:
${library}

Case ${c.id} (${c.category}). Surface: ${c.surface}${c.slug ? ` (pathway open: ${c.slug})` : ''}.
User question: ${c.question}
Expected behaviour: ${c.expect}

Answer to grade:
<answer>
${answer}
</answer>`;
}

function gradeFrom(message: Anthropic.Message, gradedBy: string): Grade | null {
  const block = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  return block ? { ...(block.input as Omit<Grade, 'gradedBy'>), gradedBy } : null;
}

async function grade(c: EvalCase, answer: string, library: string): Promise<Grade | null> {
  const prompt = gradePrompt(c, answer, library);
  const first = await anthropic.messages.create({
    model: judgeModel,
    max_tokens: 4000,
    tools: [GRADE_TOOL],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: `${prompt}\n\nRecord your grade by calling the \`grade\` tool exactly once.` }],
  });
  const graded = gradeFrom(first, judgeModel);
  if (graded) return graded;
  const fallback = await anthropic.messages.create({
    model: FALLBACK_JUDGE,
    max_tokens: 1000,
    tools: [GRADE_TOOL],
    tool_choice: { type: 'tool', name: 'grade' },
    messages: [{ role: 'user', content: prompt }],
  });
  return gradeFrom(fallback, `${FALLBACK_JUDGE} (fallback)`);
}

async function answer(system: string, mode: keyof typeof MAX_TOKENS, question: string): Promise<string> {
  const res = await anthropic.messages.create({
    model: ANSWER_MODEL,
    max_tokens: MAX_TOKENS[mode],
    system: systemForMode(mode === 'companion' ? 'companion' : 'library', system),
    messages: messagesForMode(mode === 'companion' ? 'companion' : 'library', [{ role: 'user', content: question }]),
  });
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  // What the user sees: no <grid_update> block, no toolkit-assets id tag.
  if (mode === 'companion') return stripGridUpdate(text).trim();
  const tag = text.indexOf(TOOLKIT_ASSETS_TAG_START);
  return (tag >= 0 ? text.slice(0, tag) : text).trim();
}

async function main() {
  const baseline: Prompts | null = baselineRef ? await import(/* @vite-ignore */ writeBaseline(baselineRef)) : null;
  const variants: [string, Prompts][] = [['current', current], ...(baseline ? [[`baseline ${baselineRef}`, baseline] as [string, Prompts]] : [])];

  const [framework, resources, toolkitAll, published] = await Promise.all([
    loadFrameworkContent(),
    loadResourcesContent(),
    loadPublishedToolkitAssets(),
    listPublished(),
  ]);
  const library = published.map((p) => `${p.slug}: ${p.title}`).join('\n');
  const cases = only ? CASES.filter((c) => only.includes(c.id)) : CASES;
  console.log(`${published.length} published pathways · ${cases.length} questions · variants: ${variants.map(([n]) => n).join(', ')} · judge ${judgeModel}`);

  async function runCase(c: EvalCase) {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: c.question }];
    // Grounding is retrieved once per question and shared by every variant.
    let mode: keyof typeof MAX_TOKENS;
    let build: (p: Prompts) => string;
    let grounded: { kind: string; slugs: string[] };
    if (c.surface === 'analyse') {
      const g = await buildGrounding({ surface: 'analyse', messages, sector: null, flow: 'explorer' });
      grounded = { kind: g.kind, slugs: g.slugs };
      const meta = { flow: 'explorer' } as Parameters<Prompts['explorerSystemPrompt']>[3];
      build = (p) => p.explorerSystemPrompt(g.text, framework, EMPTY_GRID, meta, resources, toolkitAll);
      mode = 'companion';
    } else if (c.surface === 'library-overview') {
      const [{ overview, count }, g] = await Promise.all([
        buildOverview(),
        buildGrounding({ surface: 'explore-overview', messages, flow: 'explore' }),
      ]);
      grounded = { kind: g.kind, slugs: g.slugs };
      build = (p) => p.libraryOverviewSystemPrompt(overview, count, g.text);
      mode = 'library';
    } else {
      const doc = await getPublishedDocument(c.slug!);
      if (!doc) throw new Error(`${c.slug} is not published`);
      const document = `${datedLine(doc.content, doc.created_at)}${adopterDocument(doc)}`;
      const [assets, passages] = await Promise.all([
        loadPublishedToolkitAssets({ pathwaySlug: c.slug }),
        pathwayPassages(c.slug!, c.question),
      ]);
      grounded = { kind: 'specific (pathway open)', slugs: [c.slug!] };
      build = (p) => p.libraryPathwaySystemPrompt(document, assets, passages);
      mode = 'library';
    }
    const results = await Promise.all(
      variants.map(async ([name, prompts]) => {
        const text = await answer(build(prompts), mode, c.question);
        return { variant: name, answer: text, checks: checks(text, c.slug), grade: await grade(c, text, library) };
      })
    );
    console.log(`${c.id} done — grounding ${grounded.kind} [${grounded.slugs.join(', ')}]`);
    return { ...c, grounded, results };
  }

  const out = [];
  for (let i = 0; i < cases.length; i += 3) {
    const batch = await Promise.all(
      cases.slice(i, i + 3).map((c) =>
        runCase(c).catch((e: unknown) => ({ ...c, error: e instanceof Error ? e.message : String(e) }))
      )
    );
    out.push(...batch);
  }

  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify({ answerModel: ANSWER_MODEL, judgeModel, baseline: baselineRef ?? null, ranAt: new Date().toISOString(), cases: out }, null, 2));

  // Summary: one row per question and variant, then totals per variant.
  const short = { pass: 'P', fail: 'F', 'n/a': '-', partial: '~' } as const;
  console.log('\nQ    variant              words  extra-pw  banned  insider  R1 R2 R3 R4  expectation');
  for (const c of out) {
    if ('error' in c) {
      console.log(`${c.id.padEnd(4)} ERROR ${c.error}`);
      continue;
    }
    for (const r of c.results) {
      const g = r.grade;
      const extra = MULTI_PATHWAY_ALLOWED.has(c.id) ? 0 : Math.max(0, r.checks.pathwaysNamed.length - 1);
      const rules = g ? [g.best_match, g.pathway_context, g.concise, g.neutral_plain].map((v) => short[v]).join('  ') : '?  ?  ?  ?';
      console.log(`${c.id.padEnd(4)} ${r.variant.padEnd(20)} ${String(r.checks.words).padStart(5)}  ${String(extra).padStart(8)}  ${(r.checks.banned ?? '-').padEnd(6)}  ${(r.checks.insiderTerm ?? '-').padEnd(7)}  ${rules}  ${g?.meets_expectation ?? '?'}`);
    }
  }
  for (const [name] of variants) {
    const rows = out.flatMap((c) => ('results' in c ? c.results.filter((r) => r.variant === name).map((r) => ({ id: c.id, ...r })) : []));
    const count = (pred: (r: (typeof rows)[number]) => boolean) => rows.filter(pred).length;
    const words = rows.map((r) => r.checks.words).sort((a, b) => a - b);
    const median = words.length ? words[Math.floor((words.length - 1) / 2)] : 0;
    console.log(
      `\n${name}: meets expectation ${count((r) => r.grade?.meets_expectation === 'pass')} pass / ${count((r) => r.grade?.meets_expectation === 'partial')} partial / ${count((r) => r.grade?.meets_expectation === 'fail')} fail` +
        ` · median ${median} words · unrequested extra pathway in ${count((r) => !MULTI_PATHWAY_ALLOWED.has(r.id) && r.checks.pathwaysNamed.length > 1)}` +
        ` · banned words in ${count((r) => !!r.checks.banned)} · insider terms in ${count((r) => !!r.checks.insiderTerm)}`
    );
  }
  console.log(`\nwrote ${outFile}`);
}

try {
  await main();
} finally {
  if (existsSync(baselineDir)) rmSync(baselineDir, { recursive: true, force: true });
}
