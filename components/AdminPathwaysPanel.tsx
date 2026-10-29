'use client';

import { useState } from 'react';
import AdminPathwayRowCard from '@/components/AdminPathwayRowCard';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/lib/toast';
import Pagination, { usePagination } from '@/components/Pagination';

const PAGE_SIZE = 10;

export interface AdminPathwayRow {
  id: string;
  slug: string;
  title: string;
  sector: string;
  created_at: string;
  reviewRequested: boolean;
  isPublished: boolean;
  // Every toolkit asset shared for this pathway (any status), loaded with
  // the admin client in app/admin/page.tsx — the card shows the ones listed
  // in the document under review.
  toolkitAssets: AdminToolkitAsset[];
}

export interface AdminToolkitAsset {
  id: string;
  name: string;
  purpose: string;
  kind: 'file' | 'link';
  fileName: string | null;
  sizeBytes: number | null;
  linkDomain: string | null;
  published: boolean;
}

export type AdminPathwayStatus = 'awaiting' | 'published' | 'draft';

// A pending review outranks an earlier publish: a contributor can send an
// already-published pathway back for review with new changes.
export function pathwayStatus(row: AdminPathwayRow): AdminPathwayStatus {
  return row.reviewRequested ? 'awaiting' : row.isPublished ? 'published' : 'draft';
}

type StatusFilter = 'all' | AdminPathwayStatus;

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'awaiting', label: 'Awaiting review' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
];

export default function AdminPathwaysPanel({ initialRows }: { initialRows: AdminPathwayRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const { confirm, dialog: confirmDialog } = useConfirm();

  const counts: Record<StatusFilter, number> = { all: rows.length, awaiting: 0, published: 0, draft: 0 };
  for (const r of rows) counts[pathwayStatus(r)]++;
  const filteredRows = filter === 'all' ? rows : rows.filter((r) => pathwayStatus(r) === filter);
  const { pageItems, setPage, ...pagination } = usePagination(filteredRows, PAGE_SIZE);

  async function publish(id: string) {
    setPending(id);
    setError(null);
    try {
      const res = await fetch('/api/admin/pathways/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pathway_id: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? 'Could not publish pathway.'); return; }
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, isPublished: true, reviewRequested: false } : r)));
      if (data.assetsPublished === false) {
        showToast('Pathway published, but its toolkit assets could not be published. Publish again to retry.', 'error');
      } else {
        showToast('Pathway published successfully.');
      }
    } catch {
      // fetch itself failed (offline, DNS) — no response to read an error from.
      setError('Could not publish pathway. Check your connection and try again.');
    } finally {
      setPending(null);
    }
  }

  async function remove(id: string, title: string) {
    const ok = await confirm({
      title: `Delete "${title}"?`,
      message:
        "This removes the pathway, every contributor's units, and its toolkit asset files. It does not remove the pathway document already published to the library. This can't be undone.",
      confirmLabel: 'Delete pathway',
      danger: true,
    });
    if (!ok) return;
    setPending(id);
    setError(null);
    try {
      const res = await fetch('/api/admin/pathways/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pathway_id: id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Could not delete pathway.');
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== id));
      showToast('Pathway deleted successfully.');
    } catch {
      setError('Could not delete pathway. Check your connection and try again.');
    } finally {
      setPending(null);
    }
  }

  if (rows.length === 0) {
    return <p className="text-sm text-ink-soft">No pathways yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {confirmDialog}
      <div className="mb-2 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={active}
              onClick={() => { setFilter(f.value); setPage(1); }}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                active
                  ? 'border-navy bg-navy text-white'
                  : 'border-navy/15 bg-white text-navy hover:border-coral hover:text-coral'
              }`}
            >
              {f.label} <span className={active ? 'text-white/70' : 'text-ink-soft'}>({counts[f.value]})</span>
            </button>
          );
        })}
      </div>
      {error && <p className="text-xs text-coral mb-1">{error}</p>}
      {filteredRows.length === 0 && (
        <p className="text-sm text-ink-soft">
          No {FILTERS.find((f) => f.value === filter)?.label.toLowerCase()} pathways.
        </p>
      )}
      {pageItems.map((row) => (
        <AdminPathwayRowCard
          key={row.id}
          row={row}
          isPending={pending === row.id}
          onPublish={() => publish(row.id)}
          onRemove={() => remove(row.id, row.title)}
        />
      ))}
      <Pagination {...pagination} onPageChange={setPage} />
    </div>
  );
}
