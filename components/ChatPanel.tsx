'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { downloadPlanAsPdf } from '@/lib/adoption-plan-pdf';
import {
  ANALYSIS_DOC_MARKER,
  DELIVERABLE_START,
  DELIVERABLE_END,
  EXEC_SUMMARY_MARKER,
  PATHWAY_DOC_MARKER,
} from '@/lib/grid-update';
import type { DocType } from '@/lib/design-documents';
import { ATTACH_ACCEPT } from '@/lib/extract-text';
import type {
  PublishConsentState,
  ResourceReviewState,
  ToolkitAssetCandidate,
  ToolkitAssetConsentState,
  ToolkitAssetMention,
} from '@/lib/toolkit-assets';
import ToolkitAssetConsentCard from '@/components/ToolkitAssetConsentCard';
import ResourceReviewCard from '@/components/ResourceReviewCard';
import PublishConsentCard from '@/components/PublishConsentCard';
import ToolkitAssetCards from '@/components/ToolkitAssetCards';
import VoiceInputButton from '@/components/VoiceInputButton';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  // Shown in the chat bubble instead of `content` — used for uploads, where
  // `content` carries the full extracted document text sent to the agent.
  displayContent?: string;
  // Sent to the model but never shown: an app-authored note in the
  // contributor's turn (e.g. "the first draft is ready") that lets the
  // companion speak next without the contributor typing anything.
  hidden?: boolean;
  // Set when the message carries one or more uploaded images — `content` then
  // holds a short instruction (plus any text-attachment content) and this
  // carries the actual bytes sent to the model.
  images?: Array<{ mediaType: string; base64: string }>;
  // Set transiently (never persisted) while a <deliverable> block is still
  // streaming in on the server — see adoption-conversation.ts's sendMessage,
  // which freezes the visible content and sets this instead of live-typing
  // the document out. Shows a "Generating your document…" placeholder.
  generatingDoc?: boolean;
  // Pathway slugs this assistant message drew on — parsed from <grid_update>
  // and stored alongside the message so source attribution chips can be
  // rendered below the bubble on reload as well as first display.
  pathwaysReferenced?: string[];
  // Contributor flow: a client-constructed message carrying a toolkit-asset
  // consent card (see TOOLKIT_ASSET_CONSENT_MARKER). Persisted with the
  // conversation so the outcome survives reload.
  toolkitAssetConsent?: ToolkitAssetConsentState;
  // Contributor flow, on the companion's reply: files/links it judged
  // reusable and things the material named but didn't attach (both from
  // <grid_update>). Collected into the resource review card — kept here so
  // the first review (shown after the questions that follow the first
  // draft) can gather everything found earlier, across reloads.
  toolkitAssetCandidates?: ToolkitAssetCandidate[];
  toolkitAssetMentions?: ToolkitAssetMention[];
  // Contributor flow: client-constructed resource review card
  // (RESOURCE_REVIEW_MARKER) and "may this be published?" card
  // (PUBLISH_CONSENT_MARKER).
  resourceReview?: ResourceReviewState;
  publishConsent?: PublishConsentState;
  // Explorer flow: ids of published toolkit assets this assistant message
  // offered (from <grid_update>) — rendered as download cards under it.
  toolkitAssetsReferenced?: string[];
}

// Legacy marker from an earlier design where the model signalled a grid
// snapshot inline in chat, once per qualifying turn. The grid now renders as
// a single persistent element in AdoptionWorkspace's header, always current
// from live grid state, so nothing needs to trigger it from chat anymore —
// this is kept only to strip the literal string out of any older stored
// messages that still contain it, so it never shows as raw text.
const CUBE_GRID_MARKER = '<cube_grid/>';

// A file the user has attached but not sent yet — staged (see AttachmentsPanel)
// until they press Enter, at which point it's folded into one user message.
export interface PendingAttachment {
  id: string;
  name: string;
  state: 'reading' | 'ready' | 'error';
  error?: string;
}

// Renders **bold** spans; everything else is shown as plain text.
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  );
}

