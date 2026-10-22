'use client';

import { useState } from 'react';

// Client-side pagination over an already-loaded list. The page is clamped on
// every render, so removing rows (reject/delete) never strands the view on an
// empty page past the end.
export function usePagination<T>(items: T[], pageSize: number) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * pageSize;
  return {
    page: current,
    totalPages,
    setPage,
    pageItems: items.slice(start, start + pageSize),
    rangeStart: items.length === 0 ? 0 : start + 1,
    rangeEnd: Math.min(start + pageSize, items.length),
    total: items.length,
  };
}

// Page numbers to show: always the first and last, plus a window around the
// current page, with null marking a gap rendered as an ellipsis.
function pageList(page: number, totalPages: number): (number | null)[] {
  const pages: (number | null)[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) {
      pages.push(p);
    } else if (pages[pages.length - 1] !== null) {
      pages.push(null);
    }
  }
  return pages;
}

export default function Pagination({
  page,
  totalPages,
  rangeStart,
  rangeEnd,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (total === 0) return null;

  const navButton =
    'rounded-lg border border-navy/15 bg-white px-3 py-1.5 text-xs font-medium text-navy transition hover:border-coral hover:text-coral disabled:opacity-40 disabled:hover:border-navy/15 disabled:hover:text-navy';

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-ink-soft">
        Showing {rangeStart}–{rangeEnd} of {total}
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onPageChange(page - 1)} disabled={page === 1} className={navButton}>
            Previous
          </button>
          {pageList(page, totalPages).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} className="px-1 text-xs text-ink-soft">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                aria-current={p === page ? 'page' : undefined}
                className={`min-w-8 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  p === page ? 'bg-navy text-white' : 'text-navy hover:bg-coral-soft hover:text-coral'
                }`}
              >
                {p}
              </button>
            )
          )}
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page === totalPages}
            className={navButton}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
