'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ChatPanel, { Message } from '@/components/ChatPanel';
import HeatmapGrid from '@/components/HeatmapGrid';
import AttachmentsPanel from '@/components/AttachmentsPanel';
import PathwayDocumentPane from '@/components/PathwayDocumentPane';
import AdoptionPlanModal from '@/components/AdoptionPlanModal';
import VoiceInputButton from '@/components/VoiceInputButton';
import {
  AdoptionConversation,
  AdoptionFlow,
  extractUploadedFileNames,
  useAdoptionConversation,
} from '@/lib/adoption-conversation';
import {
  WHAT_THE_CUBE_DOES,
  STRENGTHEN_INTRO,
  getExplorerIntent,
  type ExplorerIntent,
} from '@/lib/explorer-intents';
import type { DocType } from '@/lib/design-documents';
import { EMPTY_GRID } from '@/lib/dimensions';
import { ATTACH_ACCEPT, CONTRIBUTOR_ATTACH_ACCEPT } from '@/lib/extract-text';

const CONTRIBUTOR_OPENING_MESSAGE: Message = {
  role: 'assistant',
  content:
    "Please share your deployment documents (PDF, Word, PowerPoint and so on), or describe the project here — you can add more at any point. I'll read them (and check the stage with you if they don't say it), draft the pathway, ask a few questions to fill in the journey, then check with you which reusable resources (templates, checklists, tools and so on) you'd like to share alongside it.\n\nNothing becomes public unless you agree and an administrator approves it. Your progress is saved, so you can leave and come back any time.",
};

const STRENGTHEN_OPENING_MESSAGE: Message = {
  role: 'assistant',
  content: STRENGTHEN_INTRO,
};

const BACK_CONTROL_CLASS =
  'inline-flex items-center gap-1.5 text-sm font-medium text-navy transition hover:gap-2.5 hover:text-coral';

export const PICK_INTENT_LABEL = '← Pick a different starting point';

function BackControl({ onBack }: { onBack?: () => void }) {
  const inner = (
    <>
      <span aria-hidden className="transition-transform">←</span> Back
    </>
  );
  return onBack ? (
    <button type="button" onClick={onBack} className={BACK_CONTROL_CLASS}>
      {inner}
    </button>
  ) : (
    <Link href="/contribute" className={BACK_CONTROL_CLASS}>
      {inner}
    </Link>
  );
}

const EXPLORER_DOC_LABELS: Record<
  DocType,
  { title: string; filenameSuffix: string; loadingLabel: string }
> = {
  analysis: {
    title: 'Analysis Document',
    filenameSuffix: 'analysis',
    loadingLabel: 'Putting your analysis document together…',
  },
  plan: {
    title: 'Executive Summary',
    filenameSuffix: 'executive-summary',
    loadingLabel: 'Putting your executive summary together…',
  },
  draft: { title: '', filenameSuffix: '', loadingLabel: '' },
};

// What the right panel is showing. 'none' means closed.
type RightPanelTab = 'none' | 'grid' | 'document' | 'analysis' | 'summary';

interface Props {
  initial: AdoptionConversation | null;
  fixedFlow?: AdoptionFlow;
  pathwayId?: string;
  canStrengthen?: boolean;
  canContribute?: boolean;
  onCreated?: (c: AdoptionConversation) => void;
  onChange?: (c: AdoptionConversation) => void;
  onBack?: () => void;
  backLabel?: string;
}

type PathwayInfo = {
  title: string;
  description?: string;
  sector?: string;
  stage?: string;
  timestamp?: string;
  contributor?: string;
};

