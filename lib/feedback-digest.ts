// The Feedback Digest (docs/features/feedback-digest/, FD-03): building the
// model's input, the output schema, checking what the model returns, and
// the view the admin page shows. Pure: no React, no server imports.
//
// Adapted from the Cube 2.0 contributor digest (lib/companion-v2/digest.ts
// in that fork) to this app's data: conversations from Explore, Analyse and
// Contribute, and 👍/👎 votes, instead of playbooks, jobs and gaps.
//
// Code, never the model, decides: which items survive (every cited
// reference must be real and of the right kind), how many conversations and
// people stand behind an item, its areas, dates and pathways, the source
// tags of an unanswered question, the ranking of topics, and what remains
// after conversations are deleted. People are run-local labels (U1, U2): no
// user id, name or email is ever sent, stored or shown.

import { cap, dropCutWord, oneLine, scrubContact } from '@/lib/digest-text';

export const DIGEST_PERIODS = [7, 30] as const;
export type DigestPeriod = (typeof DIGEST_PERIODS)[number];
export const toPeriod = (v: unknown): DigestPeriod => (String(v) === '30' ? 30 : 7);

/** Below this many people, the banner says patterns can't be seen yet. */
export const FEW_USERS = 3;

export type Area = 'explore' | 'analyse' | 'contribute';
const AREAS: readonly Area[] = ['explore', 'analyse', 'contribute'];
const asArea = (v: unknown): Area => (AREAS.includes(v as Area) ? (v as Area) : 'analyse');

// What the digest keeps of each text, and what migration 0045 cuts it to
// first (a little longer, so a word split by that cut is dropped after
// scrubbing, not left half-scrubbed). The reply is long enough to show an
// admission of "not covered" that comes after a short introduction.
const QUESTION_CHARS = 300;
const REPLY_CHARS = 300;
const EXCERPT_CHARS = 200;
const SQL_QUESTION_CHARS = 400;
const SQL_REPLY_CHARS = 400;
const SQL_EXCERPT_CHARS = 300;

// ---------------------------------------------------------------------------
// Shapes from migration 0045's functions
// ---------------------------------------------------------------------------

export interface DigestStats {
  users_period: number;
  conversations_period: number;
  pathways: { slug: string; title: string; conversations: number }[];
  live_keys: string[];
  new_since: number;
}

export interface RawDigestInput {
  messages_total: number;
  messages: {
    key: string;
    area: string;
    person: number;
    at: string;
    question: string;
    reply: string | null;
    pathways: unknown;
  }[];
  feedback: {
    key: string;
    area: string;
    person: number;
    at: string;
    pathway_slug: string | null;
    excerpt: string;
  }[];
}

// ---------------------------------------------------------------------------
// The stored payload
// ---------------------------------------------------------------------------

/** One conversation (or vote) behind an item, with its run-local person. */
export interface KeyRef {
  k: string;
  p: string;
}

export type UnansweredSource = 'not_covered' | 'not_helpful';

export interface Topic { title: string; summary: string; areas: Area[]; pathways: string[]; keys: KeyRef[] }
export interface Unanswered { question: string; sources: UnansweredSource[]; areas: Area[]; dates: string[]; keys: KeyRef[] }
export interface Term { term: string; observation: string; keys: KeyRef[] }

export const SECTIONS = ['topics', 'unanswered', 'terms'] as const;
export type Section = (typeof SECTIONS)[number];

export interface SummaryBullet {
  text: string;
  refs: { section: Section; index: number }[];
}

export interface DigestPayload {
  version: 1;
  period_days: DigestPeriod;
  basis: { messages_used: number; messages_total: number; feedback_used: number; keys: KeyRef[] };
  summary: SummaryBullet[];
  topics: Topic[];
  unanswered: Unanswered[];
  terms: Term[];
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

interface RefInfo extends KeyRef {
  area: Area;
  date: string;
  pathways: string[];
  /** The start of Cube's reply as sent to the model ('' for a vote or no reply). */
  reply: string;
}

/** What each reference in the input stands for. Kept in memory for one run. */
export interface RefMaps {
  M: Map<string, RefInfo>;
  F: Map<string, RefInfo>;
}

/** YYYY-MM-DD in India time. */
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayOf = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : DAY.format(d);
};

