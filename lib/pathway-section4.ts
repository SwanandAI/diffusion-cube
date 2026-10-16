// Section 4 ("Toolkits and playbooks") of a contributor's pathway document.
// Its rows are the reusable assets the contributor is asked to share (the
// asset card, see AssetShareState in lib/toolkit-assets.ts); once they share
// one, the app — never the model — turns that row's title into a link to it
// and fills its File cell (file name or link domain, linked the same way —
// WikiMarkdown renders that cell with a Download / Open button).
// Pure and browser-safe: used when a draft is saved or the card is confirmed
// (lib/adoption-conversation) and when the document is sent for review
// (applyToolkitAssetFiles in lib/toolkit-assets), so all of them build the
// table the same way.

// Same normalisation as assetMentionKey in lib/toolkit-assets.ts (kept
// local: that module imports this one).
function assetMentionKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export interface Section4Row {
  title: string;
  type: string;
  reuseCondition: string;
}

export interface Section4Link {
  // Matched against the row titles (sameResourceName); an asset no row
  // names gets a row of its own.
  name: string;
  // The app's download route for a file, or the contributor's own https link.
  href: string;
  // Where the title links, when not `href`: the download route's preview
  // (?preview=1) for a file the browser can show.
  titleHref?: string;
  // The <!-- asset-id --> marker admin publish reads (see
  // assetIdsInDocument in lib/toolkit-assets.ts).
  assetId?: string;
  reuseCondition?: string;
  // What the File column shows: the file name, or the link's domain.
  label?: string;
}

// The File column's header — WikiMarkdown looks for it to render that
// column's links as a file name plus a Download / Open button.
export const FILE_COLUMN = 'File';

export const NO_RESOURCES_LINE = 'No reusable resources documented.';

// Headings that end Section 4 — pathway documents number and word these
// inconsistently, so match on meaning, not heading level.
const SECTION_4 = /^#{1,6}\s*(?:section\s*)?4\b/i;
const AFTER_SECTION_4 = /^#{1,6}\s*(?:section\s*)?(?:[5-9]\b|problem|retrieval|source trace|provenance)/i;
const SOURCE_TRACE = /^#{1,6}\s*.*(?:source trace|provenance)/i;
const ASSET_ID_MARKER = /\s*<!--\s*asset-id:[^>]*-->/g;
const MD_LINK = /\[([^\]]+)\]\([^)]*\)/g;
const TABLE_SEPARATOR = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;
// A row of one of these types is never a reusable asset, however reusable
// the drafter made it sound.
const NOT_AN_ASSET_TYPE = /decision|failure|fix/i;
// The # cell of a row the app added for an asset no row named — dropped
// again once that asset is no longer shared.
const APP_ROW_NUMBER = '—';

const STOPWORDS = new Set(['a', 'an', 'and', 'or', 'the', 'of', 'for', 'to', 'in', 'on', 'with', 'by']);

function words(name: string): string[] {
  return assetMentionKey(name)
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
}

// Same resource named two ways: equal after normalising, or every word of
// one appears in the other ("Troubleshooting approach for printer failures"
// inside "Deployment checklist and troubleshooting approach for printer
// failures"). Deliberately strict — two different artifacts that share a few
// words stay separate.
export function sameResourceName(a: string, b: string): boolean {
  const ka = assetMentionKey(a);
  const kb = assetMentionKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const wa = words(a);
  const wb = words(b);
  if (wa.length === 0 || wb.length === 0) return false;
  const [short, long] = wa.length <= wb.length ? [wa, new Set(wb)] : [wb, new Set(wa)];
  return short.every((w) => long.has(w));
}

function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => c.trim());
}

// Table-cell safe: the document renderer splits rows on every "|".
function cell(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
}