// Inline parser supporting **bold** and *italic*, including one nested
// inside the other (e.g. the model's own italic "closing line" wrapping a
// **bolded pathway name**). A single combined regex can't do this correctly:
// its italic branch's [^*]+ can't span a nested ** run, so it closes the
// italic at the nested bold's first star and shreds both spans. This scans
// character-by-character instead, always preferring ** at a given position,
// and — when opening an italic span — skips over any nested **...** run
// while hunting for the italic's own closing single star, then recurses on
// each span's inner text so further nesting still resolves correctly.
function parseChatInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let buf = '';
  const flush = () => {
    if (buf) nodes.push(buf);
    buf = '';
  };

  function findItalicClose(from: number): number {
    let j = from;
    while (j < text.length) {
      if (text[j] === '*' && text[j + 1] === '*') {
        const boldEnd = text.indexOf('**', j + 2);
        if (boldEnd === -1) return -1; // unterminated nested bold — bail, treat '*' as literal
        j = boldEnd + 2;
        continue;
      }
      if (text[j] === '*') return j;
      j++;
    }
    return -1;
  }

  // Trailing punctuation that reads as sentence structure, not part of the
  // URL itself (a link at the end of a clause like "...test: https://x.com.")
  // shouldn't swallow the period into the href).
  const URL_TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

  function renderLink(key: React.Key, label: string, href: string): React.ReactNode {
    return (
      <a
        key={key}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-coral underline decoration-coral/40 underline-offset-2 hover:decoration-coral"
      >
        {label}
      </a>
    );
  }

  let i = 0;
  while (i < text.length) {
    if (text[i] === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end !== -1 && end > i + 2) {
        flush();
        nodes.push(<strong key={i}>{parseChatInline(text.slice(i + 2, end))}</strong>);
        i = end + 2;
        continue;
      }
    } else if (text[i] === '*') {
      const end = findItalicClose(i + 1);
      if (end !== -1 && end > i + 1) {
        flush();
        nodes.push(<em key={i}>{parseChatInline(text.slice(i + 1, end))}</em>);
        i = end + 1;
        continue;
      }
    } else if (text[i] === '[') {
      // [label](url) — the one link syntax the model is asked to use for
      // proactively surfacing external resources (see the "External
      // resources" section of explorerSystemPrompt).
      const labelEnd = text.indexOf(']', i + 1);
      if (labelEnd !== -1 && text[labelEnd + 1] === '(') {
        const urlEnd = text.indexOf(')', labelEnd + 2);
        if (urlEnd !== -1) {
          const label = text.slice(i + 1, labelEnd);
          const href = text.slice(labelEnd + 2, urlEnd);
          if (label && /^https?:\/\//.test(href)) {
            flush();
            nodes.push(renderLink(i, label, href));
            i = urlEnd + 1;
            continue;
          }
        }
      }
    } else if (text.slice(i, i + 8) === 'https://' || text.slice(i, i + 7) === 'http://') {
      // A bare URL the model pasted without [label](...) wrapping — still
      // worth making clickable rather than showing as inert text.
      const match = text.slice(i).match(/^https?:\/\/\S+/);
      if (match) {
        let raw = match[0];
        const trailing = raw.match(URL_TRAILING_PUNCTUATION);
        if (trailing) raw = raw.slice(0, raw.length - trailing[0].length);
        if (raw.length > 8) {
          flush();
          nodes.push(renderLink(i, raw, raw));
          i += raw.length;
          continue;
        }
      }
    }
    buf += text[i];
    i++;
  }
  flush();
  return nodes;
}