/** Scrubs, flattens and trims a text from the database (already cut to `sqlCut`). */
const clip = (text: unknown, max: number, sqlCut: number) =>
  cap(oneLine(scrubContact(dropCutWord(typeof text === 'string' ? text : '', sqlCut))), max);

/**
 * Cube's reply says, in plain words, that nothing covers the question (the
 * absence wording of lib/system-prompts.ts: "doesn't have a pathway", "not in
 * here", "couldn't find"…). A cheap check on the reply the model was shown,
 * so the "Cube said not covered" tag never rests on the model's word alone.
 */
const NOT_COVERED =
  /\b(?:no pathway|no (?:documented|information|match)|(?:doesn'?t|does not|don'?t|do not|didn'?t|did not|isn'?t|is not|aren'?t|are not|not)\s+(?:directly\s+)?(?:have|cover(?:ed)?|include[sd]?|document(?:ed)?|address(?:ed)?|mention(?:ed)?|in here|in the (?:library|pathways?))|(?:couldn'?t|could not|can'?t|cannot|unable to)\s+find|nothing (?:on|about|in)|not (?:yet )?(?:in|available))\b/i;

const slugList = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 200))] : [];

export interface BuiltInput {
  text: string;
  refs: RefMaps;
  people: number;
  basis: DigestPayload['basis'];
}

export function buildDigestInput(raw: RawDigestInput, period: DigestPeriod, now = new Date()): BuiltInput {
  // Relabel people U1, U2… in order of first appearance, for this run only.
  const label = new Map<number, string>();
  const personOf = (n: unknown) => {
    const key = Number(n);
    if (!label.has(key)) label.set(key, `U${label.size + 1}`);
    return label.get(key)!;
  };

  const refs: RefMaps = { M: new Map(), F: new Map() };
  const keys = new Map<string, string>();

  const messageLines: string[] = [];
  for (const m of raw.messages ?? []) {
    const question = clip(m.question, QUESTION_CHARS, SQL_QUESTION_CHARS);
    if (!question || typeof m.key !== 'string') continue;
    const ref = `M${refs.M.size + 1}`;
    const p = personOf(m.person);
    const area = asArea(m.area);
    const date = dayOf(m.at);
    keys.set(m.key, p);
    const reply = m.reply ? clip(m.reply, REPLY_CHARS, SQL_REPLY_CHARS) : '';
    refs.M.set(ref, { k: m.key, p, area, date, pathways: slugList(m.pathways), reply });
    messageLines.push(`${ref} | ${p} | ${date} | ${area} | ${question} | ${reply || '-'}`);
  }

  const feedbackLines: string[] = [];
  for (const f of raw.feedback ?? []) {
    if (typeof f.key !== 'string') continue;
    const ref = `F${refs.F.size + 1}`;
    const p = personOf(f.person);
    const area = asArea(f.area);
    const date = dayOf(f.at);
    refs.F.set(ref, { k: f.key, p, area, date, pathways: slugList(f.pathway_slug ? [f.pathway_slug] : []), reply: '' });
    keys.set(f.key, p);
    feedbackLines.push(`${ref} | ${p} | ${date} | ${area} | ${clip(f.excerpt, EXCERPT_CHARS, SQL_EXCERPT_CHARS) || '-'}`);
  }

  const from = dayOf(new Date(now.getTime() - period * 86_400_000).toISOString());
  const total = Number(raw.messages_total) || 0;
  const capped = total > messageLines.length;
  const text = [
    `Period: the last ${period} days (${from} to ${dayOf(now.toISOString())}).`,
    `People in this period: ${label.size}. Questions: ${messageLines.length}${capped ? ` (the most recent ${messageLines.length} of ${total})` : ''}. Replies marked not helpful: ${feedbackLines.length}.`,
    '',
    '<questions>',
    "ref | person | date | area | the person's own message | the start of Cube's reply",
    ...messageLines,
    '</questions>',
    '',
    '<not_helpful>',
    'ref | person | date | area | the start of the reply the person marked not helpful',
    ...feedbackLines,
    '</not_helpful>',
    '',
    'Write the digest with the record_digest tool.',
  ].join('\n');

  return {
    text,
    refs,
    people: label.size,
    basis: {
      messages_used: messageLines.length,
      messages_total: total,
      feedback_used: feedbackLines.length,
      keys: [...keys].map(([k, p]) => ({ k, p })),
    },
  };
}

