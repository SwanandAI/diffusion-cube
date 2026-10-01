'use client';

import { useCallback, useState } from 'react';
import WikiMarkdown from '@/components/WikiMarkdown';
import ToolkitAssetStatusList from '@/components/ToolkitAssetStatusList';
import PathwayFrontmatterBlock from '@/components/PathwayFrontmatterBlock';
import type { VersionOption } from '@/components/AdoptionPlanModal';
import { downloadPlanAsPdf } from '@/lib/adoption-plan-pdf';
import { stripFrontmatter, parseFrontmatter } from '@/lib/strip-frontmatter';

interface Props {
  markdown: string;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onPublish: (commitMessage: string) => Promise<{ ok: boolean; slug?: string; error?: string }>;
  status: 'draft' | 'awaiting' | 'published';
  versions: VersionOption[];
  selectedVersionNumber: number | null;
  latestVersionNumber: number;
  publishedVersionNumber: number | null;
  onSelectVersion: (versionNumber: number) => void;
  // Optional name used as the PDF filename prefix.
  deploymentName?: string;
  // The pathway this workspace contributes to — shows its toolkit assets and
  // their status below the document. refreshKey re-fetches that list.
  pathwayId?: string;
  toolkitAssetsRefreshKey?: number;
}

// A persistent side panel next to the chat — read-only preview, a version
// dropdown, and a Publish button. Revisions happen entirely through chat
// (see contributorSystemPrompt's pathwayAction contract), not in this pane —
// the dropdown is for browsing history, not editing. Publish always acts on
// the latest version regardless of which one is being viewed (see the
// disabled-Publish branch below).
export default function PathwayDocumentPane({
  markdown,
  loading,
  error,
  onClose,
  onPublish,
  status,
  versions,
  selectedVersionNumber,
  latestVersionNumber,
  publishedVersionNumber,
  onSelectVersion,
  deploymentName,
  pathwayId,
  toolkitAssetsRefreshKey = 0,
}: Props) {
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  // Toolkit assets shared since the last Send for Review — offering the
  // button again lets them reach the admin without a text change.
  const [unsentAssets, setUnsentAssets] = useState(0);
  const handleUnsentCount = useCallback((count: number) => setUnsentAssets(count), []);
  const canSend = status === 'draft' || unsentAssets > 0;
  const fm = markdown ? parseFrontmatter(markdown) : null;

  function handleDownloadPdf() {
    const safeName = (deploymentName || 'pathway').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    downloadPlanAsPdf(markdown, `${safeName}-pathway.pdf`);
  }

  async function handlePublish() {
    setPublishing(true);
    setPublishError(null);
    try {
      const result = await onPublish('Update pathway page');
      if (!result.ok) setPublishError(result.error || 'Could not publish. Try again.');
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-paper text-ink">
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-navy/10 p-3">
        <div>
          <h2 className="font-display text-sm font-medium text-navy">Pathway Document</h2>
          <p className="text-xs text-ink-soft">
            {status === 'published' ? 'Published' : status === 'awaiting' ? 'Awaiting Review' : 'Draft'}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {versions.length > 0 && (
            <select
              value={selectedVersionNumber ?? latestVersionNumber}
              onChange={(e) => onSelectVersion(Number(e.target.value))}
              className="rounded-lg border border-navy/15 bg-white px-2 py-1.5 text-xs text-ink"
              aria-label="Select version"
            >
              {versions.map((v) => (
                <option key={v.version_number} value={v.version_number}>
                  v0.{v.version_number}
                  {v.version_number === latestVersionNumber
                    ? ' (latest)'
                    : v.version_number === publishedVersionNumber
                      ? ' (published)'
                      : ''}{' '}
                  — {new Date(v.created_at).toLocaleString()}
                </option>
              ))}
            </select>
          )}
          <button onClick={onClose} aria-label="Close" className="px-1 text-lg leading-none text-ink-soft transition hover:text-navy">
            ×
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {error && <p className="text-sm text-coral">{error}</p>}
        {!error && !markdown && loading && <p className="animate-pulse text-sm text-ink-soft">Drafting your pathway page…</p>}
        {!error && markdown && (
          <>
            {fm && <PathwayFrontmatterBlock fm={fm} />}
            <WikiMarkdown markdown={stripFrontmatter(markdown)} />
          </>
        )}
        {pathwayId && (
          <ToolkitAssetStatusList
            pathwayId={pathwayId}
            refreshKey={toolkitAssetsRefreshKey}
            onUnsentCountChange={handleUnsentCount}
          />
        )}
      </div>

      {!error && markdown && (
        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-navy/10 p-3">
          {publishError && <p className="mr-auto text-xs text-coral">{publishError}</p>}
          {selectedVersionNumber !== null && selectedVersionNumber !== latestVersionNumber ? (
            <p className="mr-auto text-xs text-ink-soft">
              Viewing v0.{selectedVersionNumber} — publishing always uses the latest version.
            </p>
          ) : status !== 'draft' && unsentAssets > 0 ? (
            <p className="mr-auto text-xs text-ink-soft">
              {unsentAssets} new toolkit asset{unsentAssets === 1 ? '' : 's'} not yet sent for review.
            </p>
          ) : null}
          <button
            onClick={handleDownloadPdf}
            disabled={loading}
            className="flex-shrink-0 rounded-lg border border-navy/15 px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:border-coral hover:text-coral disabled:opacity-40"
          >
            Download PDF
          </button>
          {canSend && (selectedVersionNumber === null || selectedVersionNumber === latestVersionNumber) && (
            <button
              onClick={handlePublish}
              disabled={publishing || loading}
              className="flex-shrink-0 rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition hover:bg-coral disabled:opacity-40"
            >
              {publishing ? 'Sending…' : 'Send for Review'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
