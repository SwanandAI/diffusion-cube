'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { assetIdsInDocument, linkDomain } from '@/lib/toolkit-assets';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/lib/toast';

interface AssetRow {
  unit_internal_id: string;
  asset_name: string;
  asset_kind: 'file' | 'link';
  file_name: string | null;
  link_url: string | null;
  published_at: string | null;
}

// The contributor's view of a pathway's toolkit assets: their own (any
// status) plus other contributors' published ones — exactly what the
// contribution_units select policy returns for the session client, so no
// extra filtering is needed here. An unpublished asset is either already in
// the document sent for review (pathways.content_cache carries its
// asset-id marker) or not yet sent. Every unpublished row here is the
// contributor's own, so each gets a Remove action (DELETE
// /api/toolkit-assets/[id] — how an admin's "drop this asset" note is acted
// on; the route also takes it out of the document under review). The pane
// uses the not-yet-sent count to offer "Send for Review" again
// (onUnsentCountChange). Re-fetches whenever refreshKey changes (bumped
// after a successful share or send) and after a removal.
export default function ToolkitAssetStatusList({
  pathwayId,
  refreshKey,
  onUnsentCountChange,
}: {
  pathwayId: string;
  refreshKey: number;
  onUnsentCountChange?: (count: number) => void;
}) {
  const [assets, setAssets] = useState<AssetRow[] | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [removedCount, setRemovedCount] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    Promise.all([
      supabase
        .from('contribution_units')
        .select('unit_internal_id, asset_name, asset_kind, file_name, link_url, published_at')
        .eq('pathway_id', pathwayId)
        .eq('unit_type', 'toolkit-asset')
        .order('created_at', { ascending: true }),
      supabase.from('pathways').select('content_cache').eq('id', pathwayId).maybeSingle(),
    ]).then(([units, pathway]) => {
      if (cancelled) return;
      if (units.error) console.error('[toolkit-assets] status list failed:', units.error);
      const rows = (units.data as AssetRow[] | null) ?? [];
      const sent = new Set(assetIdsInDocument(pathway.data?.content_cache ?? ''));
      setAssets(rows);
      setSentIds(sent);
      onUnsentCountChange?.(rows.filter((a) => !a.published_at && !sent.has(a.unit_internal_id)).length);
    });
    return () => {
      cancelled = true;
    };
  }, [pathwayId, refreshKey, removedCount, onUnsentCountChange]);

  async function remove(asset: AssetRow) {
    const ok = await confirm({
      title: `Remove "${asset.asset_name}"?`,
      message: sentIds.has(asset.unit_internal_id)
        ? "It won't be shared with this pathway, and it's taken out of the version waiting for review. This can't be undone."
        : "It won't be shared with this pathway. This can't be undone.",
      confirmLabel: 'Remove asset',
      danger: true,
    });
    if (!ok) return;
    setRemoving(asset.unit_internal_id);
    try {
      const res = await fetch(`/api/toolkit-assets/${asset.unit_internal_id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error ?? 'Could not remove the asset. Try again.', 'error');
      } else {
        showToast('Asset removed.');
      }
      setRemovedCount((n) => n + 1);
    } catch {
      showToast('Could not reach the server. Try again.', 'error');
    } finally {
      setRemoving(null);
    }
  }

  if (assets === null) return null;

  return (
    <div className="mt-8 border-t border-navy/10 pt-4">
      {confirmDialog}
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-soft">Toolkit assets</p>
      {assets.length === 0 ? (
        <p className="text-xs text-ink-soft">No toolkit asset files shared for this pathway yet.</p>
      ) : (
        <ul className="space-y-2">
          {assets.map((a) => (
            <li key={a.unit_internal_id} className="flex items-center justify-between gap-3 rounded-lg border border-navy/10 bg-white px-3 py-2">
              <a
                href={`/api/toolkit-assets/${a.unit_internal_id}/download`}
                {...(a.asset_kind === 'file' ? { download: true } : { target: '_blank', rel: 'noopener noreferrer' })}
                className="min-w-0 flex-1"
              >
                <p className="truncate text-sm font-medium text-navy hover:text-coral">{a.asset_name}</p>
                <p className="truncate text-xs text-ink-soft">
                  {a.asset_kind === 'file' ? a.file_name : a.link_url ? linkDomain(a.link_url) : ''}
                </p>
              </a>
              <span
                className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  a.published_at
                    ? 'bg-navy text-white'
                    : sentIds.has(a.unit_internal_id)
                      ? 'bg-yellow/30 text-navy'
                      : 'bg-paper-dim text-ink-soft'
                }`}
              >
                {a.published_at ? 'Published' : sentIds.has(a.unit_internal_id) ? 'Sent for review' : 'Not yet sent for review'}
              </span>
              {!a.published_at && (
                <button
                  onClick={() => remove(a)}
                  disabled={removing === a.unit_internal_id}
                  className="flex-shrink-0 text-[11px] font-medium text-ink-soft transition hover:text-coral disabled:opacity-40"
                >
                  {removing === a.unit_internal_id ? 'Removing…' : 'Remove'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
