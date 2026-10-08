'use client';

import { useEffect, useState } from 'react';
import { formatAssetMonth, isAssetId, type ToolkitAssetSummary } from '@/lib/toolkit-assets';

// Download cards shown under an assistant reply that referenced published
// toolkit assets — in /analyse (ids from <grid_update>.toolkitAssetsReferenced)
// and /explore (ids from the reply's <toolkit_assets> tag). The model only
// ever supplies ids; everything shown here comes from the public
// GET /api/toolkit-assets, which drops unknown or unpublished ids, so a
// made-up id simply renders nothing. Downloads need no sign-in.

// Module-level cache so re-renders (and the same asset under several
// replies) don't refetch.
const cache = new Map<string, ToolkitAssetSummary | null>();

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function ToolkitAssetCards({
  ids,
  pathwaySlug,
}: {
  ids: string[];
  // /explore only: keep just the open pathway's assets, whatever the model said.
  pathwaySlug?: string;
}) {
  const key = ids.filter(isAssetId).join(',');
  // Bumped when a fetch fills the cache; the cards themselves are derived
  // from the cache on every render.
  const [, setFetched] = useState(0);

  useEffect(() => {
    const missing = (key ? key.split(',') : []).filter((id) => !cache.has(id));
    if (missing.length === 0) return;
    let cancelled = false;
    fetch(`/api/toolkit-assets?ids=${encodeURIComponent(missing.join(','))}`)
      .then((r) => (r.ok ? r.json() : { assets: [] }))
      .then((data: { assets?: ToolkitAssetSummary[] }) => {
        for (const id of missing) cache.set(id, null);
        for (const a of data.assets ?? []) cache.set(a.id, a);
        if (!cancelled) setFetched((n) => n + 1);
      })
      .catch(() => {
        // Left uncached so a later render can retry; nothing shown meanwhile.
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const assets = (key ? key.split(',') : []).flatMap((id) => {
    const a = cache.get(id);
    return a ? [a] : [];
  });
  const shown = pathwaySlug ? assets.filter((a) => a.pathwaySlug === pathwaySlug) : assets;
  if (shown.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {shown.map((a) => (
        <div key={a.id} className="flex items-center gap-3 rounded-xl border border-navy/15 bg-white px-4 py-3">
          <span className="text-xl" aria-hidden>
            {a.kind === 'file' ? '📎' : '🔗'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-navy">{a.name}</p>
            <p className="truncate text-xs text-ink-soft">
              {a.kind === 'file' ? [a.fileName, formatSize(a.sizeBytes)].filter(Boolean).join(' · ') : a.linkDomain}
              {a.pathwayTitle ? ` · from ${a.pathwayTitle}` : ''}
              {formatAssetMonth(a.publishedAt) ? ` · shared ${formatAssetMonth(a.publishedAt)}` : ''}
            </p>
            {a.purpose && <p className="mt-1 text-xs text-ink">{a.purpose}</p>}
          </div>
          <a
            href={`/api/toolkit-assets/${a.id}/download`}
            {...(a.kind === 'file' ? { download: true } : { target: '_blank', rel: 'noopener noreferrer' })}
            className="flex-shrink-0 rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white transition hover:bg-coral"
          >
            {a.kind === 'file' ? 'Download' : 'Open link'}
          </a>
        </div>
      ))}
    </div>
  );
}
