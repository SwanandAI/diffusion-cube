import { describe, expect, it } from 'vitest';
import {
  DENSITY_SYMBOLS,
  DIMENSIONS,
  DIMENSION_CODES,
  DIMENSION_COLORS,
  DIMENSION_NAMES,
  EMPTY_GRID,
  STAGES,
  UNIT_TYPES,
  cellKey,
  frameworkStructureLegend,
} from '@/lib/dimensions';

describe('framework shape', () => {
  it('has the four dimensions in order', () => {
    expect(DIMENSION_CODES).toEqual(['persona', 'solution', 'institution', 'ecosystem']);
    expect(DIMENSION_NAMES).toEqual({
      persona: 'Persona',
      solution: 'Solution',
      institution: 'Institution',
      ecosystem: 'Ecosystem',
    });
  });

  it('has the four stages in order', () => {
    expect([...STAGES]).toEqual(['Explore', 'Define', 'Pilot', 'Scale']);
  });

  it('has the five unit types', () => {
    expect([...UNIT_TYPES]).toEqual(['Strategic Decision', 'Tactical Decision', 'Failure and Fix', 'Playbook', 'Toolkit Asset']);
  });

  it.each(DIMENSIONS.map((d) => [d.code, d] as const))('%s: sub-categories are lettered A, B, C... with no gaps', (_code, d) => {
    expect(d.subCategories.map((s) => s.code)).toEqual(
      d.subCategories.map((_, i) => String.fromCharCode('A'.charCodeAt(0) + i))
    );
    expect(d.centralQuestion).toMatch(/\?$/);
  });

  it('sub-category counts match the framework spec (4/5/7/6)', () => {
    expect(DIMENSIONS.map((d) => d.subCategories.length)).toEqual([4, 5, 7, 6]);
  });

  it('every sub-category weights every stage as primary/secondary/dormant', () => {
    for (const d of DIMENSIONS) {
      for (const s of d.subCategories) {
        expect(Object.keys(s.weights).sort()).toEqual([...STAGES].sort());
        for (const st of STAGES) expect(['primary', 'secondary', 'dormant']).toContain(s.weights[st]);
      }
    }
  });

  it('pins a few weights the prompts rely on', () => {
    const weight = (dim: string, sub: string) => DIMENSIONS.find((d) => d.code === dim)!.subCategories.find((s) => s.code === sub)!.weights;
    expect(weight('persona', 'A').Explore).toBe('primary');
    expect(weight('institution', 'G')).toEqual({ Explore: 'dormant', Define: 'dormant', Pilot: 'secondary', Scale: 'primary' });
    // Ecosystem has no Primary concern at Explore — deliberate in the spec.
    expect(DIMENSIONS.find((d) => d.code === 'ecosystem')!.subCategories.some((s) => s.weights.Explore === 'primary')).toBe(false);
  });
});

describe('cellKey', () => {
  it('joins dimension and stage with a colon', () => {
    expect(cellKey('persona', 'Explore')).toBe('persona:Explore');
    expect(cellKey('ecosystem', 'Scale')).toBe('ecosystem:Scale');
  });
});

describe('EMPTY_GRID', () => {
  it('has all 16 cells at density 0 with an empty note', () => {
    const keys = Object.keys(EMPTY_GRID);
    expect(keys).toHaveLength(16);
    for (const d of DIMENSION_CODES) for (const s of STAGES) expect(EMPTY_GRID[cellKey(d, s)]).toEqual({ density: 0, note: '' });
  });

  it('gives every cell its own object (no shared reference)', () => {
    expect(EMPTY_GRID['persona:Explore']).not.toBe(EMPTY_GRID['persona:Define']);
  });
});

describe('display tables', () => {
  it('maps every density to its symbol', () => {
    expect(DENSITY_SYMBOLS).toEqual({ 0: '○', 1: '●', 2: '●●', 3: '●●●' });
  });

  it('gives every dimension a hex color', () => {
    for (const d of DIMENSION_CODES) expect(DIMENSION_COLORS[d]).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('frameworkStructureLegend', () => {
  const legend = frameworkStructureLegend();

  it('names every dimension with its JSON code and central question', () => {
    for (const d of DIMENSIONS) expect(legend).toContain(`${d.name} ("${d.code}") — ${d.centralQuestion}`);
  });

  it('lists every sub-category with all four stage weights', () => {
    expect(legend).toContain(
      '  A. Problem and Persona — Explore: primary, Define: secondary, Pilot: dormant, Scale: secondary'
    );
    const subLines = legend.split('\n').filter((l) => /^ {2}[A-G]\. /.test(l));
    expect(subLines).toHaveLength(DIMENSIONS.reduce((n, d) => n + d.subCategories.length, 0));
  });

  it('separates dimensions with a blank line', () => {
    expect(legend.split('\n\n')).toHaveLength(4);
  });
});
