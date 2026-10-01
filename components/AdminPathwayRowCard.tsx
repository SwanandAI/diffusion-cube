'use client';

import { useState } from 'react';
import WikiMarkdown from '@/components/WikiMarkdown';
import PathwayFrontmatterBlock from '@/components/PathwayFrontmatterBlock';
import { createClient } from '@/lib/supabase/client';
import { stripFrontmatter, parseFrontmatter } from '@/lib/strip-frontmatter';
import type { AdminPathwayRow, AdminToolkitAsset } from '@/components/AdminPathwaysPanel';
import { assetIdsInDocument } from '@/lib/toolkit-assets';

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// One toolkit asset in the review card. Its download goes through the same
// route adopters use — admins may fetch unpublished assets there.
function AdminAssetItem({ asset }: { asset: AdminToolkitAsset }) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-navy/10 bg-white px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-navy">
          {asset.kind === 'file' ? '📎' : '🔗'} {asset.name}
          {asset.published && (
            <span className="ml-2 rounded-full bg-coral/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-coral">
              Published
            </span>
          )}
        </p>
        <p className="text-xs text-ink-soft">
          {asset.kind === 'file' ? `${asset.fileName ?? 'file'} · ${formatSize(asset.sizeBytes)}` : asset.linkDomain}
          {asset.kind === 'file' && ' · Not scanned for malware'}
        </p>
        {asset.purpose && <p className="mt-1 text-xs text-ink">{asset.purpose}</p>}
      </div>
      <a
        href={`/api/toolkit-assets/${asset.id}/download`}
        {...(asset.kind === 'file' ? { download: true } : { target: '_blank', rel: 'noopener noreferrer' })}
        className="flex-shrink-0 rounded-lg border border-navy/15 px-2.5 py-1 text-xs font-medium text-navy transition hover:border-coral hover:text-coral"
      >
        {asset.kind === 'file' ? 'Download' : 'Open link'}
      </a>
    </li>
  );
}

interface Props {
  row: AdminPathwayRow;
  isPending: boolean;
  onPublish: () => void;
  onRemove: () => void;
}

export default function AdminPathwayRowCard({ row, isPending, onPublish, onRemove }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [docContent, setDocContent] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);

  const status = row.reviewRequested ? 'awaiting' : row.isPublished ? 'published' : 'draft';

  async function handleToggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (docContent !== null) return; // already fetched
    setDocLoading(true);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('pathways')
        .select('content_cache')
        .eq('id', row.id)
        .maybeSingle();
      setDocContent(data?.content_cache ?? '');
    } finally {
      setDocLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-navy/10 bg-white overflow-hidden">
      {/* Row header — always visible */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
        <button
          type="button"
          onClick={handleToggle}
          className="flex items-center gap-2 min-w-0 text-left"
        >
          <span className={`text-ink-soft text-xs transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-navy">{row.title}</span>
              {status === 'published' && (
                <span className="rounded-full bg-coral/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-coral">
                  Published
                </span>
              )}
              {status === 'awaiting' && (
                <span className="rounded-full bg-yellow/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-navy">
                  Awaiting Review
                </span>
              )}
            </div>
            <p className="text-xs text-ink-soft mt-0.5">
              {row.sector || 'No sector'} · {new Date(row.created_at).toLocaleDateString()}
            </p>
          </div>
        </button>

        <div className="flex items-center gap-2 flex-shrink-0">
          {status === 'awaiting' && (
            <button
              type="button"
              onClick={onPublish}
              disabled={isPending}
              className="rounded-lg bg-navy px-2.5 py-1 text-xs font-medium text-white transition hover:bg-coral disabled:opacity-50"
            >
              {isPending ? 'Publishing…' : 'Publish'}
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            disabled={isPending}
            className="rounded-lg border border-coral/30 px-2.5 py-1 text-xs font-medium text-coral transition hover:bg-coral hover:text-white disabled:opacity-50"
          >
            {isPending && status !== 'awaiting' ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>

      {/* Expanded document view */}
      {expanded && (
        <div className="border-t border-navy/10 px-6 py-4 max-h-[60vh] overflow-y-auto bg-paper/60">
          {docLoading && (
            <p className="animate-pulse text-sm text-ink-soft">Loading document…</p>
          )}
          {!docLoading && !docContent && (
            <p className="text-sm text-ink-soft italic">No assembled document yet.</p>
          )}
          {!docLoading && docContent && (() => {
            const fm = parseFrontmatter(docContent);
            return (
              <>
                {fm && <PathwayFrontmatterBlock fm={fm} />}
                <WikiMarkdown markdown={stripFrontmatter(docContent)} />
              </>
            );
          })()}
          {!docLoading && docContent !== null && row.toolkitAssets.length > 0 && (() => {
            // Publishing publishes exactly the assets listed in this document;
            // anything shared after the last Send for Review is shown apart.
            const inDoc = new Set(assetIdsInDocument(docContent));
            const included = row.toolkitAssets.filter((a) => inDoc.has(a.id));
            const later = row.toolkitAssets.filter((a) => !inDoc.has(a.id) && !a.published);
            return (
              <div className="mt-6 border-t border-navy/10 pt-4">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-soft">
                  Toolkit assets in this review ({included.length})
                </p>
                {included.length === 0 ? (
                  <p className="text-xs text-ink-soft">None.</p>
                ) : (
                  <>
                    <p className="mb-2 text-xs text-ink-soft">
                      Publishing this pathway makes these public — anyone can download them, no sign-in needed.
                    </p>
                    <ul className="space-y-2">
                      {included.map((a) => <AdminAssetItem key={a.id} asset={a} />)}
                    </ul>
                  </>
                )}
                {later.length > 0 && (
                  <>
                    <p className="mb-2 mt-4 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-soft">
                      Shared after this review was sent ({later.length}) — not published by this click
                    </p>
                    <ul className="space-y-2">
                      {later.map((a) => <AdminAssetItem key={a.id} asset={a} />)}
                    </ul>
                  </>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