// ---------------------------------------------------------------------------
// Output schema (forced tool use). Summary is the last property, written last.
// ---------------------------------------------------------------------------

const refList = (prefix: 'M' | 'F', what: string) => ({
  type: 'array',
  items: { type: 'string', pattern: `^${prefix}[0-9]+$` },
  description: what,
});

const LIMITS: Record<Section, number> = { topics: 10, unanswered: 12, terms: 8 };

export const DIGEST_TOOL = {
  name: 'record_digest',
  description: 'Record the digest. Every item must cite the references it rests on.',
  input_schema: {
    type: 'object' as const,
    properties: {
      topics: {
        type: 'array',
        maxItems: LIMITS.topics,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            summary: { type: 'string' },
            evidence: refList('M', 'Question refs (M…) this topic rests on'),
          },
          required: ['title', 'summary', 'evidence'],
        },
      },
      unanswered: {
        type: 'array',
        maxItems: LIMITS.unanswered,
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            evidence: refList('M', "Question refs (M…) whose reply says no pathway covers it or Cube couldn't answer"),
            votes: refList('F', 'Not-helpful refs (F…) grouped here'),
          },
          required: ['question', 'evidence', 'votes'],
        },
      },
      terms: {
        type: 'array',
        maxItems: LIMITS.terms,
        items: {
          type: 'object',
          properties: { term: { type: 'string' }, observation: { type: 'string' }, evidence: refList('M', 'Question refs (M…)') },
          required: ['term', 'observation', 'evidence'],
        },
      },
      summary: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'One or two short sentences, at most 250 characters' },
            refs: {
              type: 'array',
              items: { type: 'string' },
              description: 'Items above this bullet rests on, e.g. "topics[0]", "unanswered[2]"',
            },
          },
          required: ['text', 'refs'],
        },
      },
    },
    required: ['topics', 'unanswered', 'terms', 'summary'],
  },
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * Model text as stored: contact details removed, the labels this run issued
 * (U3, M12, F2) removed, one line, capped. Other words that look like a label
 * ("F1 race", "M4 motorway") are real text and stay.
 */
function clean(v: unknown, max: number, issued: ReadonlySet<string>): string {
  if (typeof v !== 'string') return '';
  const s = scrubContact(v)
    .replace(/\b[UMF]\d+\b/g, (m) => (issued.has(m) ? ' ' : m))
    .replace(/\(\s*(?:[,;/&]|and|\s)*\)|\[\s*(?:[,;/&]|and|\s)*\]/g, ' ')
    .replace(/\s+([,.;:?!)\]])/g, '$1')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1');
  return cap(oneLine(s), max).replace(/‹/g, '<').replace(/^[\s,;:.-]+/, '');
}

/**
 * Resolves every reference, or returns null if any doesn't resolve (an item
 * that cites something that isn't there is dropped whole).
 */
function resolve(v: unknown, map: Map<string, RefInfo>): RefInfo[] | null {
  const out: RefInfo[] = [];
  for (const r of arr(v)) {
    const hit = typeof r === 'string' ? map.get(r.trim()) : undefined;
    if (!hit) return null;
    out.push(hit);
  }
  return out;
}

/** Distinct keys, each with its person. */
const toKeys = (refs: KeyRef[]): KeyRef[] => {
  const seen = new Map<string, string>();
  for (const r of refs) if (!seen.has(r.k)) seen.set(r.k, r.p);
  return [...seen].map(([k, p]) => ({ k, p }));
};

const areasOf = (refs: RefInfo[]): Area[] => AREAS.filter((a) => refs.some((r) => r.area === a));
const datesOf = (refs: RefInfo[]): string[] => [...new Set(refs.map((r) => r.date).filter(Boolean))].sort();
const conversations = (keys: KeyRef[]) => new Set(keys.map((r) => r.k)).size;
const people = (keys: KeyRef[]) => new Set(keys.map((r) => r.p)).size;

