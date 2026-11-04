import { DIMENSIONS, STAGES, UNIT_TYPES, type DimensionCode, type Stage, type UnitType } from '@/lib/dimensions';
import { stripProvenanceAppendix } from '@/lib/provenance';

// Turns a pathway document's Section 3 (micro-innovations) into validated
// unit records — the rows of pathway_units (docs/features/pathway-storage/,
// PS-03). Pure: no I/O.
//
// Units keep today's markdown shape (content/pathway-generation-prompt.md):
//
//   **3. Short title**
//   - **Dimension:** Institution
//   - **Sub-category:** B. Content Authority and Approval
//   - **Stage:** Pilot
//   - **Also relevant at:** Scale            (optional)
//   - **Type:** Failure and Fix
//   - ... type-specific fields ...
//   - **Condition — applies when:** ...
//   - **Condition — fails when:** ...
//
// Bullets may be bold or plain. A unit whose dimension, sub-category, stage
// or type is missing or not in the framework's vocabulary (lib/dimensions.ts)
// is skipped with a reason, never guessed — publish indexes the rest and
// tells the admin which were skipped.

export interface ParsedUnit {
  id: string; // <slug>-uNN
  unit_number: number;
  title: string;
  unit_type: UnitType;
  dimension: DimensionCode;
  sub_category: string; // <dimension>-<letter>, e.g. institution-B
  stage: Stage;
  also_relevant_at: Stage[];
  applies_when: string;
  fails_when: string;
  body: string;
  adopter_intents: string[];
  source_ids: string[];
}

export interface SkippedUnit {
  unit: number;
  title: string;
  reason: string;
}

export interface ParseResult {
  units: ParsedUnit[];
  skipped: SkippedUnit[];
}

const UNIT_HEADING = /^\*\*(\d+)\.\s+(.+?)\*\*\s*$/;

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_]+/g, ' ').replace(/[^a-z0-9 ,&-]/g, '').trim();
}

// "Condition — applies when" / "Condition - applies when" / "condition: applies when" → "condition applies when"
function normLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/[—–:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function unitId(slug: string, n: number): string {
  return `${slug}-u${String(n).padStart(2, '0')}`;
}

function resolveDimension(value: string): DimensionCode | null {
  const v = norm(value);
  return DIMENSIONS.find((d) => d.code === v || norm(d.name) === v)?.code ?? null;
}

// Accepts "B", "B. UX, Channel, and Integration", "UX, Channel, and
// Integration", "solution-B" — always within the unit's own dimension.
function resolveSubCategory(dimension: DimensionCode, value: string): string | null {
  const dim = DIMENSIONS.find((d) => d.code === dimension);
  if (!dim) return null;
  let v = value.trim();
  const prefixed = v.match(/^([a-z]+)\s*-\s*([a-z])$/i);
  if (prefixed) {
    if (prefixed[1].toLowerCase() !== dimension) return null;
    v = prefixed[2];
  }
  const lettered = v.match(/^([a-z])(?:[.)]\s*(.*))?$/i);
  const letter = lettered ? lettered[1].toUpperCase() : null;
  const name = lettered ? (lettered[2] ?? '') : v;
  const byLetter = letter ? dim.subCategories.find((s) => s.code === letter) : undefined;
  if (byLetter && (!name || norm(byLetter.name) === norm(name))) return `${dimension}-${byLetter.code}`;
  if (!letter) {
    const byName = dim.subCategories.find((s) => norm(s.name) === norm(name));
    if (byName) return `${dimension}-${byName.code}`;
  }
  return null;
}

function resolveStage(value: string): Stage | null {
  const v = norm(value);
  return STAGES.find((s) => s.toLowerCase() === v) ?? null;
}

function resolveStages(value: string): Stage[] {
  return value
    .split(/[,;/]|\band\b/)
    .map((s) => resolveStage(s))
    .filter((s): s is Stage => s !== null);
}

function resolveType(value: string): UnitType | null {
  const v = norm(value).replace(/\band\b/g, '&').replace(/&/g, 'and');
  return UNIT_TYPES.find((t) => norm(t).replace(/&/g, 'and') === v) ?? null;
}

// "- **Label:** value" or "- Label: value" → [label, value]
function bullet(line: string): [string, string] | null {
  // "**Label:**", "**Label**:" or "Label:"
  const m = line.match(/^\s*[-*]\s+(?:\*\*)?([^:*]+?)\s*(?::\s*\*\*|\*\*\s*:|:)\s*(.*)$/);
  if (!m) return null;
  return [normLabel(m[1]), m[2].trim()];
}

