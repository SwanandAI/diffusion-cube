'use client';

import { downloadPlanAsPdf } from '@/lib/adoption-plan-pdf';
import WikiMarkdown from '@/components/WikiMarkdown';

// Shared with PathwayDocumentPane's version picker.
export interface VersionOption {
  version_number: number;
  created_at: string;
}

interface Props {
  title: string;
  markdown: string;
  loading: boolean;
  error: string | null;
  deploymentName: string;
  onClose: () => void;
  filenameSuffix: string;
  loadingLabel: string;
}

// The Analysis Document / Executive Summary view. Fills its container — it
// lives inside AdoptionWorkspace's resizable side panel, whose tab bar already
// carries the title and close button.
export default function AdoptionPlanModal({
  title,
  markdown,
  loading,
  error,
  deploymentName,
  onClose,
  filenameSuffix,
  loadingLabel,
}: Props) {
  function handleDownload() {
    // Edge hyphens trimmed so a name ending in punctuation ("Kisan Voice!")
    // doesn't give a double hyphen before the suffix.
    const safeName =
      (deploymentName || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'deployment';
    downloadPlanAsPdf(markdown, `${safeName}-${filenameSuffix}.pdf`);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Panel header — mirrors PathwayDocumentPane's header style */}
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-navy/10 p-3">
        <h2 className="font-display text-sm font-medium text-navy">{title}</h2>
        <button
          onClick={onClose}
          aria-label="Close"
          className="px-1 text-lg leading-none text-ink-soft transition hover:text-navy"
        >
          ×
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {error && <p className="text-sm text-coral">{error}</p>}
        {!error && !markdown && loading && (
          <p className="animate-pulse text-sm text-ink-soft">{loadingLabel}</p>
        )}
        {!error && markdown && <WikiMarkdown markdown={markdown} />}
        {!error && loading && markdown && (
          <p className="mt-2 animate-pulse text-xs text-ink-soft">Generating…</p>
        )}
      </div>

      {/* Footer — Download PDF, consistent with PathwayDocumentPane */}
      {!error && markdown && (
        <div className="flex flex-shrink-0 items-center justify-end border-t border-navy/10 p-3">
          <button
            onClick={handleDownload}
            disabled={loading || !markdown}
            className="flex-shrink-0 rounded-lg border border-navy/15 px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:border-coral hover:text-coral disabled:opacity-40"
          >
            Download PDF
          </button>
        </div>
      )}
    </div>
  );
}