// Full markdown renderer for assistant messages: ##/### headings, - bullets,
// --- dividers, **bold**, *italic*, paragraphs. Does NOT use whitespace-pre-wrap.
function renderChatMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let paraLines: string[] = [];
  let key = 0;

  function flushPara() {
    if (paraLines.length === 0) return;
    const joined = paraLines.join(' ').trim();
    if (joined) nodes.push(<p key={key++} className="mb-1.5">{parseChatInline(joined)}</p>);
    paraLines = [];
  }

  function flushList() {
    if (listItems.length === 0) return;
    nodes.push(
      <ul key={key++} className="list-disc ml-5 mb-2 space-y-0.5">
        {listItems}
      </ul>
    );
    listItems = [];
  }

  for (const line of lines) {
    if (line.startsWith('### ')) {
      flushPara(); flushList();
      nodes.push(
        <h3 key={key++} className="font-semibold text-navy mt-4 mb-1 first:mt-0">
          {parseChatInline(line.slice(4))}
        </h3>
      );
    } else if (line.startsWith('## ')) {
      flushPara(); flushList();
      nodes.push(
        <h2 key={key++} className="font-semibold text-navy text-lg mt-4 mb-1 first:mt-0">
          {parseChatInline(line.slice(3))}
        </h2>
      );
    } else if (line.trimStart().startsWith('- ')) {
      flushPara();
      listItems.push(<li key={key++}>{parseChatInline(line.trimStart().slice(2))}</li>);
    } else if (line === '---') {
      flushPara(); flushList();
      nodes.push(<hr key={key++} className="border-navy/10 my-3" />);
    } else if (line.trim() === '') {
      flushPara(); flushList();
    } else {
      flushList();
      paraLines.push(line);
    }
  }
  flushPara();
  flushList();

  return <div className="space-y-0">{nodes}</div>;
}

function extractDeliverable(text: string): { before: string; markdown: string; after: string } | null {
  const startIdx = text.indexOf(DELIVERABLE_START);
  if (startIdx === -1) return null;
  const endIdx = text.indexOf(DELIVERABLE_END, startIdx);
  if (endIdx === -1) return null;
  return {
    before: text.slice(0, startIdx).trim(),
    markdown: text.slice(startIdx + DELIVERABLE_START.length, endIdx).trim(),
    after: text.slice(endIdx + DELIVERABLE_END.length).trim(),
  };
}

function deliverableTitle(markdown: string): string {
  return markdown.match(/^##\s+(.+)$/m)?.[1].trim() || 'Adoption Report';
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'report';
}

function DeliverableCard({ markdown }: { markdown: string }) {
  const title = deliverableTitle(markdown);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-navy/15 bg-paper-dim px-4 py-3">
      <span className="text-xl" aria-hidden>
        📄
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-navy">{title}</p>
        <p className="text-xs text-ink-soft">Ready to download</p>
      </div>
      <button
        type="button"
        onClick={() => downloadPlanAsPdf(markdown, `${slugify(title)}.pdf`)}
        className="flex-shrink-0 rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white transition hover:bg-coral"
      >
        Download PDF
      </button>
    </div>
  );
}

// The card a client-constructed doc message embeds — the Contributor flow's
// pathway document (see lib/adoption-conversation.ts's
// appendPathwayDocMessage/appendPublishOutcomeMessage) and the Explorer
// flow's Analysis Document / Executive Summary (appendExplorerDocMessage).
// Always reopens whatever is currently stored; it never regenerates anything.
function DocCard({ title, cta, onOpen }: { title: string; cta: string; onOpen: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-navy/15 bg-paper-dim px-4 py-3">
      <span className="text-xl" aria-hidden>
        📄
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-navy">{title}</p>
        <p className="text-xs text-ink-soft">Click to view</p>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="flex-shrink-0 rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white transition hover:bg-coral"
      >
        {cta}
      </button>
    </div>
  );
}

