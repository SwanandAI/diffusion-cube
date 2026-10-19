import jsPDF from 'jspdf';
import { parsePlanMarkdown, parseStatusBullet, splitInlineBold } from '@/lib/adoption-plan-markdown';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// jsPDF's built-in Helvetica only encodes WinAnsi (Latin-1 plus a few extras
// like — and –), so anything outside it prints as mojibake (e.g. "%Ï").
// These are the ones pathway content actually uses; ● / ○ are left alone and
// drawn as vector circles by drawInline instead.
const PDF_SUBSTITUTIONS: [RegExp, string][] = [
  [/→/g, '->'],
  [/←/g, '<-'],
  [/↔/g, '<->'],
  [/≈/g, '~'],
  [/≥/g, '>='],
  [/≤/g, '<='],
  [/₹/g, 'Rs '],
  [/⟨/g, '<'],
  [/⟩/g, '>'],
];

// Flattens inline **bold** markers to plain text — jsPDF's plain text() calls
// don't support mixed bold/normal runs within a single line, so the PDF
// export trades that emphasis for simplicity (the on-screen modal keeps it).
// Links keep only their label (e.g. Section 4's linked titles and File
// cells, whose app-relative download links mean nothing on paper).
function flatten(text: string): string {
  const plain = splitInlineBold(text.replace(/\[([^\]]+)\]\([^)\s]*\)/g, '$1'))
    .map((run) => run.text)
    .join('');
  return PDF_SUBSTITUTIONS.reduce((acc, [re, sub]) => acc.replace(re, sub), plain);
}

export function downloadPlanAsPdf(markdown: string, filename: string) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 48;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - marginX * 2;
  let y = 56;

  function ensureSpace(lineHeight: number) {
    if (y + lineHeight > pageHeight - 48) {
      doc.addPage();
      y = 56;
    }
  }

  // Writes one line of text, drawing the grid's density symbols (● / ○) as
  // vector circles — same reason as writeStatusBullet below: Helvetica has
  // no glyph for them.
  function drawInline(text: string, x: number, baseline: number, size: number) {
    const r = size * 0.27;
    let cx = x;
    for (const part of text.split(/([●○])/)) {
      if (!part) continue;
      if (part === '●' || part === '○') {
        doc.setFillColor(0, 0, 0);
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.6);
        doc.circle(cx + r, baseline - size * 0.33, r, part === '●' ? 'F' : 'S');
        cx += r * 2 + size * 0.2;
      } else {
        doc.text(part, cx, baseline);
        cx += doc.getTextWidth(part);
      }
    }
  }

  function writeLines(text: string, size: number, style: 'normal' | 'bold' | 'italic', indent: number, gapAfter: number) {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(0, 0, 0);
    const lines: string[] = doc.splitTextToSize(text, maxWidth - indent);
    for (const line of lines) {
      ensureSpace(size + 4);
      drawInline(line, marginX + indent, y, size);
      y += size + 4;
    }
    y += gapAfter;
  }

  // Draws a real vector-filled circle instead of relying on an emoji glyph —
  // jsPDF's default Helvetica font doesn't reliably include color emoji, so
  // this is how the "At a Glance" status tags actually render in the PDF.
  function writeStatusBullet(text: string, color: string) {
    const indent = 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const lines: string[] = doc.splitTextToSize(text, maxWidth - indent);
    const { r, g, b } = hexToRgb(color);
    lines.forEach((line, idx) => {
      ensureSpace(15);
      if (idx === 0) {
        doc.setFillColor(r, g, b);
        doc.circle(marginX + 4, y - 3, 3, 'F');
      }
      doc.setTextColor(0, 0, 0);
      drawInline(line, marginX + indent, y, 11);
      y += 15;
    });
    y += 2;
  }

  for (const block of parsePlanMarkdown(markdown)) {
    switch (block.type) {
      case 'h2':
        y += 8;
        writeLines(flatten(block.text), 18, 'bold', 0, 10);
        break;
      case 'h3':
        y += 6;
        writeLines(flatten(block.text), 13, 'bold', 0, 6);
        break;
      case 'italic':
        writeLines(flatten(block.text), 10, 'italic', 0, 4);
        break;
      case 'paragraph':
        writeLines(flatten(block.text), 11, 'normal', 0, 8);
        break;
      case 'bullets':
        for (const item of block.items) {
          const { status, text } = parseStatusBullet(item);
          if (status) {
            writeStatusBullet(flatten(text), '#ff6543');
          } else {
            writeLines(`•  ${flatten(item)}`, 11, 'normal', 8, 2);
          }
        }
        y += 6;
        break;
      case 'numbered':
        block.items.forEach((item, idx) => {
          writeLines(`${idx + 1}.  ${flatten(item)}`, 11, 'normal', 8, 4);
        });
        y += 6;
        break;
      case 'table': {
        y += 6;
        const colCount = block.headers.length;
        if (colCount === 0) break;
        const colWidth = Math.floor(maxWidth / colCount);

        // Header row
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(0, 0, 0);
        // Room for the header plus the first data row, so the header is
        // never stranded at the bottom of a page.
        ensureSpace(14 + 12 + 13);
        block.headers.forEach((h, ci) => {
          // Truncate so text stays inside its column
          const txt = flatten(h).slice(0, Math.floor(colWidth / 5));
          drawInline(txt, marginX + ci * colWidth, y, 9);
        });
        y += 4;
        // Thin rule under headers
        doc.setDrawColor(180, 180, 180);
        doc.setLineWidth(0.3);
        doc.line(marginX, y, marginX + maxWidth, y);
        y += 8;

        // Data rows
        doc.setFont('helvetica', 'normal');
        for (const row of block.rows) {
          ensureSpace(13);
          row.forEach((cell, ci) => {
            const txt = flatten(cell).slice(0, Math.floor(colWidth / 5));
            drawInline(txt, marginX + ci * colWidth, y, 9);
          });
          y += 13;
        }
        y += 6;
        break;
      }
    }
  }

  doc.save(filename);
}