/** The pathways most of the cited questions drew on, most frequent first (max 3). */
function pathwaysOf(refs: RefInfo[]): string[] {
  const count = new Map<string, number>();
  for (const r of refs) for (const s of r.pathways) count.set(s, (count.get(s) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([s]) => s);
}

/**
 * Turns the model's tool input into the stored payload. Items that cite
 * anything that doesn't exist are dropped; counts, areas, dates, pathways,
 * source tags and the topic ranking are derived here, never taken from the
 * model.
 */
export function validateDigest(
  raw: unknown,
  refs: RefMaps,
  ctx: { period: DigestPeriod; basis: DigestPayload['basis'] }
): DigestPayload {
  const r = obj(raw) ?? {};

  // Labels this run issued, so only those are stripped from the model's text.
  const issued = new Set<string>([...refs.M.keys(), ...refs.F.keys()]);
  for (const info of [...refs.M.values(), ...refs.F.values()]) issued.add(info.p);

  // Topics, ranked by conversations then people. Remember where each of the
  // model's indexes ended up so summary refs still point at the right item.
  const topicByModelIndex = new Map<number, Topic>();
  const topicList: Topic[] = [];
  arr(r.topics).forEach((v, i) => {
    const t = obj(v);
    const ev = t && resolve(t.evidence, refs.M);
    const title = clean(t?.title, 100, issued);
    const summary = clean(t?.summary, 400, issued);
    if (!t || !ev?.length || !title || !summary || topicList.length >= LIMITS.topics) return;
    const topic: Topic = { title, summary, areas: areasOf(ev), pathways: pathwaysOf(ev), keys: toKeys(ev) };
    topicList.push(topic);
    topicByModelIndex.set(i, topic);
  });
  const topics = [...topicList].sort(
    (a, b) => conversations(b.keys) - conversations(a.keys) || people(b.keys) - people(a.keys)
  );

  const kept: Record<Section, Map<number, number>> = { topics: new Map(), unanswered: new Map(), terms: new Map() };
  for (const [i, topic] of topicByModelIndex) kept.topics.set(i, topics.indexOf(topic));

  const unanswered: Unanswered[] = [];
  arr(r.unanswered).forEach((v, i) => {
    const u = obj(v);
    const cited = u && resolve(u.evidence, refs.M);
    const votes = u && resolve(u.votes, refs.F);
    const question = clean(u?.question, 200, issued);
    if (!u || !cited || !votes || !question || unanswered.length >= LIMITS.unanswered) return;
    // Only replies that say so plainly count as "Cube said not covered".
    const ev = cited.filter((c) => NOT_COVERED.test(c.reply));
    const all = [...ev, ...votes];
    if (!all.length) return;
    const sources: UnansweredSource[] = [];
    if (ev.length) sources.push('not_covered');
    if (votes.length) sources.push('not_helpful');
    kept.unanswered.set(i, unanswered.length);
    unanswered.push({ question, sources, areas: areasOf(all), dates: datesOf(all), keys: toKeys(all) });
  });

  const terms: Term[] = [];
  arr(r.terms).forEach((v, i) => {
    const t = obj(v);
    const ev = t && resolve(t.evidence, refs.M);
    const term = clean(t?.term, 60, issued);
    const observation = clean(t?.observation, 400, issued);
    if (!t || !ev?.length || !term || !observation || terms.length >= LIMITS.terms) return;
    kept.terms.set(i, terms.length);
    terms.push({ term, observation, keys: toKeys(ev) });
  });

  // Summary: every ref must point at an item that survived.
  const REF = /^(topics|unanswered|terms)\[(\d+)\]$/;
  const summary: SummaryBullet[] = [];
  for (const v of arr(r.summary)) {
    if (summary.length === 3) break;
    const b = obj(v);
    const text = clean(b?.text, 300, issued);
    const list = arr(b?.refs);
    if (!b || !text || !list.length) continue;
    const out: SummaryBullet['refs'] = [];
    let ok = true;
    for (const ref of list) {
      const m = typeof ref === 'string' ? ref.trim().match(REF) : null;
      const index = m ? kept[m[1] as Section].get(Number(m[2])) : undefined;
      if (!m || index === undefined) {
        ok = false;
        break;
      }
      if (!out.some((o) => o.section === m[1] && o.index === index)) out.push({ section: m[1] as Section, index });
    }
    if (ok && out.length) summary.push({ text, refs: out });
  }

  return { version: 1, period_days: ctx.period, basis: ctx.basis, summary, topics, unanswered, terms };
}

export function emptyDigest(period: DigestPeriod, basis: DigestPayload['basis']): DigestPayload {
  return { version: 1, period_days: period, basis, summary: [], topics: [], unanswered: [], terms: [] };
}

// ---------------------------------------------------------------------------
// The view: a stored digest against the conversations and votes that still
// exist
// ---------------------------------------------------------------------------

export interface ViewItem<T> {
  item: T;
  conversations: number;
  people: number;
}

export interface DigestView {
  basis: { people: number; conversations: number; messagesUsed: number; messagesTotal: number; empty: boolean };
  summary: { text: string; people: number }[];
  topics: ViewItem<Topic>[];
  unanswered: ViewItem<Unanswered>[];
  terms: ViewItem<Term>[];
}

/** Keys of a stored item; tolerates a malformed payload. */
const keysOf = (item: unknown): KeyRef[] =>
  arr(obj(item)?.keys).filter(
    (c): c is KeyRef => !!c && typeof (c as KeyRef).k === 'string' && typeof (c as KeyRef).p === 'string'
  );

const strings = (v: unknown) => arr(v).filter((s): s is string => typeof s === 'string');

/** Text fields a section's items must have, so a malformed stored item is skipped rather than crashing the page. */
const REQUIRED: Record<Section, string[]> = {
  topics: ['title', 'summary'],
  unanswered: ['question'],
  terms: ['term', 'observation'],
};

const isConversation = (k: string) => k.startsWith('d:') || k.startsWith('l:');

/**
 * Drops conversations and votes that no longer exist (deleted by the person,
 * by account deletion, or a withdrawn vote), recounts people from what
 * remains, and hides any item or summary bullet left with nothing. Topics
 * are re-ranked on what remains.
 */
export function viewDigest(payload: unknown, live: Set<string>): DigestView {
  const p = obj(payload) ?? {};

  const sectionView = <T,>(section: Section): (ViewItem<T> | null)[] =>
    arr(p[section]).map((raw) => {
      const item = obj(raw);
      if (!item || !REQUIRED[section].every((k) => typeof item[k] === 'string')) return null;
      const keys = keysOf(item).filter((c) => live.has(c.k));
      if (!keys.length) return null;
      const normalised = {
        ...item,
        areas: strings(item.areas),
        pathways: strings(item.pathways),
        dates: strings(item.dates),
        sources: strings(item.sources),
        keys,
      } as unknown as T;
      return { item: normalised, conversations: conversations(keys), people: people(keys) };
    });

  // Positions are kept until the summary is resolved, so refs still line up.
  const all: Record<Section, (ViewItem<unknown> | null)[]> = {
    topics: sectionView<Topic>('topics'),
    unanswered: sectionView<Unanswered>('unanswered'),
    terms: sectionView<Term>('terms'),
  };

  const summary: DigestView['summary'] = [];
  for (const raw of arr(p.summary)) {
    const b = obj(raw);
    if (!b || typeof b.text !== 'string') continue;
    const cited = arr(b.refs).map((r) => {
      const ref = obj(r);
      return ref && SECTIONS.includes(ref.section as Section) && typeof ref.index === 'number'
        ? (all[ref.section as Section][ref.index] ?? null)
        : null;
    });
    // A bullet is shown only while every item it rests on is still shown.
    if (!cited.length || cited.some((c) => !c)) continue;
    const keys = new Map<string, string>();
    for (const c of cited) for (const k of keysOf(c!.item)) keys.set(k.k, k.p);
    summary.push({ text: b.text, people: new Set(keys.values()).size });
  }

  const present = <T,>(xs: (ViewItem<unknown> | null)[]) => xs.filter((x): x is ViewItem<T> => x !== null);
  const basisKeys = keysOf(p.basis).filter((c) => live.has(c.k));
  const basis = obj(p.basis);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    basis: {
      people: people(basisKeys),
      conversations: new Set(basisKeys.filter((c) => isConversation(c.k)).map((c) => c.k)).size,
      messagesUsed: num(basis?.messages_used),
      messagesTotal: num(basis?.messages_total),
      empty: num(basis?.messages_used) === 0 && num(basis?.feedback_used) === 0,
    },
    summary,
    topics: present<Topic>(all.topics).sort((a, b) => b.conversations - a.conversations || b.people - a.people),
    unanswered: present<Unanswered>(all.unanswered),
    terms: present<Term>(all.terms),
  };
}