// A cell's text without links, markers or emphasis.
function plain(text: string): string {
  return text.replace(MD_LINK, '$1').replace(ASSET_ID_MARKER, '').replace(/[*_`]/g, '').trim();
}

function rowLine(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

interface Region {
  start: number; // first line after the Section 4 heading
  end: number; // line index of the next section heading (exclusive)
}

function findSection4(lines: string[]): { heading: number; region: Region } | null {
  const heading = lines.findIndex((l) => SECTION_4.test(l.trim()));
  if (heading === -1) return null;
  let end = lines.findIndex((l, i) => i > heading && AFTER_SECTION_4.test(l.trim()));
  if (end === -1) end = lines.length;
  return { heading, region: { start: heading + 1, end } };
}

// Line index to insert before: back up over a "---" rule and blank lines
// sitting just above the heading, so content stays inside the section above.
function backOverRule(lines: string[], index: number): number {
  let i = index;
  while (i > 0 && (lines[i - 1].trim() === '' || lines[i - 1].trim() === '---')) i--;
  return i;
}

interface Table {
  start: number;
  end: number; // exclusive
  header: string[];
  rows: string[][];
}

function findTable(lines: string[], region: Region): Table | null {
  const start = lines.findIndex(
    (l, i) => i >= region.start && i < region.end - 1 && l.trim().startsWith('|') && TABLE_SEPARATOR.test(lines[i + 1].trim())
  );
  if (start === -1) return null;
  let end = start + 2;
  while (end < region.end && lines[end].trim().startsWith('|')) end++;
  return { start, end, header: splitRow(lines[start]), rows: lines.slice(start + 2, end).map(splitRow) };
}

interface Columns {
  // The unit-number column; an asset the app added (no Section 3 unit) has
  // APP_ROW_NUMBER there.
  num: number;
  title: number;
  type: number;
  reuse: number;
  // The File column — rebuilt from the shared assets every time.
  file: number;
}

function columns(header: string[]): Columns {
  const lower = header.map((h) => plain(h).toLowerCase());
  const num = lower.findIndex((h) => h === '#' || /^(unit|no\.?)$/.test(h));
  let title = lower.findIndex((h) => /title|toolkit|resource|asset|name|playbook/.test(h));
  if (title === -1) title = num === 0 ? 1 : 0;
  return {
    num,
    title,
    type: lower.findIndex((h) => /^type/.test(h)),
    reuse: lower.findIndex((h) => /reuse|condition|when/.test(h)),
    file: lower.findIndex((h) => /^(file|download|shared file)/.test(h)),
  };
}

// Section 4's rows that are reusable assets — what the asset card lists.
// Rows typed as a decision or a fix are left out.
export function section4Rows(markdown: string): Section4Row[] {
  const lines = markdown.split('\n');
  const found = findSection4(lines);
  if (!found) return [];
  const table = findTable(lines, found.region);
  if (!table) return [];
  const col = columns(table.header);
  return table.rows
    .map((row) => ({
      title: plain(row[col.title] ?? ''),
      type: col.type === -1 ? '' : plain(row[col.type] ?? ''),
      reuseCondition: col.reuse === -1 ? '' : plain(row[col.reuse] ?? ''),
    }))
    .filter((r) => r.title && !NOT_AN_ASSET_TYPE.test(r.type));
}

function linkedTitle(title: string, link: Section4Link): string {
  return `[${cell(title)}](${link.titleHref ?? link.href})${link.assetId ? ` <!-- asset-id: ${link.assetId} -->` : ''}`;
}

function fileCell(link: Section4Link | undefined): string {
  if (!link) return APP_ROW_NUMBER;
  const label = cell(link.label || 'Download').replace(/[[\]]/g, '');
  return `[${label || 'Download'}](${link.href})`;
}

// Rebuilds Section 4's table: drops decision/fix rows and any File column,
// strips every link and marker in it (only the app writes those), then links
// the title of each row a shared asset matches and, when any asset is
// shared, adds a File column last ("—" on rows with nothing shared). An
// asset no row names gets a row of its own. A table left empty becomes NO_RESOURCES_LINE; a document
// with no Section 4 gets one (only when there's an asset to list), before
// Section 5/6 or the Source Trace appendix.
export function linkSection4Assets(markdown: string, links: Section4Link[]): string {
  const lines = markdown.split('\n');
  const found = findSection4(lines);
  const table = found ? findTable(lines, found.region) : null;

  const header = table?.header ?? ['#', 'Title', 'Type', 'Reuse condition'];
  const col = columns(header);
  const keep = header.map((_, i) => i).filter((i) => i !== col.file);
  const withFile = links.length > 0;
  const used = new Set<number>();
  const rows: string[][] = [];
  for (const row of table?.rows ?? []) {
    if (col.type !== -1 && NOT_AN_ASSET_TYPE.test(plain(row[col.type] ?? ''))) continue;
    const title = plain(row[col.title] ?? '');
    const at = links.findIndex((l, i) => !used.has(i) && sameResourceName(l.name, title));
    if (at === -1 && col.num !== -1 && plain(row[col.num] ?? '') === APP_ROW_NUMBER) continue;
    if (at !== -1) used.add(at);
    const cells = keep.map((i) => {
      if (i === col.title && at !== -1) return linkedTitle(title, links[at]);
      return (row[i] ?? '').replace(MD_LINK, '$1').replace(ASSET_ID_MARKER, '').trim();
    });
    rows.push(withFile ? [...cells, fileCell(links[at])] : cells);
  }
  links.forEach((link, i) => {
    if (used.has(i)) return;
    const cells = keep.map((c) => {
      if (c === col.title) return linkedTitle(link.name, link);
      if (c === col.type) return 'Toolkit Asset';
      if (c === col.reuse) return cell(link.reuseCondition || 'Not documented in the source');
      return APP_ROW_NUMBER;
    });
    rows.push([...cells, fileCell(link)]);
  });

  const headings = keep.map((i) => header[i]);
  if (withFile) headings.push(FILE_COLUMN);
  const body =
    rows.length === 0
      ? [NO_RESOURCES_LINE]
      : [rowLine(headings), rowLine(headings.map(() => '---')), ...rows.map(rowLine)];

  if (!found) {
    if (links.length === 0) return markdown;
    const block = ['## Section 4 — Toolkits and playbooks', '', ...body];
    const next = lines.findIndex((l) => AFTER_SECTION_4.test(l.trim()) || SOURCE_TRACE.test(l.trim()));
    if (next === -1) return `${markdown.replace(/\n+$/, '')}\n\n${block.join('\n')}\n`;
    const at = backOverRule(lines, next);
    return [...lines.slice(0, at), '', ...block, '', ...lines.slice(at)].join('\n').replace(/\n{3,}/g, '\n\n');
  }

  // No table (e.g. "No reusable resources documented."): replace the
  // section's body, keeping the heading.
  const from = table ? table.start : found.region.start;
  const to = table ? table.end : backOverRule(lines, found.region.end);
  const pad = table ? [] : [''];
  return [...lines.slice(0, from), ...pad, ...body, ...pad, ...lines.slice(to)].join('\n').replace(/\n{3,}/g, '\n\n');
}

// Drops the rows of the assets the contributor deleted: for each name, the
// row with that title, else the first row sameResourceName matches. Keeps the
// other rows as written; a table left empty becomes NO_RESOURCES_LINE.
export function removeSection4Rows(markdown: string, names: string[]): string {
  if (names.length === 0) return markdown;
  const lines = markdown.split('\n');
  const found = findSection4(lines);
  const table = found ? findTable(lines, found.region) : null;
  if (!table) return markdown;
  const col = columns(table.header);
  const titles = table.rows.map((row) => plain(row[col.title] ?? ''));
  const drop = new Set<number>();
  for (const name of names) {
    let at = titles.findIndex((t, i) => !drop.has(i) && assetMentionKey(t) === assetMentionKey(name));
    if (at === -1) at = titles.findIndex((t, i) => !drop.has(i) && sameResourceName(t, name));
    if (at !== -1) drop.add(at);
  }
  if (drop.size === 0) return markdown;
  const rows = lines.slice(table.start + 2, table.end).filter((_, i) => !drop.has(i));
  const body = rows.length === 0 ? [NO_RESOURCES_LINE] : [...lines.slice(table.start, table.start + 2), ...rows];
  return [...lines.slice(0, table.start), ...body, ...lines.slice(table.end)].join('\n');
}

// Asset ids carried by Section 4's linked titles.
export function section4AssetIds(markdown: string): string[] {
  const lines = markdown.split('\n');
  const found = findSection4(lines);
  if (!found) return [];
  const region = lines.slice(found.region.start, found.region.end).join('\n');
  return [...region.matchAll(/<!--\s*asset-id:\s*(asset-[0-9a-f-]{36})\s*-->/g)].map((m) => m[1]);
}
