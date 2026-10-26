// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Pagination, { usePagination } from '@/components/Pagination';

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('usePagination', () => {
  it('handles an empty list: one page, zero range', () => {
    const { result } = renderHook(() => usePagination([], 10));
    expect(result.current).toMatchObject({
      page: 1,
      totalPages: 1,
      pageItems: [],
      rangeStart: 0,
      rangeEnd: 0,
      total: 0,
    });
  });

  it('exactly one full page', () => {
    const { result } = renderHook(() => usePagination(range(10), 10));
    expect(result.current.totalPages).toBe(1);
    expect(result.current.pageItems).toEqual(range(10));
    expect(result.current.rangeStart).toBe(1);
    expect(result.current.rangeEnd).toBe(10);
  });

  it('one item over a page makes a second page with one item', () => {
    const { result } = renderHook(() => usePagination(range(11), 10));
    expect(result.current.totalPages).toBe(2);
    act(() => result.current.setPage(2));
    expect(result.current.pageItems).toEqual([11]);
    expect(result.current.rangeStart).toBe(11);
    expect(result.current.rangeEnd).toBe(11);
  });

  it('clamps a page past the end to the last page', () => {
    const { result } = renderHook(() => usePagination(range(25), 10));
    act(() => result.current.setPage(99));
    expect(result.current.page).toBe(3);
    expect(result.current.pageItems).toEqual([21, 22, 23, 24, 25]);
  });

  it('re-clamps when items shrink under the current page', () => {
    const { result, rerender } = renderHook(({ items }) => usePagination(items, 10), {
      initialProps: { items: range(30) },
    });
    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);
    rerender({ items: range(12) });
    expect(result.current.page).toBe(2);
    expect(result.current.pageItems).toEqual([11, 12]);
    rerender({ items: [] });
    expect(result.current.page).toBe(1);
    expect(result.current.rangeStart).toBe(0);
  });

  it('page size 1 gives one item per page', () => {
    const { result } = renderHook(() => usePagination(['a', 'b', 'c'], 1));
    expect(result.current.totalPages).toBe(3);
    act(() => result.current.setPage(2));
    expect(result.current.pageItems).toEqual(['b']);
  });
});

function renderPagination(props: Partial<Parameters<typeof Pagination>[0]> = {}) {
  const onPageChange = vi.fn();
  render(
    <Pagination
      page={1}
      totalPages={1}
      rangeStart={1}
      rangeEnd={5}
      total={5}
      onPageChange={onPageChange}
      {...props}
    />
  );
  return onPageChange;
}

function pageButtons() {
  return screen
    .getAllByRole('button')
    .map((b) => b.textContent)
    .filter((t) => t !== 'Previous' && t !== 'Next');
}

describe('Pagination', () => {
  it('renders nothing when there are no items', () => {
    const { container } = render(
      <Pagination page={1} totalPages={1} rangeStart={0} rangeEnd={0} total={0} onPageChange={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows only the range and no buttons for a single page', () => {
    renderPagination();
    expect(screen.getByText('Showing 1–5 of 5')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('disables Previous on the first page and Next on the last', () => {
    renderPagination({ page: 1, totalPages: 3, total: 30, rangeEnd: 10 });
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('disables Next on the last page', () => {
    renderPagination({ page: 3, totalPages: 3, total: 30, rangeStart: 21, rangeEnd: 30 });
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
  });

  it('marks the current page with aria-current', () => {
    renderPagination({ page: 2, totalPages: 3, total: 30 });
    expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '1' })).not.toHaveAttribute('aria-current');
  });

  it('calls onPageChange with prev/next/number', async () => {
    const user = userEvent.setup();
    const onPageChange = renderPagination({ page: 2, totalPages: 3, total: 30 });
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: '3' }));
    expect(onPageChange.mock.calls).toEqual([[1], [3], [3]]);
  });

  it('shows every page when there are few pages', () => {
    renderPagination({ page: 1, totalPages: 3, total: 30 });
    expect(pageButtons()).toEqual(['1', '2', '3']);
    expect(screen.queryByText('…')).not.toBeInTheDocument();
  });

  it('collapses distant pages into ellipses around the current page', () => {
    renderPagination({ page: 5, totalPages: 10, total: 100 });
    expect(pageButtons()).toEqual(['1', '4', '5', '6', '10']);
    expect(screen.getAllByText('…')).toHaveLength(2);
  });

  it('shows one ellipsis when the current page is at the start', () => {
    renderPagination({ page: 1, totalPages: 10, total: 100 });
    expect(pageButtons()).toEqual(['1', '2', '10']);
    expect(screen.getAllByText('…')).toHaveLength(1);
  });

  it('shows one ellipsis when the current page is at the end', () => {
    renderPagination({ page: 10, totalPages: 10, total: 100 });
    expect(pageButtons()).toEqual(['1', '9', '10']);
    expect(screen.getAllByText('…')).toHaveLength(1);
  });

  it('does not use an ellipsis to hide a single page next to the window', () => {
    // page 3 of 5: window 2..4 plus 1 and 5 — nothing hidden.
    renderPagination({ page: 3, totalPages: 5, total: 50 });
    expect(pageButtons()).toEqual(['1', '2', '3', '4', '5']);
    expect(screen.queryByText('…')).not.toBeInTheDocument();
  });
});
