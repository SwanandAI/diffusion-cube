// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import HeatmapGrid from '@/components/HeatmapGrid';
import { DIMENSIONS, EMPTY_GRID, STAGES, cellKey, type GridState } from '@/lib/dimensions';

function gridWith(notes: Record<string, string>): GridState {
  const grid = structuredClone(EMPTY_GRID) as GridState;
  for (const [k, note] of Object.entries(notes)) {
    grid[k as keyof GridState] = { ...grid[k as keyof GridState], note } as GridState[keyof GridState];
  }
  return grid;
}

describe('HeatmapGrid', () => {
  it('renders 4 stage columns and 4 dimension rows', () => {
    render(<HeatmapGrid grid={EMPTY_GRID} />);
    const table = screen.getByRole('table');
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['', ...STAGES]);
    expect(within(table).getAllByRole('row')).toHaveLength(1 + DIMENSIONS.length);
  });

  it('an empty grid says every cell is not yet discussed', () => {
    render(<HeatmapGrid grid={EMPTY_GRID} />);
    expect(screen.getAllByText('Not yet discussed')).toHaveLength(16);
  });

  it('shows a note in its cell with the full text as a tooltip', () => {
    const d = DIMENSIONS[0];
    const note = 'Farmers struggle to reach extension officers; '.repeat(10).trim();
    render(<HeatmapGrid grid={gridWith({ [cellKey(d.code, 'Pilot')]: note })} />);
    const cell = screen.getByText(note).closest('td') as HTMLElement;
    expect(cell).toHaveAttribute('title', note);
    expect(screen.getAllByText('Not yet discussed')).toHaveLength(15);
    // Pilot is the third stage column (after the label column).
    const row = cell.closest('tr') as HTMLElement;
    expect(within(row).getAllByRole('cell').indexOf(cell)).toBe(1 + STAGES.indexOf('Pilot'));
    expect(within(row).getByText(d.name)).toBeInTheDocument();
  });

  it('treats a missing cell as not yet discussed', () => {
    const partial = { ...EMPTY_GRID } as Partial<GridState>;
    delete partial[cellKey(DIMENSIONS[0].code, 'Explore') as keyof GridState];
    render(<HeatmapGrid grid={partial as GridState} />);
    expect(screen.getAllByText('Not yet discussed')).toHaveLength(16);
  });

  it('includes the dimension and stage legend', () => {
    render(<HeatmapGrid grid={EMPTY_GRID} />);
    expect(screen.getByText('Is AI appropriate here, and what would it take?', { exact: false })).toBeInTheDocument();
    for (const d of DIMENSIONS) expect(screen.getByText(new RegExp(d.centralQuestion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
  });
});
