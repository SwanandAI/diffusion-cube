import { beforeEach, describe, expect, it, vi } from 'vitest';

// A recording stand-in for jsPDF: no real PDF, no browser download. Each
// instance logs the drawing calls the export makes.
const pdf = vi.hoisted(() => {
  type Call = [string, ...unknown[]];
  const instances: { calls: Call[] }[] = [];
  class FakePdf {
    calls: Call[] = [];
    internal = { pageSize: { getWidth: () => 595, getHeight: () => 842 } };
    constructor(public options: unknown) {
      instances.push(this);
    }
    private rec(name: string, ...args: unknown[]) {
      this.calls.push([name, ...args]);
    }
    setFont(...a: unknown[]) { this.rec('setFont', ...a); }
    setFontSize(...a: unknown[]) { this.rec('setFontSize', ...a); }
    setTextColor(...a: unknown[]) { this.rec('setTextColor', ...a); }
    setFillColor(...a: unknown[]) { this.rec('setFillColor', ...a); }
    setDrawColor(...a: unknown[]) { this.rec('setDrawColor', ...a); }
    setLineWidth(...a: unknown[]) { this.rec('setLineWidth', ...a); }
    circle(...a: unknown[]) { this.rec('circle', ...a); }
    line(...a: unknown[]) { this.rec('line', ...a); }
    text(...a: unknown[]) { this.rec('text', ...a); }
    addPage() { this.rec('addPage'); }
    save(...a: unknown[]) { this.rec('save', ...a); }
    getTextWidth(text: string) { return text.length * 5; }
    // Naive word wrap at ~80 chars, enough to exercise multi-line output.
    splitTextToSize(text: string) {
      const out: string[] = [];
      let line = '';
      for (const word of text.split(' ')) {
        if ((line + ' ' + word).trim().length > 80 && line) {
          out.push(line);
          line = word;
        } else line = line ? `${line} ${word}` : word;
      }
      if (line) out.push(line);
      return out.length ? out : [''];
    }
  }
  return { FakePdf, instances };
});

vi.mock('jspdf', () => ({ default: pdf.FakePdf }));

import { downloadPlanAsPdf } from '@/lib/adoption-plan-pdf';

function run(markdown: string, filename = 'plan.pdf') {
  downloadPlanAsPdf(markdown, filename);
  return pdf.instances[pdf.instances.length - 1].calls;
}
const texts = (calls: [string, ...unknown[]][]) => calls.filter((c) => c[0] === 'text').map((c) => c[1] as string);
const named = (calls: [string, ...unknown[]][], name: string) => calls.filter((c) => c[0] === name);

beforeEach(() => {
  pdf.instances.length = 0;
});

describe('downloadPlanAsPdf', () => {
  it('saves an empty document without drawing anything', () => {
    const calls = run('', 'empty.pdf');
    expect(texts(calls)).toEqual([]);
    expect(named(calls, 'save')).toEqual([['save', 'empty.pdf']]);
  });

  it('creates an A4 document in points', () => {
    run('## Title');
    expect(pdf.instances[0]).toMatchObject({ options: { unit: 'pt', format: 'a4' } });
  });

  it('writes headings, paragraphs, bullets and numbered items as flat text', () => {
    const calls = run('## Plan **Title**\n### Sub\nA paragraph with [a link](/api/x) inside.\n- **Lead** item\n1. Step one');
    expect(texts(calls)).toEqual(['Plan Title', 'Sub', 'A paragraph with a link inside.', '•  Lead item', '1.  Step one']);
  });

  it('substitutes glyphs Helvetica cannot encode', () => {
    const calls = run('Cost ₹10 → ₹1, ≈ 5x, ≥ 2 and ≤ 3 ← ↔ ⟨x⟩');
    expect(texts(calls)[0]).toBe('Cost Rs 10 -> Rs 1, ~ 5x, >= 2 and <= 3 <- <-> <x>');
  });

  it('draws density dots as vector circles (filled ● and outlined ○)', () => {
    const calls = run('Density ●●○');
    const circles = named(calls, 'circle');
    expect(circles.map((c) => c[4])).toEqual(['F', 'F', 'S']);
    expect(texts(calls).join('')).not.toMatch(/[●○]/);
  });

  it('draws a coloured dot for an At-a-Glance status bullet and drops the tag', () => {
    const calls = run('- [green] On track');
    expect(texts(calls)).toEqual(['On track']);
    expect(named(calls, 'setFillColor')).toContainEqual(['setFillColor', 255, 101, 67]);
    expect(named(calls, 'circle')).toHaveLength(1);
  });

  it('renders a full 4×4 grid table: header rule plus one text run per cell', () => {
    const md = [
      '| | Explore | Define | Pilot | Scale |',
      '|---|---|---|---|---|',
      '| **Persona** | ●●● | ●● | ● | ○ |',
      '| **Solution** | ○ | ○ | ○ | ○ |',
      '| **Institution** | ● | ● | ● | ● |',
      '| **Ecosystem** | ●● | ○ | ○ | ●●● |',
    ].join('\n');
    const calls = run(md);
    expect(named(calls, 'line')).toHaveLength(1);
    expect(texts(calls)).toEqual(expect.arrayContaining(['Explore', 'Scale', 'Persona', 'Ecosystem']));
    // 16 density cells: 3+2+1+1 + 4 + 4 + 2+1+1+3 = 22 dots.
    expect(named(calls, 'circle')).toHaveLength(22);
  });

  it('renders an all-empty grid as outlined circles only', () => {
    const md = ['| | Explore | Define | Pilot | Scale |', '|---|---|---|---|---|', '| Persona | ○ | ○ | ○ | ○ |'].join('\n');
    const circles = named(run(md), 'circle');
    expect(circles).toHaveLength(4);
    expect(circles.every((c) => c[4] === 'S')).toBe(true);
  });

  it('truncates table cells to fit their column', () => {
    const md = `| A | B |\n|---|---|\n| ${'x'.repeat(500)} | y |`;
    const longest = Math.max(...texts(run(md)).map((t) => t.length));
    expect(longest).toBeLessThan(100);
  });

  it('adds pages for a long document', () => {
    const md = Array.from({ length: 200 }, (_, i) => `Paragraph ${i}\n`).join('\n');
    expect(named(run(md), 'addPage').length).toBeGreaterThan(1);
  });

  it('wraps a long paragraph across several lines', () => {
    expect(texts(run('word '.repeat(100))).length).toBeGreaterThan(1);
  });

  it('never prints HTML comment markers', () => {
    expect(texts(run('Title <!-- asset-id: asset-1 --> here')).join(' ')).not.toContain('asset-id');
  });
});