export default function AdoptionWorkspace({
  initial,
  fixedFlow,
  pathwayId,
  canStrengthen = false,
  canContribute = false,
  onCreated,
  onChange,
  onBack,
  backLabel = '← Back',
}: Props) {
  const {
    conversation,
    loading,
    pendingAttachments,
    handleUserSend,
    handleAttachFiles,
    removeAttachment,
    hasToolkitAssetFile,
    rememberToolkitAssetFile,
    answerToolkitAssetConsent,
    decideResourceItem,
    attachForResourceItem,
    linkForResourceItem,
    finishResourceReview,
    requestPublishConsent,
    answerPublishConsent,
    toolkitAssetsVersion,
    pathwayDoc,
    pathwayPreview,
    openPathwayDocument,
    closePathwayDocument,
    selectPathwayDocVersion,
    explorerDoc,
    openExplorerDocument,
    closeExplorerDocument,
  } = useAdoptionConversation({ initial, pathwayId, onCreated, onChange });

  const defaultFlow: AdoptionFlow =
    fixedFlow ?? (canStrengthen ? 'explorer' : canContribute ? 'contributor' : '');

  const [welcomeInput, setWelcomeInput] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [headerExpanded, setHeaderExpanded] = useState(true);
  const [summaryExpanded, setSummaryExpanded] = useState(false);

  // Resizable right panel — shared across all workspace states.
  const [rightPanel, setRightPanel] = useState<RightPanelTab>('none');
  const [panelWidth, setPanelWidth] = useState(42); // percent of split container
  const [panelDragging, setPanelDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const [pathwayLookup, setPathwayLookup] = useState<Record<string, PathwayInfo>>({});
  useEffect(() => {
    fetch('/api/wiki-pathways')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: (PathwayInfo & { slug: string })[] | null) => {
        if (!data) return;
        const lookup: Record<string, PathwayInfo> = {};
        for (const { slug, ...info } of data) lookup[slug] = info;
        setPathwayLookup(lookup);
      })
      .catch(() => {});
  }, []);

  // Drag-to-resize: track mouse while dragging and clamp to 25–75%.
  useEffect(() => {
    if (!panelDragging) return;
    function onMove(e: MouseEvent) {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const rightPct = Math.round(((rect.right - e.clientX) / rect.width) * 100);
      setPanelWidth(Math.min(75, Math.max(25, rightPct)));
    }
    function onUp() {
      setPanelDragging(false);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [panelDragging]);

  // Auto-open panel when an explorer document is generated.
  useEffect(() => {
    if (explorerDoc.open === 'analysis') setRightPanel('analysis');
    else if (explorerDoc.open === 'plan') setRightPanel('summary');
  }, [explorerDoc.open]);

  // Auto-open panel when the contributor's pathway document is first generated.
  useEffect(() => {
    if (pathwayDoc.paneOpen) setRightPanel((prev) => (prev === 'none' ? 'document' : prev));
  }, [pathwayDoc.paneOpen]);

  const activeIntent: ExplorerIntent = conversation?.meta.intent ?? 'open';

  const selectedPathwayDocVersion =
    pathwayDoc.selectedVersionNumber !== null
      ? pathwayDoc.versions.find((v) => v.version_number === pathwayDoc.selectedVersionNumber)
      : undefined;
  const pathwayDocMarkdown =
    selectedPathwayDocVersion?.content ??
    pathwayDoc.content ??
    pathwayDoc.pathwayPublishedContent ??
    '';
  const pathwayDocPublishedSlug =
    pathwayDoc.publishedSlug ?? pathwayDoc.pathwayPublishedSlug;
  const isViewingLatestVersion = pathwayDoc.selectedVersionNumber === null;
  const latestVersionId = pathwayDoc.versions[0]?.id ?? null;
  const isLatestAssembled = latestVersionId !== null && latestVersionId === pathwayDoc.assembledDesignDocId;
  const isViewingPublishedVersion =
    !isViewingLatestVersion &&
    selectedPathwayDocVersion?.id === pathwayDoc.publishedDesignDocId;
  const pathwayDocStatus: 'draft' | 'awaiting' | 'published' = isViewingLatestVersion
    ? (!isLatestAssembled
        ? 'draft'
        : pathwayDoc.reviewRequested
          ? 'awaiting'
          : pathwayDoc.publishedDesignDocId && pathwayDoc.publishedDesignDocId === pathwayDoc.assembledDesignDocId
            ? 'published'
            : 'draft')
    : (isViewingPublishedVersion ? 'published' : 'draft');
  const publishedVersionDoc = pathwayDoc.versions.find((v) => v.id === pathwayDoc.publishedDesignDocId);
  const publishedVersionNumber = publishedVersionDoc?.version_number ?? null;

  // Which explorer doc content to show in the panel.
  const explorerDocType: DocType | null =
    rightPanel === 'analysis' ? 'analysis' : rightPanel === 'summary' ? 'plan' : null;
  const explorerDocMarkdown =
    rightPanel === 'analysis'
      ? (explorerDoc.analysis?.content ?? '')
      : rightPanel === 'summary'
        ? (explorerDoc.summary?.content ?? '')
        : '';

  function openRightPanel(tab: Exclude<RightPanelTab, 'none'>) {
    setRightPanel(tab);
    if (tab === 'analysis') openExplorerDocument('analysis');
    if (tab === 'summary') openExplorerDocument('plan');
    if (tab === 'document') openPathwayDocument();
  }

  function closeRightPanel() {
    if (rightPanel === 'analysis' || rightPanel === 'summary') closeExplorerDocument();
    if (rightPanel === 'document') closePathwayDocument();
    setRightPanel('none');
  }

  function handleDividerMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    setPanelDragging(true);
  }

  function handleWelcomeFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length) handleAttachFiles(files, defaultFlow, activeIntent);
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  }
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDragging(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) handleAttachFiles(files, defaultFlow, activeIntent);
  }

  const preChat: {
    opening: Message;
    flow: AdoptionFlow;
    intent: ExplorerIntent;
    onBackToMenu?: () => void;
  } | null = conversation
    ? null
    : fixedFlow === 'contributor'
      ? { opening: CONTRIBUTOR_OPENING_MESSAGE, flow: 'contributor', intent: '' }
      : fixedFlow === 'explorer'
        ? { opening: STRENGTHEN_OPENING_MESSAGE, flow: 'explorer', intent: 'open' }
        : null;

  // Shared right panel content — no tabs, just a × close button at top.
  // The workspace header buttons (Grid / View Document / Analysis / Summary)
  // switch content; the panel itself doesn't need a secondary nav.
  function renderRightPanel(grid: typeof EMPTY_GRID) {
    if (rightPanel === 'none') return null;
    return (
      <>
        {/* Drag handle / resize divider */}
        <div
          className="group relative z-10 w-1 shrink-0 cursor-col-resize bg-navy/10 transition-colors hover:bg-coral/30 active:bg-coral/50"
          onMouseDown={handleDividerMouseDown}
        >
          {/* Wider invisible hit area */}
          <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
        </div>

        {/* Right panel */}
        <div
          className="flex shrink-0 flex-col overflow-hidden border-l border-navy/10 bg-paper"
          style={{ width: `${panelWidth}%` }}
        >
          {/* Minimal header: close button — only for 'grid', which has no dedicated header.
              'document', 'analysis', 'summary' panels all have their own full headers. */}
          {rightPanel === 'grid' && (
            <div className="flex shrink-0 items-center justify-end border-b border-navy/10 px-3 py-2">
              <button
                onClick={closeRightPanel}
                aria-label="Close panel"
                className="rounded px-1.5 py-0.5 text-lg leading-none text-ink-soft transition hover:bg-navy/8 hover:text-navy"
              >
                ×
              </button>
            </div>
          )}

          {/* Panel content */}
          {rightPanel === 'grid' && (
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              <div className="mb-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-coral">
                  Coverage grid
                </p>
                <p className="mt-0.5 text-xs text-ink-soft">
                  Coverage across the four dimensions and stages.
                </p>
              </div>
              <HeatmapGrid grid={grid} />
            </div>
          )}

          {rightPanel === 'document' && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <PathwayDocumentPane
                markdown={pathwayDocMarkdown}
                loading={pathwayDoc.loading}
                error={pathwayDoc.error}
                onPublish={requestPublishConsent}
                status={pathwayDocStatus}
                versions={(() => {
                  const all = pathwayDoc.versions;
                  if (all.length === 0) return all;
                  const latest = all[0];
                  if (!pathwayDoc.publishedDesignDocId) return [latest];
                  const published = all.find((v) => v.id === pathwayDoc.publishedDesignDocId);
                  if (!published || published.id === latest.id) return [latest];
                  return [latest, published];
                })()}
                selectedVersionNumber={pathwayDoc.selectedVersionNumber}
                latestVersionNumber={pathwayDoc.versionNumber}
                publishedVersionNumber={publishedVersionNumber}
                onSelectVersion={selectPathwayDocVersion}
                onClose={closeRightPanel}
                deploymentName={conversation?.meta.name}
                pathwayId={conversation?.meta.pathwayId || undefined}
                toolkitAssetsRefreshKey={toolkitAssetsVersion}
              />
            </div>
          )}

          {(rightPanel === 'analysis' || rightPanel === 'summary') && explorerDocType && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <AdoptionPlanModal
                mode="panel"
                title={EXPLORER_DOC_LABELS[explorerDocType].title}
                markdown={explorerDocMarkdown}
                loading={explorerDoc.generating === explorerDocType}
                error={explorerDoc.error}
                deploymentName={conversation?.meta.name ?? ''}
                onClose={closeRightPanel}
                filenameSuffix={EXPLORER_DOC_LABELS[explorerDocType].filenameSuffix}
                loadingLabel={EXPLORER_DOC_LABELS[explorerDocType].loadingLabel}
              />
            </div>
          )}
        </div>
      </>
    );
  }

  // ── preChat: explorer welcome hero (full-width, no side panel) ─────────────
  if (preChat?.flow === 'explorer') {
    const preChatFlow = preChat.flow;
    const preChatIntent = preChat.intent;
    const hasBlockingAttachment = pendingAttachments.some((a) => a.state !== 'ready');
    const hasReadyAttachment = pendingAttachments.some((a) => a.state === 'ready');
    const canStart =
      !loading && !hasBlockingAttachment && (welcomeInput.trim().length > 0 || hasReadyAttachment);

    function handleStart() {
      if (!canStart) return;
      const text = welcomeInput.trim();
      setWelcomeInput('');
      void handleUserSend(text, preChatFlow, preChatIntent);
    }

    return (
      <div
        className="relative flex flex-1 flex-col overflow-hidden bg-paper"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-4 border-dashed border-coral bg-paper/90">
            <p className="text-sm font-medium text-ink-soft">Drop files to share them</p>
          </div>
        )}
        <div
          className="relative flex min-w-0 flex-1 items-center justify-center overflow-y-auto bg-paper p-5 sm:p-8"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleStart();
            }
          }}
        >
          <div className="w-full max-w-2xl animate-fade-in-up text-center">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-coral">
              Analyse your own adoption
            </p>
            <h1 className="mt-4 font-display text-3xl font-medium leading-[1.15] tracking-tight text-navy sm:text-4xl">
              What brings you to the{' '}
              <span className="font-serif italic text-coral">Cube</span>?
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-ink-soft">
              {WHAT_THE_CUBE_DOES}
            </p>

            {pendingAttachments.length > 0 && (
              <div className="mx-auto mt-6 flex max-w-2xl flex-col gap-1 text-left">
                {pendingAttachments.map((a) => (
                  <div
                    key={a.id}
                    className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                      a.state === 'error'
                        ? 'border-coral/40 bg-coral-soft text-coral'
                        : 'border-navy/15 bg-white text-ink-soft'
                    }`}
                  >
                    <span className="truncate">
                      {a.state === 'reading' ? '⏳' : a.state === 'error' ? '⚠️' : '📎'} {a.name}
                      {a.state === 'error' && a.error ? ` — ${a.error}` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(a.id)}
                      disabled={a.state === 'reading'}
                      className="flex-shrink-0 text-ink-soft transition hover:text-navy disabled:opacity-30"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="glow-input mx-auto mt-6 flex max-w-2xl items-end gap-2 rounded-2xl border border-navy/10 bg-white p-2 text-left">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.xlsx,.xls,.pptx,.txt,.md,.png,.jpg,.jpeg,.gif,.webp"
                className="hidden"
                onChange={handleWelcomeFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2 text-ink-soft transition hover:text-navy"
                aria-label="Attach files"
              >
                📎
              </button>
              <textarea
                className="min-h-12 flex-1 resize-none bg-transparent py-2 text-sm text-ink placeholder-ink-soft focus:outline-none"
                rows={2}
                value={welcomeInput}
                onChange={(e) => setWelcomeInput(e.target.value)}
                placeholder="Describe your adoption, ask a question, or attach a document…"
                disabled={loading}
              />
              <VoiceInputButton value={welcomeInput} onChange={setWelcomeInput} disabled={loading} className="h-10 w-10" />
              <button
                type="button"
                onClick={handleStart}
                disabled={!canStart}
                className="rounded-xl bg-navy px-4 py-2 text-sm font-medium text-white transition hover:bg-coral disabled:opacity-40"
              >
                Start
              </button>
            </div>
            <p className="mt-3 text-xs text-ink-soft">You can upload documents after starting too.</p>
          </div>
        </div>
      </div>
    );
  }

  // ── preChat: contributor — header + chat + optional grid side panel ─────────
  if (preChat?.flow === 'contributor') {
    const preChatFlow = preChat.flow;
    const preChatIntent = preChat.intent;

    return (
      <div
        className="relative flex flex-1 overflow-hidden bg-paper"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-4 border-dashed border-coral bg-paper/90">
            <p className="text-sm font-medium text-ink-soft">Drop files to share them</p>
          </div>
        )}

        {/* Split container — header lives inside the left column */}
        <div
          ref={containerRef}
          className={`flex flex-1 overflow-hidden ${panelDragging ? 'cursor-col-resize select-none' : ''}`}
        >
          {/* Left: header + chat */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-navy/10 py-3">
              <div className="mx-auto max-w-5xl px-4 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {preChat.onBackToMenu ? (
                    <button
                      type="button"
                      onClick={preChat.onBackToMenu}
                      className={BACK_CONTROL_CLASS}
                    >
                      {PICK_INTENT_LABEL}
                    </button>
                  ) : (
                    <BackControl onBack={onBack} />
                  )}
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <button
                      onClick={() => setFilesOpen(true)}
                      className="rounded-lg border border-navy/15 px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:border-coral hover:text-coral"
                    >
                      📎 Files
                    </button>
                    <button
                      onClick={() =>
                        rightPanel === 'grid' ? closeRightPanel() : openRightPanel('grid')
                      }
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:border-coral hover:text-coral ${
                        rightPanel === 'grid'
                          ? 'border-coral bg-coral-soft text-coral'
                          : 'border-navy/15 text-ink-soft'
                      }`}
                    >
                      ▦ Grid
                    </button>
                  </div>
                </div>
                {pathwayPreview?.title && (
                  <>
                    <h2 className="mt-2 font-display text-lg font-medium tracking-tight text-navy">
                      {pathwayPreview.title}
                    </h2>
                    {pathwayPreview.sector && (
                      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-soft">
                        {pathwayPreview.sector}
                      </p>
                    )}
                    {pathwayPreview.description && (
                      <p className="mt-2 max-h-20 overflow-y-auto text-sm leading-relaxed text-ink">
                        {pathwayPreview.description}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* min-h-0 + flex-1 so ChatPanel's h-full resolves to remaining space, not full column height */}
            <div className="min-h-0 flex-1 overflow-hidden">
              <ChatPanel
                messages={[preChat.opening]}
                onSend={(text) => handleUserSend(text, preChatFlow, preChatIntent)}
                onAttachFiles={(files) => handleAttachFiles(files, preChatFlow, preChatIntent)}
                attachAccept={CONTRIBUTOR_ATTACH_ACCEPT}
                onRemoveAttachment={removeAttachment}
                pendingAttachments={pendingAttachments}
                loading={loading}
                generatingDoc={explorerDoc.generating !== null}
                writingDraft={pathwayDoc.loading}
                placeholder="Ask, share, or think out loud…"
                pathwayLookup={pathwayLookup}
                hideAccuracyDisclaimer
              />
            </div>
          </div>

          {renderRightPanel(EMPTY_GRID)}

          {filesOpen && (
            <div
              className="fixed inset-0 z-40 flex items-end bg-navy/40 p-0 md:items-center md:justify-center md:p-4"
              onClick={() => setFilesOpen(false)}
            >
              <div
                className="max-h-[70vh] w-full overflow-y-auto rounded-t-2xl bg-paper p-4 md:max-w-md md:rounded-2xl md:shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-2 flex justify-end">
                  <button
                    onClick={() => setFilesOpen(false)}
                    aria-label="Close"
                    className="px-1 text-lg leading-none text-ink-soft transition hover:text-navy"
                  >
                    ×
                  </button>
                </div>
                <AttachmentsPanel
                  attachments={pendingAttachments}
                  onAttachFiles={(files) => handleAttachFiles(files, preChatFlow, preChatIntent)}
                  onRemoveAttachment={removeAttachment}
                  accept={CONTRIBUTOR_ATTACH_ACCEPT}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── No conversation yet (generic welcome / role-picker screen) ──────────────
  if (!conversation) {
    const hasBlockingAttachment = pendingAttachments.some((a) => a.state !== 'ready');
    const hasReadyAttachment = pendingAttachments.some((a) => a.state === 'ready');
    const canSend =
      !loading &&
      !hasBlockingAttachment &&
      (welcomeInput.trim().length > 0 || hasReadyAttachment);

    function handleWelcomeSend(flow: AdoptionFlow, intent: ExplorerIntent = '') {
      if (!canSend) return;
      const text = welcomeInput.trim();
      setWelcomeInput('');
      void handleUserSend(text, flow, intent);
    }

    function handleWelcomeKey(e: React.KeyboardEvent) {
      if (e.key !== 'Enter' || e.shiftKey) return;
      if (!defaultFlow) return;
      e.preventDefault();
      handleWelcomeSend(defaultFlow, fixedFlow === 'explorer' ? 'open' : '');
    }

    return (
      <div
        className="relative flex flex-1 flex-col items-center justify-center bg-paper p-4 sm:p-8"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-4 border-dashed border-coral bg-paper/90">
            <p className="text-sm font-medium text-ink-soft">Drop files to share them</p>
          </div>
        )}

        <div className="w-full max-w-2xl animate-fade-in-up">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-coral">
            {fixedFlow === 'contributor' ? 'Contribute a Pathway' : 'Diffusion Cube'}
          </p>
          <h1 className="font-display mt-4 text-3xl font-medium leading-[1.15] tracking-tight text-navy sm:text-4xl">
            {fixedFlow === 'contributor' ? (
              <>
                Turn your deployment into a{' '}
                <span className="font-serif italic text-coral">pathway</span>
              </>
            ) : (
              <>
                What brings you to the{' '}
                <span className="font-serif italic text-coral">Cube</span>?
              </>
            )}
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-soft">
            {fixedFlow === 'contributor'
              ? "Share the write-up you have. I'll remap it into the four-dimension pathway format, flag the open gaps, and help you push it to the wiki once you're ready."
              : WHAT_THE_CUBE_DOES}
          </p>

          <div className="mt-8">
            {pendingAttachments.length > 0 && (
              <div className="mb-2 flex flex-col gap-1">
                {pendingAttachments.map((a) => (
                  <div
                    key={a.id}
                    className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                      a.state === 'error'
                        ? 'border-coral/40 bg-coral-soft text-coral'
                        : 'border-navy/15 bg-white text-ink-soft'
                    }`}
                  >
                    <span className="truncate">
                      {a.state === 'reading' ? '⏳' : a.state === 'error' ? '⚠️' : '📎'} {a.name}
                      {a.state === 'error' && a.error ? ` — ${a.error}` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(a.id)}
                      disabled={a.state === 'reading'}
                      className="flex-shrink-0 text-ink-soft transition hover:text-navy disabled:opacity-30"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="glow-input flex items-end gap-2 rounded-2xl border border-navy/10 bg-white p-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.xlsx,.xls,.pptx,.txt,.md,.png,.jpg,.jpeg,.gif,.webp"
                className="hidden"
                onChange={handleWelcomeFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2 text-ink-soft transition hover:text-navy"
                aria-label="Attach files"
              >
                📎
              </button>
              <textarea
                className="flex-1 resize-none bg-transparent py-2 text-sm text-ink placeholder-ink-soft focus:outline-none"
                rows={1}
                value={welcomeInput}
                onChange={(e) => setWelcomeInput(e.target.value)}
                onKeyDown={handleWelcomeKey}
                placeholder="Describe your adoption, or drop a document…"
                disabled={loading}
              />
              <VoiceInputButton value={welcomeInput} onChange={setWelcomeInput} disabled={loading} className="h-10 w-10" />
              {fixedFlow && (
                <button
                  onClick={() =>
                    handleWelcomeSend(fixedFlow, fixedFlow === 'explorer' ? 'open' : '')
                  }
                  disabled={!canSend}
                  className="rounded-xl bg-navy px-4 py-2 text-sm font-medium text-white transition hover:bg-coral disabled:opacity-40"
                >
                  Start
                </button>
              )}
            </div>

            {!fixedFlow &&
              (canStrengthen || canContribute ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {canContribute && (
                    <button
                      onClick={() => handleWelcomeSend('contributor')}
                      disabled={!canSend}
                      className="rounded-xl border border-navy/20 px-4 py-2 text-sm font-medium text-navy transition hover:border-coral hover:text-coral disabled:opacity-40"
                    >
                      Contribute a pathway
                    </button>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-xs text-ink-soft">
                  Ask an admin to grant you Explorer or Contributor access to get started.
                </p>
              ))}
            <p className="mt-3 text-center text-xs text-ink-soft">
              Cube can make mistakes. Verify important information.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Active conversation ─────────────────────────────────────────────────────
  const flow = conversation.meta.flow;
  const intentDef = getExplorerIntent(conversation.meta.intent);
  const showDeploymentHeader =
    flow !== 'explorer' || !intentDef || intentDef.tracksDeployment;

  const conversationOpeningMessage: Message | null =
    conversation.meta.flow === 'contributor'
      ? CONTRIBUTOR_OPENING_MESSAGE
      : conversation.meta.flow === 'explorer'
        ? STRENGTHEN_OPENING_MESSAGE
        : null;

  const displayMessages = conversationOpeningMessage
    ? [conversationOpeningMessage, ...conversation.messages]
    : conversation.messages;

  return (
    <div
      className="relative flex flex-1 overflow-hidden bg-paper"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-4 border-dashed border-coral bg-paper/90">
          <p className="text-sm font-medium text-ink-soft">Drop files to share them</p>
        </div>
      )}

      {/* Split container: left column (header + chat) + right panel */}
      <div
        ref={containerRef}
        className={`flex flex-1 overflow-hidden ${panelDragging ? 'cursor-col-resize select-none' : ''}`}
      >
        {/* ── Left column: workspace header + chat ── */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Workspace header lives inside the left column so it resizes
              with the chat when the panel opens — keeps title aligned. */}
          <div className="shrink-0 border-b border-navy/10 py-3">
            <div className="mx-auto max-w-5xl px-4 sm:px-6">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                {flow === 'contributor' ? (
                  <BackControl onBack={onBack} />
                ) : flow === 'explorer' && onBack ? (
                  <button type="button" onClick={onBack} className={BACK_CONTROL_CLASS}>
                    <span aria-hidden className="transition-transform">←</span>{' '}
                    {backLabel.replace(/^←\s*/, '')}
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button
                    onClick={() => setFilesOpen(true)}
                    className="rounded-lg border border-navy/15 px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:border-coral hover:text-coral"
                  >
                    📎 Files
                  </button>
                  <button
                    onClick={() =>
                      rightPanel === 'grid' ? closeRightPanel() : openRightPanel('grid')
                    }
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:border-coral hover:text-coral ${
                      rightPanel === 'grid'
                        ? 'border-coral bg-coral-soft text-coral'
                        : 'border-navy/15 text-ink-soft'
                    }`}
                  >
                    ▦ Grid
                  </button>
                  {flow === 'contributor' && (
                    <button
                      onClick={() =>
                        rightPanel === 'document'
                          ? closeRightPanel()
                          : openRightPanel('document')
                      }
                      disabled={!pathwayDocMarkdown}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:border-coral hover:text-coral disabled:opacity-40 disabled:hover:border-navy/15 disabled:hover:text-ink-soft ${
                        rightPanel === 'document'
                          ? 'border-coral bg-coral-soft text-coral'
                          : 'border-navy/15 text-ink-soft'
                      }`}
                    >
                      View Document
                    </button>
                  )}
                  {flow === 'explorer' && explorerDoc.analysis && (
                    <button
                      onClick={() =>
                        rightPanel === 'analysis'
                          ? closeRightPanel()
                          : openRightPanel('analysis')
                      }
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:border-coral hover:text-coral ${
                        rightPanel === 'analysis'
                          ? 'border-coral bg-coral-soft text-coral'
                          : 'border-navy/15 text-ink-soft'
                      }`}
                    >
                      Analysis Document
                    </button>
                  )}
                  {flow === 'explorer' && explorerDoc.summary && (
                    <button
                      onClick={() =>
                        rightPanel === 'summary'
                          ? closeRightPanel()
                          : openRightPanel('summary')
                      }
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:border-coral hover:text-coral ${
                        rightPanel === 'summary'
                          ? 'border-coral bg-coral-soft text-coral'
                          : 'border-navy/15 text-ink-soft'
                      }`}
                    >
                      Executive Summary
                    </button>
                  )}
                </div>
              </div>

              {showDeploymentHeader && (
                <>
                  <button
                    onClick={() => setHeaderExpanded((v) => !v)}
                    className="mt-0.5 flex items-center gap-1.5 text-left"
                    aria-expanded={headerExpanded}
                  >
                    <h2 className="font-display text-lg font-medium tracking-tight text-navy">
                      {conversation.meta.name || 'New adoption'}
                    </h2>
                    <span
                      className={`text-ink-soft transition-transform ${headerExpanded ? 'rotate-180' : ''}`}
                      aria-hidden
                    >
                      ▾
                    </span>
                  </button>
                  {headerExpanded && (
                    <>
                      {/* Sector · geography · stage as quiet tags — same mono
                          treatment as the Contribute cards' sector line. */}
                      {[conversation.meta.sector, conversation.meta.geography, conversation.meta.stage].some(Boolean) && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {[conversation.meta.sector, conversation.meta.geography].filter(Boolean).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-navy/5 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft"
                            >
                              {tag}
                            </span>
                          ))}
                          {conversation.meta.stage && (
                            <span className="rounded-full bg-coral-soft px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-coral">
                              {conversation.meta.stage}
                            </span>
                          )}
                        </div>
                      )}
                      {conversation.meta.summary && (
                        <div className="mt-2 max-w-3xl">
                          <p
                            className={`whitespace-pre-line text-[13px] leading-relaxed text-ink-soft ${
                              summaryExpanded ? 'max-h-40 overflow-y-auto' : 'line-clamp-2'
                            }`}
                          >
                            {conversation.meta.summary}
                          </p>
                          {conversation.meta.summary.length > 160 && (
                            <button
                              type="button"
                              onClick={() => setSummaryExpanded((v) => !v)}
                              className="mt-0.5 text-xs font-medium text-navy/70 transition hover:text-coral"
                            >
                              {summaryExpanded ? 'Show less' : 'Show more'}
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Chat — min-h-0 + flex-1 so ChatPanel's h-full resolves to remaining space after header */}
          <div className="min-h-0 flex-1 overflow-hidden">
            <ChatPanel
              messages={displayMessages}
              onSend={handleUserSend}
              onAttachFiles={handleAttachFiles}
              attachAccept={flow === 'contributor' ? CONTRIBUTOR_ATTACH_ACCEPT : ATTACH_ACCEPT}
              onRemoveAttachment={removeAttachment}
              pendingAttachments={pendingAttachments}
              loading={loading}
              generatingDoc={explorerDoc.generating !== null}
              writingDraft={pathwayDoc.loading}
              placeholder="Ask, share, or think out loud…"
              onOpenPathwayDocument={
                flow === 'contributor' ? () => openRightPanel('document') : undefined
              }
              onOpenExplorerDocument={
                flow === 'explorer'
                  ? (type: DocType) => {
                      openExplorerDocument(type);
                      setRightPanel(type === 'analysis' ? 'analysis' : 'summary');
                    }
                  : undefined
              }
              pathwayLookup={pathwayLookup}
              onToolkitAssetConsent={flow === 'contributor' ? answerToolkitAssetConsent : undefined}
              hasToolkitAssetFile={hasToolkitAssetFile}
              resourceReviewActions={
                flow === 'contributor'
                  ? {
                      decide: decideResourceItem,
                      attach: attachForResourceItem,
                      link: linkForResourceItem,
                      finish: (reviewId) => void finishResourceReview(reviewId),
                      rememberFile: rememberToolkitAssetFile,
                    }
                  : undefined
              }
              onPublishConsent={flow === 'contributor' ? answerPublishConsent : undefined}
              hideAccuracyDisclaimer={flow === 'contributor'}
            />
          </div>
        </div>

        {/* ── Right panel (full height, resizable) ── */}
        {renderRightPanel(conversation.grid)}

        {filesOpen && (
          <div
            className="fixed inset-0 z-40 flex items-end bg-navy/40 p-0 md:items-center md:justify-center md:p-4"
            onClick={() => setFilesOpen(false)}
          >
            <div
              className="max-h-[70vh] w-full overflow-y-auto rounded-t-2xl bg-paper p-4 md:max-w-md md:rounded-2xl md:shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-2 flex justify-end">
                <button
                  onClick={() => setFilesOpen(false)}
                  aria-label="Close"
                  className="px-1 text-lg leading-none text-ink-soft transition hover:text-navy"
                >
                  ×
                </button>
              </div>
              <AttachmentsPanel
                attachments={pendingAttachments}
                uploadedFileNames={extractUploadedFileNames(conversation.messages)}
                viewableFiles={
                  flow === 'contributor'
                    ? Object.fromEntries(
                        conversation.messages.flatMap((m) => {
                          const c = m.toolkitAssetConsent;
                          return c?.status === 'shared' && c.assetId && 'fileName' in c.candidate.source
                            ? [[c.candidate.source.fileName, c.assetId]]
                            : [];
                        })
                      )
                    : undefined
                }
                onAttachFiles={handleAttachFiles}
                onRemoveAttachment={removeAttachment}
                accept={flow === 'contributor' ? CONTRIBUTOR_ATTACH_ACCEPT : ATTACH_ACCEPT}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
