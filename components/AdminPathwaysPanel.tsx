'use client';

import { useState } from 'react';
import AdminPathwayRowCard from '@/components/AdminPathwayRowCard';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/lib/toast';

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

export default function AdminPathwaysPanel({ initialRows }: { initialRows: AdminPathwayRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

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
      {error && <p className="text-xs text-coral mb-1">{error}</p>}
      {rows.map((row) => (
        <AdminPathwayRowCard
          key={row.id}
          row={row}
          isPending={pending === row.id}
          onPublish={() => publish(row.id)}
          onRemove={() => remove(row.id, row.title)}
        />
      ))}
    </div>
  );
}
