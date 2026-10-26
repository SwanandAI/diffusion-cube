import { describe, expect, it } from 'vitest';
import { parsePlanMarkdown, parseStatusBullet, splitInlineBold } from '@/lib/adoption-plan-markdown';

describe('parsePlanMarkdown', () => {
  it('parses every block type in the plan subset', () => {
    const md = [
      '## Farm Voice — Analysis',
      '*Agriculture · Maharashtra*',
      '### Section 1',
      'First line of a paragraph',
      'wrapped onto a second line.',
      '',
      '- one',
      '● two',
      '1. first',
      '2. second',
      '| Dimension | Explore |',
      '|---|:---:|',
      '| Persona | ●●○ |',
      '| Solution | ○ |',
    ].join('\n');
    expect(parsePlanMarkdown(md)).toEqual([
      { type: 'h2', text: 'Farm Voice — Analysis' },
      { type: 'italic', text: 'Agriculture · Maharashtra' },
      { type: 'h3', text: 'Section 1' },
      { type: 'paragraph', text: 'First line of a paragraph wrapped onto a second line.' },
      { type: 'bullets', items: ['one', 'two'] },
      { type: 'numbered', items: ['first', 'second'] },
      { type: 'table', headers: ['Dimension', 'Explore'], rows: [['Persona', '●●○'], ['Solution', '○']] },
    ]);
  });

  it('returns [] for empty or whitespace-only input', () => {
    expect(parsePlanMarkdown('')).toEqual([]);
    expect(parsePlanMarkdown('\n\n   \n\t')).toEqual([]);
  });

  it('skips horizontal rules', () => {
    expect(parsePlanMarkdown('---\n***\n___\n## H')).toEqual([{ type: 'h2', text: 'H' }]);
  });

  it('drops HTML comments, including multi-line ones and asset-id markers', () => {
    const md = 'Visible <!-- asset-id: asset-x -->text\n<!--\nhidden\nblock\n-->\n## After';
    expect(parsePlanMarkdown(md)).toEqual([
      { type: 'paragraph', text: 'Visible text' },
      { type: 'h2', text: 'After' },
    ]);
  });

  it('ends a paragraph at the start of another block', () => {
    expect(parsePlanMarkdown('Para line\n- bullet')).toEqual([
      { type: 'paragraph', text: 'Para line' },
      { type: 'bullets', items: ['bullet'] },
    ]);
  });

  it('treats a **bold** line as a paragraph, not italic', () => {
    expect(parsePlanMarkdown('**Bold lead** and more')).toEqual([{ type: 'paragraph', text: '**Bold lead** and more' }]);
  });

  it('handles CRLF-free indentation by trimming each line', () => {
    expect(parsePlanMarkdown('   ## Indented\n    - item')).toEqual([
      { type: 'h2', text: 'Indented' },
      { type: 'bullets', items: ['item'] },
    ]);
  });

  it('parses a table without outer pipes (rows need at least two pipes)', () => {
    expect(parsePlanMarkdown('A | B | C\n--- | --- | ---\n1 | 2 | 3')).toEqual([
      { type: 'table', headers: ['A', 'B', 'C'], rows: [['1', '2', '3']] },
    ]);
  });

  it('parses a header-only table', () => {
    expect(parsePlanMarkdown('| A | B |\n|---|---|')).toEqual([{ type: 'table', headers: ['A', 'B'], rows: [] }]);
  });

  it('treats a pipe row with no separator as text, not a table', () => {
    const blocks = parsePlanMarkdown('| A | B |\n| 1 | 2 |');
    expect(blocks.every((b) => b.type === 'paragraph')).toBe(true);
  });

  it('does not treat a "#" h1 or "####" as a heading (outside the subset)', () => {
    expect(parsePlanMarkdown('# Title')).toEqual([{ type: 'paragraph', text: '# Title' }]);
    expect(parsePlanMarkdown('#### Deep')).toEqual([{ type: 'paragraph', text: '#### Deep' }]);
  });

  it('keeps unicode and script-like text as plain text', () => {
    expect(parsePlanMarkdown('<script>alert(1)</script> किसान ₹10')).toEqual([
      { type: 'paragraph', text: '<script>alert(1)</script> किसान ₹10' },
    ]);
  });

  it('terminates on a very long document', () => {
    const md = Array.from({ length: 2000 }, (_, i) => `- item ${i}`).join('\n');
    const blocks = parsePlanMarkdown(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'bullets' });
  });
});

describe('parseStatusBullet', () => {
  it.each([
    ['[green] On track', 'green', 'On track'],
    ['[Amber]   Watch funding', 'amber', 'Watch funding'],
    ['[RED] Blocked', 'red', 'Blocked'],
    ['[dark]No data', 'dark', 'No data'],
  ])('%j -> %s', (item, status, text) => {
    expect(parseStatusBullet(item)).toEqual({ status, text });
  });

  it.each(['[blue] Unknown colour', 'green] missing bracket', 'Plain bullet', ' [green] leading space', ''])(
    'leaves %j untagged',
    (item) => {
      expect(parseStatusBullet(item)).toEqual({ status: null, text: item });
    }
  );
});

describe('splitInlineBold', () => {
  it('splits bold and plain runs', () => {
    expect(splitInlineBold('A **bold** and **more** end')).toEqual([
      { text: 'A ', bold: false },
      { text: 'bold', bold: true },
      { text: ' and ', bold: false },
      { text: 'more', bold: true },
      { text: ' end', bold: false },
    ]);
  });

  it('returns a single plain run when there is no bold', () => {
    expect(splitInlineBold('plain')).toEqual([{ text: 'plain', bold: false }]);
  });

  it('returns [] for an empty string', () => {
    expect(splitInlineBold('')).toEqual([]);
  });

  it('leaves an unclosed marker as plain text', () => {
    expect(splitInlineBold('a **unclosed')).toEqual([{ text: 'a **unclosed', bold: false }]);
  });

  it('does not treat *italic* as bold', () => {
    expect(splitInlineBold('*it*')).toEqual([{ text: '*it*', bold: false }]);
  });
});