// Splits a message on the first document marker it carries and renders the
// real grid / download card / doc card in place — surrounding text still goes
// through renderInlineMarkdown. A message only ever carries one of these.
function renderMessageContent(
  text: string,
  onOpenPathwayDocument: (() => void) | undefined,
  onOpenExplorerDocument: ((docType: DocType) => void) | undefined
): React.ReactNode[] {
  const deliverable = extractDeliverable(text);
  if (deliverable) {
    const nodes: React.ReactNode[] = [];
    if (deliverable.before) nodes.push(<div key="before">{renderChatMarkdown(deliverable.before)}</div>);
    nodes.push(<DeliverableCard key="card" markdown={deliverable.markdown} />);
    if (deliverable.after) nodes.push(<div key="after">{renderChatMarkdown(deliverable.after)}</div>);
    return nodes;
  }

  const docMarker = onOpenPathwayDocument
    ? { marker: PATHWAY_DOC_MARKER, title: 'Pathway Document', cta: 'View Pathway Document', open: onOpenPathwayDocument }
    : onOpenExplorerDocument && text.includes(ANALYSIS_DOC_MARKER)
      ? {
          marker: ANALYSIS_DOC_MARKER,
          title: 'Analysis Document',
          cta: 'View Analysis Document',
          open: () => onOpenExplorerDocument('analysis'),
        }
      : onOpenExplorerDocument && text.includes(EXEC_SUMMARY_MARKER)
        ? {
            marker: EXEC_SUMMARY_MARKER,
            title: 'Executive Summary',
            cta: 'View Executive Summary',
            open: () => onOpenExplorerDocument('plan'),
          }
        : null;

  if (docMarker && text.includes(docMarker.marker)) {
    const segments = text.split(docMarker.marker);
    const nodes: React.ReactNode[] = [];
    segments.forEach((segment, i) => {
      const trimmed = segment.trim();
      if (trimmed) nodes.push(<div key={`t${i}`}>{renderChatMarkdown(trimmed)}</div>);
      if (i < segments.length - 1)
        nodes.push(<DocCard key={`d${i}`} title={docMarker.title} cta={docMarker.cta} onOpen={docMarker.open} />);
    });
    return nodes;
  }

  return [<div key="t0">{renderChatMarkdown(text)}</div>];
}

interface Props {
  messages: Message[];
  onSend: (text: string) => void;
  // Gates sending (blocked while an attachment is mid-read or errored) and,
  // when onRemoveAttachment is given, rendered as small chips right above
  // the composer — the visual cue that something was actually staged.
  pendingAttachments?: PendingAttachment[];
  loading: boolean;
  // When true, the loading indicator says "Generating document…" instead of
  // "Thinking…" — set by the parent while a pathway draft or explorer
  // document generation is in flight (both take noticeably longer than a
  // normal chat turn, so the more specific label is worth showing).
  generatingDoc?: boolean;
  // Contributor: a pathway draft is being written in the background. The
  // chat stays usable; this only shows a note at the bottom.
  writingDraft?: boolean;
  placeholder?: string;
  // Only needed by Contributor-flow callers, to render a PathwayDocCard
  // wherever a message contains PATHWAY_DOC_MARKER — Explorer callers omit
  // this, so those messages never contain the marker in the first place.
  onOpenPathwayDocument?: () => void;
  // Only needed by Explorer-flow callers, to render a card wherever a message
  // contains ANALYSIS_DOC_MARKER / EXEC_SUMMARY_MARKER — reopens the stored
  // document in the modal (see AdoptionWorkspace).
  onOpenExplorerDocument?: (docType: DocType) => void;
  // Shows a small attach icon in the composer itself when provided, so a
  // file can be staged without opening the separate AttachmentsPanel first.
  onAttachFiles?: (files: File[]) => void;
  // The attach picker's accept list — the Contributor flow passes
  // CONTRIBUTOR_ATTACH_ACCEPT (adds the toolkit-asset-only types).
  attachAccept?: string;
  // Lets the composer's own attachment chips (above) be dismissed inline —
  // omit to render the chips without a remove control.
  onRemoveAttachment?: (id: string) => void;
  // Slug → pathway info lookup for rendering source attribution below
  // assistant messages that cite pathway content. Fetched once by the parent
  // (AdoptionWorkspace) and passed down so ChatPanel stays stateless.
  pathwayLookup?: Record<string, {
    title: string;
    description?: string;
    sector?: string;
    stage?: string;
    timestamp?: string;
    contributor?: string;
  }>;
  // Contributor-flow only: answers a toolkit-asset consent card (see
  // Message.toolkitAssetConsent) and tells the card whether the file is
  // still held in memory. Explorer callers omit both.
  onToolkitAssetConsent?: (consentId: string, share: boolean) => Promise<{ ok: boolean; error?: string }>;
  hasToolkitAssetFile?: (fileName: string) => boolean;
  // Contributor-flow only: the resource review card (Message.resourceReview)
  // and the "may this be published?" card (Message.publishConsent) — see
  // useAdoptionConversation for what each does. Explorer callers omit them.
  resourceReviewActions?: {
    decide: (reviewId: string, itemKey: string, share: boolean) => Promise<{ ok: boolean; error?: string }>;
    attach: (reviewId: string, itemKey: string | null, file: File) => void;
    link: (reviewId: string, itemKey: string | null, url: string) => { ok: boolean; error?: string };
    finish: (reviewId: string) => void;
    rememberFile: (file: File) => void;
  };
  onPublishConsent?: (consentId: string, choice: 'send' | 'keep' | 'delete') => Promise<{ ok: boolean; error?: string }>;
  // Hides the "pathway information isn't independently verified" note under
  // the first assistant message — relevant for an Explorer reading someone
  // else's documented pathway, but not for the Contributor who's the one
  // supplying that information about their own deployment.
  hideAccuracyDisclaimer?: boolean;
}

