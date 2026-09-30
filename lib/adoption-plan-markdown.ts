// A small, purpose-built parser for the Adoption Journey Plan's markdown
// subset (##/### headings, *italic* lines, **bold** runs, bullet and
// numbered lists) — shared by the on-screen renderer and the PDF export so
// both stay in sync with a single parse.

export type PlanBlock =
  | { type: 'h2'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'numbered'; items: string[] }
  | { type: 'paragraph'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] };

function isTableRow(line: string): boolean {
  return line.includes('|') && line.split('|').length >= 3;
}

function isTableSeparator(line: string): boolean {
  return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(line);
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function isBlockStart(line: string): boolean {
  return (
    line.startsWith('## ') ||
    line.startsWith('### ') ||
    line.startsWith('- ') ||
    line.startsWith('● ') ||
    /^\d+\.\s/.test(line) ||
    (line.startsWith('*') && line.endsWith('*') && !line.startsWith('**')) ||
    /^([-*_])\1{2,}$/.test(line) ||
    isTableRow(line)
  );
}

export function parsePlanMarkdown(markdown: string): PlanBlock[] {
  const blocks: PlanBlock[] = [];
  // HTML comments are machine markers (e.g. toolkit asset ids), never content
  // for the modal or the PDF — same rule as components/WikiMarkdown.tsx.
  const lines = markdown.replace(/<!--[\s\S]*?-->/g, '').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // Blank lines and horizontal rules are just visual spacing — the JSX
    // renderer already separates sections with margin, and the PDF export
    // adds its own gaps between blocks.
    if (!line || /^([-*_])\1{2,}$/.test(line)) {
      i++;
      continue;
    }

    if (line.startsWith('### ')) {
      blocks.push({ type: 'h3', text: line.slice(4).trim() });
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      blocks.push({ type: 'h2', text: line.slice(3).trim() });
      i++;
      continue;
    }
    if (line.startsWith('*') && line.endsWith('*') && !line.startsWith('**')) {
      blocks.push({ type: 'italic', text: line.slice(1, -1).trim() });
      i++;
      continue;
    }
    if (line.startsWith('- ') || line.startsWith('● ')) {
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i].trim();
        if (l.startsWith('- ') || l.startsWith('● ')) {
          items.push(l.slice(2).trim());
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: 'bullets', items });
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i].trim();
        const m = l.match(/^\d+\.\s+(.*)/);
        if (m) {
          items.push(m[1].trim());
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: 'numbered', items });
      continue;
    }

    // Pipe table: header row with | separator on next line.
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1].trim())) {
      const headers = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i].trim())) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    // Plain paragraph — accumulate wrapped lines until a blank line or the
    // start of a new block type.
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length) {
      const l = lines[i].trim();
      if (!l) {
        i++;
        break;
      }
      if (isBlockStart(l)) break;
      paraLines.push(l);
      i++;
    }
    blocks.push({ type: 'paragraph', text: paraLines.join(' ') });
  }

  return blocks;
}

export interface InlineRun {
  text: string;
  bold: boolean;
}

export type StatusTag = 'green' | 'amber' | 'red' | 'dark';

export interface StatusBulletItem {
  status: StatusTag | null;
  text: string;
}

const STATUS_TAG_RE = /^\[(green|amber|red|dark)\]\s*/i;

// The "At a Glance" section tags each bullet with a leading "[green]" /
// "[amber]" / "[red]" / "[dark]" marker (see adoptionPlanSystemPrompt) rather
// than an emoji — jsPDF's default fonts don't reliably include color emoji
// glyphs, so both renderers draw a real colored dot from this instead.
export function parseStatusBullet(item: string): StatusBulletItem {
  const match = item.match(STATUS_TAG_RE);
  if (!match) return { status: null, text: item };
  return { status: match[1].toLowerCase() as StatusTag, text: item.slice(match[0].length) };
}

// Splits a line into plain/bold runs for inline **bold** rendering.
export function splitInlineBold(text: string): InlineRun[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) =>
      part.startsWith('**') && part.endsWith('**')
        ? { text: part.slice(2, -2), bold: true }
        : { text: part, bold: false }
    );
}