// Unit numbers named in a free-text cell: "Unit 3", "Units 1–8", "Units 2, 4".
function unitNumbersIn(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/units?\s+([\d\s,–—\-and]+)/gi)) {
    for (const part of m[1].split(/,|\band\b/)) {
      const range = part.match(/(\d+)\s*[–—-]\s*(\d+)/);
      if (range) {
        const [a, b] = [Number(range[1]), Number(range[2])];
        for (let n = Math.min(a, b); n <= Math.max(a, b) && n - Math.min(a, b) < 200; n++) out.add(n);
      } else {
        const n = part.match(/\d+/);
        if (n) out.add(Number(n[0]));
      }
    }
  }
  return out;
}

function sectionBody(markdown: string, numberRe: RegExp): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => /^##\s/.test(l) && numberRe.test(l));
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

// Section 6: *"question"* → Unit 2, Unit 3
function intentsByUnit(markdown: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const line of sectionBody(markdown, /section\s*6\b/i).split('\n')) {
    const q = line.match(/["“]([^"”]+)["”]/);
    const arrow = line.split(/→|->/)[1];
    if (!q || !arrow) continue;
    for (const n of unitNumbersIn(arrow)) out.set(n, [...(out.get(n) ?? []), q[1].trim()]);
  }
  return out;
}

// Source Trace appendix: | src-01 · file.pdf | Unit 1; Units 3–5 | ... |
// The id is the row's src-NN key when it has one (seeded pathways), else the
// file name as written.
function sourcesByUnit(markdown: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const idx = markdown.search(/source trace/i);
  if (idx < 0) return out;
  for (const line of markdown.slice(idx).split('\n')) {
    if (!line.trim().startsWith('|') || /^\|\s*-/.test(line.trim())) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 2 || /^source\s*file$/i.test(cells[0])) continue;
    const id = cells[0].match(/\bsrc-\d+\b/i)?.[0].toLowerCase() ?? cells[0];
    for (const n of unitNumbersIn(cells[1])) out.set(n, [...(out.get(n) ?? []), id]);
  }
  return out;
}

export function parseUnits(markdown: string, slug: string): ParseResult {
  const section3 = sectionBody(stripProvenanceAppendix(markdown), /section\s*3\b/i);
  const intents = intentsByUnit(markdown);
  const sources = sourcesByUnit(markdown);
  const result: ParseResult = { units: [], skipped: [] };
  if (!section3) return result;

  // Split Section 3 into unit blocks at each **N. Title** line.
  const blocks: { n: number; title: string; lines: string[] }[] = [];
  for (const line of section3.split('\n')) {
    const h = line.trim().match(UNIT_HEADING);
    if (h) blocks.push({ n: Number(h[1]), title: h[2].trim(), lines: [line.trim()] });
    else if (blocks.length && !/^###\s/.test(line) && line.trim() !== '---') blocks[blocks.length - 1].lines.push(line);
  }

  for (const block of blocks) {
    const fields = new Map<string, string>();
    for (const line of block.lines) {
      const b = bullet(line);
      if (b && !fields.has(b[0])) fields.set(b[0], b[1]);
    }
    const skip = (reason: string) => result.skipped.push({ unit: block.n, title: block.title, reason });

    const dimRaw = fields.get('dimension');
    if (!dimRaw) { skip('missing dimension'); continue; }
    const dimension = resolveDimension(dimRaw);
    if (!dimension) { skip(`unknown dimension "${dimRaw}"`); continue; }

    const subRaw = fields.get('sub category');
    if (!subRaw) { skip('missing sub-category'); continue; }
    const subCategory = resolveSubCategory(dimension, subRaw);
    if (!subCategory) { skip(`unknown sub-category "${subRaw}" for ${dimension}`); continue; }

    const stageRaw = fields.get('stage');
    if (!stageRaw) { skip('missing stage'); continue; }
    const stage = resolveStage(stageRaw);
    if (!stage) { skip(`unknown stage "${stageRaw}"`); continue; }

    const typeRaw = fields.get('type');
    if (!typeRaw) { skip('missing type'); continue; }
    const unitType = resolveType(typeRaw);
    if (!unitType) { skip(`unknown type "${typeRaw}"`); continue; }

    result.units.push({
      id: unitId(slug, block.n),
      unit_number: block.n,
      title: block.title,
      unit_type: unitType,
      dimension,
      sub_category: subCategory,
      stage,
      also_relevant_at: resolveStages(fields.get('also relevant at') ?? '').filter((s) => s !== stage),
      applies_when: fields.get('condition applies when') ?? '',
      fails_when: fields.get('condition fails when') ?? '',
      body: block.lines.join('\n').trim(),
      adopter_intents: intents.get(block.n) ?? [],
      source_ids: sources.get(block.n) ?? [],
    });
  }
  return result;
}