// Default height (px) matching the old rows={2} textarea, and the cap before it scrolls.
const TEXTAREA_MIN_HEIGHT = 52;
const TEXTAREA_MAX_HEIGHT = 200;

export default function ChatPanel({
  messages,
  onSend,
  pendingAttachments = [],
  loading,
  generatingDoc = false,
  writingDraft = false,
  placeholder,
  onOpenPathwayDocument,
  onOpenExplorerDocument,
  onAttachFiles,
  attachAccept = ATTACH_ACCEPT,
  onRemoveAttachment,
  pathwayLookup,
  onToolkitAssetConsent,
  hasToolkitAssetFile,
  resourceReviewActions,
  onPublishConsent,
  hideAccuracyDisclaimer,
}: Props) {
  const [input, setInput] = useState('');
  const [sourcePopup, setSourcePopup] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const closePopup = useCallback(() => setSourcePopup(null), []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length) onAttachFiles?.(files);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, TEXTAREA_MIN_HEIGHT), TEXTAREA_MAX_HEIGHT)}px`;
  }, [input]);

  const hasBlockingAttachment = pendingAttachments.some((a) => a.state !== 'ready');
  const hasReadyAttachment = pendingAttachments.some((a) => a.state === 'ready');
  const canSend = !loading && !hasBlockingAttachment && (input.trim().length > 0 || hasReadyAttachment);

  function handleSend() {
    if (!canSend) return;
    const text = input.trim();
    setInput('');
    onSend(text);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const popupInfo = sourcePopup ? pathwayLookup?.[sourcePopup] : null;

  return (
    <div className="flex flex-col h-full bg-paper">
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6 sm:px-6">
        <div className="mx-auto max-w-5xl space-y-5">
        {messages.map((m, i) => {
          if (m.hidden) return null;
          const review = m.resourceReview;
          if (review) {
            if (!resourceReviewActions) return null;
            return (
              <div key={i} className="flex justify-start">
                <div className="w-full max-w-xl">
                  <ResourceReviewCard
                    review={review}
                    busy={loading}
                    fileAvailable={(fileName) => hasToolkitAssetFile?.(fileName) ?? false}
                    onRememberFile={resourceReviewActions.rememberFile}
                    onDecide={(itemKey, share) => resourceReviewActions.decide(review.id, itemKey, share)}
                    onAttach={(itemKey, file) => resourceReviewActions.attach(review.id, itemKey, file)}
                    onLink={(itemKey, url) => resourceReviewActions.link(review.id, itemKey, url)}
                    onFinish={() => resourceReviewActions.finish(review.id)}
                  />
                </div>
              </div>
            );
          }
          const publishConsent = m.publishConsent;
          if (publishConsent) {
            if (!onPublishConsent) return null;
            return (
              <div key={i} className="flex justify-start">
                <div className="w-full max-w-xl">
                  <PublishConsentCard
                    consent={publishConsent}
                    onAnswer={(choice) => onPublishConsent(publishConsent.id, choice)}
                  />
                </div>
              </div>
            );
          }
          const consent = m.toolkitAssetConsent;
          if (consent) {
            if (!onToolkitAssetConsent) return null;
            return (
              <div key={i} className="flex justify-start">
                <div className="w-full max-w-xl">
                  <ToolkitAssetConsentCard
                    consent={consent}
                    fileAvailable={
                      'fileName' in consent.candidate.source
                        ? (hasToolkitAssetFile?.(consent.candidate.source.fileName) ?? false)
                        : true
                    }
                    onAnswer={(share) => onToolkitAssetConsent(consent.id, share)}
                  />
                </div>
              </div>
            );
          }
          // Strip the legacy per-message grid marker here, once, so it never
          // surfaces as literal text down either render path below — the
          // grid itself now lives once, persistently, in the workspace header.
          const text = (m.displayContent ?? m.content).split(CUBE_GRID_MARKER).join('');
          const isRich =
            m.role === 'assistant' &&
            (text.includes(DELIVERABLE_START) ||
              (onOpenPathwayDocument && text.includes(PATHWAY_DOC_MARKER)) ||
              (onOpenExplorerDocument &&
                (text.includes(ANALYSIS_DOC_MARKER) || text.includes(EXEC_SUMMARY_MARKER))));
          const isFirstAssistant = m.role === 'assistant' && messages.slice(0, i).every(msg => msg.role !== 'assistant');
          const sources = m.role === 'assistant' && m.pathwaysReferenced?.length
            ? m.pathwaysReferenced
            : null;

          const disclaimerBlock = isFirstAssistant && !hideAccuracyDisclaimer ? (
            <div className="mt-3 border-t border-navy/10 pt-3 text-sm text-ink-soft">
              <span className="mr-1 font-medium text-navy">Note:</span>
              All pathway information shared here comes from the respective contributing organizations. The Cube does not validate or guarantee its accuracy — the contributor owns that.
            </div>
          ) : null;

          const assetsBlock =
            m.role === 'assistant' && m.toolkitAssetsReferenced?.length ? (
              <div className="whitespace-normal">
                <ToolkitAssetCards ids={m.toolkitAssetsReferenced} />
              </div>
            ) : null;

          const sourcesBlock = sources ? (
            <div className="mt-3 border-t border-navy/10 pt-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-soft">Sources</p>
              <div className="space-y-1">
                {sources.map((slug) => {
                  const info = pathwayLookup?.[slug];
                  return (
                    <button
                      key={slug}
                      type="button"
                      onClick={() => setSourcePopup(slug)}
                      className="group flex w-full items-center gap-1.5 text-left text-sm"
                    >
                      <span className="text-coral transition-transform duration-150 group-hover:translate-x-0.5">↗</span>
                      <span className="text-coral underline underline-offset-2 decoration-coral/40 group-hover:decoration-coral transition-colors duration-150">
                        {info?.title ?? slug}
                      </span>
                      {info?.contributor && (
                        <span className="text-ink-soft/70 text-xs">· {info.contributor}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null;

          return (
            <div
              key={i}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`${isRich || m.generatingDoc ? 'w-full' : 'max-w-[80%]'} rounded-2xl px-5 py-3 text-[15px] leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-coral text-white'
                    : 'bg-paper-dim text-ink'
                }`}
              >
                {m.generatingDoc ? (
                  <div className="space-y-3">
                    {text && <span>{renderInlineMarkdown(text)}</span>}
                    <div className="flex items-center gap-2 text-ink-soft animate-pulse">
                      <span aria-hidden>📄</span>
                      Generating your document…
                    </div>
                  </div>
                ) : isRich ? (
                  <div className="space-y-3">
                    {renderMessageContent(text, onOpenPathwayDocument, onOpenExplorerDocument)}
                    {assetsBlock}
                    {disclaimerBlock}
                    {sourcesBlock}
                  </div>
                ) : (
                  <>
                    {renderInlineMarkdown(text)}
                    {assetsBlock}
                    {disclaimerBlock}
                    {sourcesBlock}
                  </>
                )}
              </div>
            </div>
          );
        })}
        {writingDraft && (
          <div className="flex justify-start">
            <div className="bg-paper-dim text-ink-soft rounded-2xl px-5 py-3 text-[15px] animate-pulse">
              Writing the pathway document… you can keep going meanwhile.
            </div>
          </div>
        )}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-paper-dim text-ink-soft rounded-2xl px-5 py-3 text-[15px] animate-pulse">
              {generatingDoc ? 'Generating document…' : 'Thinking…'}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-navy/10 bg-paper/90 px-4 py-4 backdrop-blur-sm sm:px-6">
        {pendingAttachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pendingAttachments.map((a) => (
              <div
                key={a.id}
                className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${
                  a.state === 'error' ? 'border-coral/40 bg-coral-soft text-coral' : 'border-navy/15 bg-paper-dim text-ink-soft'
                }`}
              >
                <span className="max-w-[160px] truncate">
                  {a.state === 'reading' ? '⏳' : a.state === 'error' ? '⚠️' : '📎'} {a.name}
                </span>
                {onRemoveAttachment && (
                  <button
                    type="button"
                    onClick={() => onRemoveAttachment(a.id)}
                    disabled={a.state === 'reading'}
                    className="text-ink-soft transition hover:text-navy disabled:opacity-30"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="mx-auto max-w-5xl">
        <div className="flex items-end gap-3 rounded-2xl border border-navy/15 bg-white p-2 shadow-sm transition focus-within:border-coral">
          {onAttachFiles && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={attachAccept}
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                aria-label="Attach files"
                className="flex-shrink-0 self-end rounded-full p-2.5 text-ink-soft transition hover:bg-paper-dim hover:text-coral disabled:opacity-40"
              >
                📎
              </button>
            </>
          )}
          <textarea
            ref={textareaRef}
            className="flex-1 resize-none bg-transparent px-4 py-2.5 text-[15px] text-ink outline-none placeholder-ink-soft overflow-y-auto"
            style={{ height: TEXTAREA_MIN_HEIGHT, maxHeight: TEXTAREA_MAX_HEIGHT }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={placeholder ?? 'Type a message…'}
            disabled={loading}
          />
          <VoiceInputButton value={input} onChange={setInput} disabled={loading} />
          <button
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-navy text-paper transition hover:scale-105 hover:bg-coral active:scale-95 disabled:opacity-30 disabled:hover:scale-100"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M8 13V3M8 3L3.5 7.5M8 3L12.5 7.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <p className="mt-2 text-center text-xs text-ink-soft">
          Cube can make mistakes. Verify important information.
        </p>
        </div>
      </div>

      {sourcePopup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 px-4 backdrop-blur-sm"
          onClick={closePopup}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-navy/10 bg-paper p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-coral">Pathway</p>
                <h2 className="mt-0.5 font-display text-lg font-medium leading-snug text-navy">
                  {popupInfo?.title ?? sourcePopup}
                </h2>
              </div>
              <button
                type="button"
                onClick={closePopup}
                className="mt-0.5 shrink-0 text-ink-soft transition hover:text-coral"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {popupInfo?.description && (
              <p className="mb-4 text-sm leading-relaxed text-ink">{popupInfo.description}</p>
            )}

            <dl className="space-y-2 border-t border-navy/10 pt-4 text-sm">
              {popupInfo?.sector && (
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-ink-soft">Sector</dt>
                  <dd className="text-ink">{popupInfo.sector}</dd>
                </div>
              )}
              {popupInfo?.stage && (
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-ink-soft">Stage</dt>
                  <dd className="text-ink">{popupInfo.stage}</dd>
                </div>
              )}
              {popupInfo?.contributor && (
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-ink-soft">Contributed by</dt>
                  <dd className="font-medium text-navy">{popupInfo.contributor}</dd>
                </div>
              )}
              {popupInfo?.timestamp && (
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-ink-soft">Last updated</dt>
                  <dd className="text-ink">{popupInfo.timestamp}</dd>
                </div>
              )}
            </dl>

            <p className="mt-4 border-t border-navy/10 pt-4 text-[11px] leading-snug text-ink-soft/60">
              This information reflects the contributor&apos;s documented experience. The Cube does not validate or guarantee its accuracy.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
