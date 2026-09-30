import { Fragment, type ReactNode } from 'react';

// Renders a pathway document's markdown for on-demand browsing. A different,
// richer subset than lib/adoption-plan-markdown.ts's parser (which has no
// table support) — pathway docs lean heavily on pipe tables (identity,
// coverage grid, toolkits, problem→solution).

const BOLD = /(\*\*[^*]+\*\*)/g;
// Only when `links` is on (the legal pages) — pathway docs carry relative
// `[Title](other-pathway.md)` cross-links that would 404 if rendered here, so
// by default link syntax still shows as plain text.
const BOLD_OR_LINK = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text: string, links = false): ReactNode {
  return text.split(links ? BOLD_OR_LINK : BOLD).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-medium text-navy">
          {part.slice(2, -2)}
        </strong>
      );
    }
    const link = links ? part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/) : null;
    if (link) {
      const [, label, href] = link;
      const external = /^https?:\/\//.test(href);
      return (
        <a
          key={i}
          href={href}
          {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className="font-medium text-navy underline decoration-navy/30 underline-offset-2 transition hover:text-coral"
        >
          {label}
        </a>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function isTableSeparator(line: string): boolean {
  return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(line.trim());
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

export default function WikiMarkdown({ markdown, links = false }: { markdown: string; links?: boolean }) {
  // HTML comments are machine markers, never content — e.g. the toolkit
  // asset block's <!-- asset-id: … --> / start / end markers (see
  // lib/toolkit-assets.ts). Dropped before parsing so they never show as text.
  const lines = markdown.replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headerCells = splitRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={key++} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-navy/15">
                {headerCells.map((c, ci) => (
                  <th key={ci} className="px-2 py-1.5 text-left font-display font-medium text-navy">
                    {renderInline(c, links)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-navy/5 align-top">
                  {r.map((c, ci) => (
                    <td key={ci} className="px-2 py-1.5 text-ink-soft">
                      {renderInline(c, links)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^###\s+/.test(trimmed)) {
      blocks.push(
        <h3 key={key++} className="mt-5 mb-1.5 font-display text-base font-medium text-navy">
          {trimmed.replace(/^###\s+/, '')}
        </h3>
      );
      i++;
      continue;
    }
    if (/^##\s+/.test(trimmed)) {
      blocks.push(
        <h2 key={key++} className="mt-6 mb-2 font-display text-lg font-medium text-navy">
          {trimmed.replace(/^##\s+/, '')}
        </h2>
      );
      i++;
      continue;
    }
    if (/^#\s+/.test(trimmed)) {
      blocks.push(
        <h1 key={key++} className="mt-6 mb-2 font-display text-xl font-medium text-navy">
          {trimmed.replace(/^#\s+/, '')}
        </h1>
      );
      i++;
      continue;
    }
    if (/^-{3,}$/.test(trimmed)) {
      blocks.push(<hr key={key++} className="my-4 border-navy/10" />);
      i++;
      continue;
    }
    if (/^([-*]|\d+\.)\s+/.test(trimmed)) {
      const ordered = /^\d+\./.test(trimmed);
      const items: string[] = [];
      while (i < lines.length && /^([-*]|\d+\.)\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^([-*]|\d+\.)\s+/, ''));
        i++;
      }
      blocks.push(
        ordered ? (
          <ol key={key++} className="my-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-ink">
            {items.map((item, ii) => (
              <li key={ii}>{renderInline(item, links)}</li>
            ))}
          </ol>
        ) : (
          <ul key={key++} className="my-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink">
            {items.map((item, ii) => (
              <li key={ii}>{renderInline(item, links)}</li>
            ))}
          </ul>
        )
      );
      continue;
    }

    const paraLines = [trimmed];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3}\s|[-*]\s|\d+\.\s|-{3,}$)/.test(lines[i].trim()) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    blocks.push(
      <p key={key++} className="my-2 text-sm leading-relaxed text-ink">
        {renderInline(paraLines.join(' '), links)}
      </p>
    );
  }

  return <div>{blocks}</div>;
}
