import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_GRID, type GridState } from '@/lib/dimensions';
import { Message } from '@/components/ChatPanel';
import { createClient } from '@/lib/supabase/client';
import { GENERIC_ERROR_MESSAGE } from '@/lib/error-messages';
import { extractTextFromFile, fileToImageBlock, getFileExtension, isImageFile } from '@/lib/extract-text';
import {
  TOOLKIT_ASSET_BUCKET,
  assetExtension,
  assetMentionKey,
  candidateSourceKey,
  isAllowedAssetFile,
  linkDomain,
  mentionItemKey,
  resourceReviewContent,
  assetHref,
  assetTitleHref,
  assetShareContent,
  sourceLabel,
  type AssetShareItem,
  type AssetShareState,
  type PublishConsentState,
  type ResourceReviewItem,
  type ResourceReviewState,
  type ToolkitAssetCandidate,
  type ToolkitAssetConsentState,
  type ToolkitAssetMention,
} from '@/lib/toolkit-assets';
import {
  parseGridUpdate,
  stripGridUpdate,
  ANALYSIS_DOC_MARKER,
  EXEC_SUMMARY_MARKER,
  PATHWAY_DOC_MARKER,
  PUBLISH_CONSENT_MARKER,
  RESOURCE_REVIEW_MARKER,
  ASSET_SHARE_MARKER,
  TOOLKIT_ASSET_CONSENT_MARKER,
  type ParsedGridUpdate,
} from '@/lib/grid-update';
import { extractGapsFromPathwayDraft } from '@/lib/pathway-gaps';
import { linkSection4Assets, removeSection4Rows, sameResourceName, section4Rows, type Section4Link } from '@/lib/pathway-section4';
import type { ExplorerIntent } from '@/lib/explorer-intents';
import {
  DesignDocumentRow,
  DocType,
  getLatestDesignDocument,
  hashConversationState,
  insertDesignDocumentVersion,
  insertDraftVersion,
  listDesignDocumentVersions,
} from '@/lib/design-documents';
// pathway-submission-versions removed — retired in migration 0018.
// Contributor drafts now stored in design_documents (doc_type='draft').

export type AdoptionFlow = 'explorer' | 'contributor' | '';

// Explorer-only working assessment: the Cube's own current stage/coverage
// read and whether the adopter has confirmed it — distinct from `stage`
// above, which is only ever filled from the user's own words. Dimension
// names (coveredDimensions etc.) are the four dimension display names
// (Persona, Solution, Institution, Ecosystem) — any dimension absent from
// all three arrays is implicitly Unknown, so there's no fourth array for it.
// See CubeAssessment in lib/system-prompts.ts.
export interface CubeAssessment {
  currentStage: string;
  coveredDimensions: string[];
  partialDimensions: string[];
  missingDimensions: string[];
  assessmentConfirmed: boolean;
}

export const EMPTY_CUBE_ASSESSMENT: CubeAssessment = {
  currentStage: '',
  coveredDimensions: [],
  partialDimensions: [],
  missingDimensions: [],
  assessmentConfirmed: false,
};

export interface AdoptionMeta {
  name: string;
  sector: string;
  geography: string;
  stage: string;
  summary: string;
  // Chosen once on the welcome screen, gated by role — fixes which system
  // prompt (explorer vs contributor) this adoption's companion turns use.
  flow: AdoptionFlow;
  // Contributor-only: the pathway this workspace is linked to. Set at row
  // creation time; never changed afterward.
  pathwayId: string;
  // Explorer-only: which of the four intents this conversation is running
  // (see lib/explorer-intents.ts). Picked explicitly from the menu on
  // /strengthen before the first message, never inferred from what the user
  // types. Unlike `flow` it can change mid-conversation — but only after the
  // model has flagged the mismatch and the user has confirmed the switch, at
  // which point flowStep resets to the new intent's step 1.
  intent: ExplorerIntent;
  // Which numbered step of that flow the model last reported being on (see
  // gridUpdateContract in lib/system-prompts.ts). 0 = no turn yet. Persisted
  // here and re-injected into the prompt every turn, since the grid_update
  // block itself is stripped before a message is stored — the model can't
  // "read back" its own past JSON from history.
  flowStep: number;
  // The model's own working reasoning state, same carry-forward mechanism as
  // flowStep: its current best-guess hypothesis, the biggest open risk, its
  // confidence in that hypothesis, the decision it believes the user is
  // actually working toward, and its own conversational posture. Re-injected
  // every turn via currentProgressBlock so the model revises its prior
  // reasoning instead of re-deriving it from scratch each time.
  hypothesis: string;
  biggestRisk: string;
  confidence: string;
  decision: string;
  conversationMode: string;
  // Explorer-only — see CubeAssessment above.
  cubeAssessment: CubeAssessment;
  // Explorer-only: the model's own working read of who the user is — role/
  // position and what they most likely care about, inferred silently and
  // sharpened over turns, never asked for directly. See CompanionMeta.persona
  // in lib/system-prompts.ts.
  persona: string;
}

export const EMPTY_META: AdoptionMeta = {
  name: '',
  sector: '',
  geography: '',
  stage: '',
  summary: '',
  flow: '',
  pathwayId: '',
  intent: '',
  flowStep: 0,
  hypothesis: '',
  biggestRisk: '',
  confidence: '',
  decision: '',
  conversationMode: '',
  cubeAssessment: EMPTY_CUBE_ASSESSMENT,
  persona: '',
};

export { EMPTY_GRID };

const UPLOAD_LINE = /(?:📄|🖼️|📎)\s*Uploaded\s+\*\*(.+?)\*\*/g;

// Files already sent in past turns aren't tracked separately — they're
// embedded in each upload message's displayContent (e.g. "📄 Uploaded
// **name**"), so this recovers the list for display in the files panel.
export function extractUploadedFileNames(messages: Message[]): string[] {
  const names: string[] = [];
  for (const m of messages) {
    if (!m.displayContent) continue;
    for (const match of m.displayContent.matchAll(UPLOAD_LINE)) {
      names.push(match[1]);
    }
  }
  return names;
}

// A staged attachment carries its extracted payload once processed, so it can
// be folded into the actual API message once the user presses Enter.
export interface StagedAttachment {
  id: string;
  name: string;
  state: 'reading' | 'ready' | 'error';
  error?: string;
  // 'asset' (contributor flow only): a file that can't be read as text or
  // sent as an image — .doc/.ppt/.csv, an image over 5 MB, a PDF with no
  // text layer — but can still be kept as a toolkit asset file. The model
  // only learns its name, type and size.
  kind?: 'image' | 'text' | 'asset';
  text?: string;
  image?: { mediaType: string; base64: string };
  sizeBytes?: number;
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export interface AdoptionConversation {
  id: string;
  meta: AdoptionMeta;
  grid: GridState;
  messages: Message[];
  updatedAt: string;
}

// Shape of a row in the `designs` table (see supabase/migrations/). The
// grid_state column was renamed from cube_state in the 4×4 revamp
// (migration 0008); old 7-dimension rows were cleared rather than migrated.
interface AdoptionRow {
  id: string;
  meta: AdoptionMeta;
  grid_state: GridState;
  messages: Message[];
  updated_at: string;
}

// Contributor-only: the current state of this adoption's pathway document.
// The draft is stored in design_documents (doc_type='draft') and assembled
// into the canonical pathway via /api/pathways/assemble on publish.
export interface PathwayDocState {
  content: string | null;       // latest generated draft text — always the basis for revisions/publish, regardless of what's being viewed
  versionNumber: number;         // latest version_number from design_documents
  // Full version history for this chat's draft, newest first — backs the
  // pane's version dropdown. Empty until the first generation.
  versions: DesignDocumentRow[];
  // Which version the pane is currently displaying. null means "the latest"
  // (content, above) — set to a specific number when the user picks an
  // older version from the dropdown, purely for viewing; it never changes
  // what a revision or publish acts on.
  selectedVersionNumber: number | null;
  publishedSlug: string | null;  // set after a successful publish in this chat
  // The pathway's own already-published document (pathways.content_cache),
  // fetched once on mount so a contributor who hasn't generated a draft in
  // THIS chat yet — e.g. a second contributor joining a pathway another
  // contributor already published — can still view what's live via "View
  // Pathway Document" instead of seeing nothing. Only ever a fallback: an
  // own in-progress draft (content, above) always takes precedence.
  pathwayPublishedContent: string | null;
  pathwayPublishedSlug: string | null;
  reviewRequested: boolean;
  assembledDesignDocId: string | null;
  publishedDesignDocId: string | null;
  paneOpen: boolean;
  loading: boolean;
  error: string | null;
}

// Explorer-only: the two documents the Guidance intent can produce. Both are
// stored in `design_documents` (doc_type 'analysis' / 'plan') so they survive
// a reload and can be reopened at any time — that persistence is the whole
// point, since these are the flow's actual deliverable. Regenerating
// supersedes the previous one rather than branching a version the user has to
// choose between: only the latest row for each doc_type is ever read back, so
// there is no version picker here (unlike the Contributor's pathway document,
// where every revision is meant to stay retrievable).
export interface ExplorerDocState {
  analysis: DesignDocumentRow | null;
  summary: DesignDocumentRow | null;
  // Which document the modal is currently showing, or null when closed.
  open: DocType | null;
  // Which one is mid-generation, so the modal (and the chat's Thinking…
  // indicator) can show the right label — null when nothing is generating.
  generating: DocType | null;
  error: string | null;
}

export const EMPTY_EXPLORER_DOC: ExplorerDocState = {
  analysis: null,
  summary: null,
  open: null,
  generating: null,
  error: null,
};

export const EMPTY_PATHWAY_DOC: PathwayDocState = {
  content: null,
  versionNumber: 0,
  versions: [],
  selectedVersionNumber: null,
  publishedSlug: null,
  pathwayPublishedContent: null,
  pathwayPublishedSlug: null,
  reviewRequested: false,
  assembledDesignDocId: null,
  publishedDesignDocId: null,
  paneOpen: false,
  loading: false,
  error: null,
};

export function rowToConversation(row: AdoptionRow): AdoptionConversation {
  return {
    id: row.id,
    meta: row.meta ?? EMPTY_META,
    grid: { ...EMPTY_GRID, ...(row.grid_state ?? {}) },
    messages: row.messages ?? [],
    updatedAt: row.updated_at,
  };
}

// Converts our Message[] into the Anthropic content shape, expanding any
// attached images into content blocks — shared by the main chat turn and the
// one-off document-generation calls so they build requests identically.
// ---------------------------------------------------------------------------
// Contributor resource review — pure helpers (see ResourceReviewState)
// ---------------------------------------------------------------------------

// Keys of everything the contributor has already been asked about: items on
// any resource review card, plus legacy one-candidate consent cards.
function reviewedResourceKeys(messages: Message[]): Set<string> {
  const keys = new Set<string>();
  for (const m of messages) {
    for (const item of m.resourceReview?.items ?? []) {
      keys.add(item.key);
      keys.add(mentionItemKey(item.name));
      if (item.candidate) keys.add(candidateSourceKey(item.candidate));
    }
    if (m.toolkitAssetConsent) {
      keys.add(candidateSourceKey(m.toolkitAssetConsent.candidate));
      keys.add(mentionItemKey(m.toolkitAssetConsent.candidate.name));
    }
  }
  return keys;
}

// Names of everything on any resource review card so far.
function reviewedResourceNames(messages: Message[]): string[] {
  return messages.flatMap((m) => (m.resourceReview?.items ?? []).map((i) => i.name));
}

// Every reusable resource this contribution has, the one list Section 4 is
// built from: items on any card (except ones that turned out to be
// background material, or an attachment still waiting for its check) plus
// findings not on a card yet — the same items the next card would show.
export function currentResourceItems(messages: Message[]): ResourceReviewItem[] {
  const carded = messages
    .flatMap((m) => m.resourceReview?.items ?? [])
    .filter((i) => i.status !== 'background' && !(i.key.startsWith('attached:') && !i.candidate));
  const fresh = newResourceItems(
    validCandidates(messages.flatMap((m) => m.toolkitAssetCandidates ?? []), messages),
    messages.flatMap((m) => m.toolkitAssetMentions ?? []),
    reviewedResourceKeys(messages),
    reviewedResourceNames(messages)
  );
  return [...carded, ...fresh];
}

// The "Reusable resources" list handed to the drafter with every
// generate/revise, so Section 4 names exactly what the card asks about.
function resourceListForDraft(items: ResourceReviewItem[]): string {
  if (items.length === 0) return 'Reusable resources the contributor\'s material names: none found.';
  const lines = items.map((item) => {
    const c = item.candidate;
    const where = c
      ? 'fileName' in c.source
        ? `file ${c.source.fileName}`
        : `link ${c.source.url}`
      : item.mentionedIn
        ? `named in ${item.mentionedIn}, not attached`
        : 'named by the contributor, not attached';
    const purpose = c?.purpose ? ` — ${c.purpose}` : '';
    const reuse = c?.reuseCondition ? ` Reuse when: ${c.reuseCondition}` : '';
    return `- ${item.name}${purpose} (${where}).${reuse}`;
  });
  return `Reusable resources the contributor's material names (hints for Section 4: list one only if it is a genuinely reusable artifact, as a Section 3 unit typed Toolkit Asset with a Section 4 row titled as named here):\n${lines.join('\n')}`;
}

// ---- Asset card (since 2026-10-12) — pure helpers, see AssetShareState ----

// "03_A4KIOSK_Print_Job_Test_Cases.pdf" → "A4KIOSK Print Job Test Cases".
export function assetNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/^\s*\d+\s+/, '').trim();
  return base || fileName;
}

// The card's items for a draft: its Section 4 rows not already on an earlier
// asset card. Each gets a suggestion when a file uploaded earlier looks like
// it — one the companion flagged as reusable under that name first, else
// one whose file name names it.
export function assetCardItems(markdown: string, messages: Message[]): AssetShareItem[] {
  const onCards = messages.flatMap((m) => m.assetShare?.items ?? []).map((i) => i.name);
  const candidates = validCandidates(messages.flatMap((m) => m.toolkitAssetCandidates ?? []), messages);
  const uploaded = extractUploadedFileNames(messages);
  const items: AssetShareItem[] = [];
  for (const row of section4Rows(markdown)) {
    if ([...onCards, ...items.map((i) => i.name)].some((n) => sameResourceName(n, row.title))) continue;
    const flagged = candidates.find((c) => 'fileName' in c.source && sameResourceName(c.name, row.title));
    const suggestedFile =
      (flagged && 'fileName' in flagged.source ? flagged.source.fileName : undefined) ??
      uploaded.find((f) => sameResourceName(assetNameFromFile(f), row.title));
    items.push({
      key: `row:${assetMentionKey(row.title)}`,
      name: row.title,
      fromSection4: true,
      reuseCondition: row.reuseCondition || undefined,
      ...(suggestedFile ? { suggestedFile } : {}),
    });
  }
  return items;
}

// Section 4 as the app keeps it on every save: without the rows of assets
// the contributor deleted, and with every shared asset linked.
export function section4ForMessages(markdown: string, messages: Message[]): string {
  const deleted = messages.flatMap((m) => m.assetShare?.items ?? []).filter((i) => i.deleted).map((i) => i.name);
  return linkSection4Assets(removeSection4Rows(markdown, deleted), sharedAssetLinks(messages));
}

// Every asset the contributor has shared in this conversation, as Section 4
// links: asset-card items, plus resource review items from older
// conversations.
export function sharedAssetLinks(messages: Message[]): Section4Link[] {
  const links: Section4Link[] = [];
  for (const m of messages) {
    for (const item of m.assetShare?.items ?? []) {
      if (!item.shared) continue;
      const { assetId, source } = item.shared;
      const asset = {
        id: assetId,
        kind: 'url' in source ? ('link' as const) : ('file' as const),
        linkUrl: 'url' in source ? source.url : null,
        fileName: 'fileName' in source ? source.fileName : null,
      };
      links.push({
        name: item.name,
        href: assetHref(asset),
        titleHref: assetTitleHref(asset),
        assetId,
        reuseCondition: item.reuseCondition,
        label: sourceLabel(source),
      });
    }
    for (const item of m.resourceReview?.items ?? []) {
      if (item.status !== 'shared' || !item.assetId || !item.candidate) continue;
      const source = item.candidate.source;
      const asset = {
        id: item.assetId,
        kind: 'url' in source ? ('link' as const) : ('file' as const),
        linkUrl: 'url' in source ? source.url : null,
        fileName: 'fileName' in source ? source.fileName : null,
      };
      links.push({
        name: item.name,
        href: assetHref(asset),
        titleHref: assetTitleHref(asset),
        assetId: item.assetId,
        reuseCondition: item.candidate.reuseCondition,
        label: sourceLabel(source),
      });
    }
  }
  return links;
}

// A file candidate must name a file actually uploaded in this conversation,
// and a link must appear verbatim in something the contributor typed — the
// model has been seen to "correct" a pasted link into a URL nobody gave,
// which would then be published as theirs.
function validCandidates(candidates: ToolkitAssetCandidate[], messages: Message[]): ToolkitAssetCandidate[] {
  const uploaded = new Set(extractUploadedFileNames(messages));
  const userText = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.displayContent ?? m.content)
    .join('\n');
  return candidates.filter((candidate) =>
    'fileName' in candidate.source ? uploaded.has(candidate.source.fileName) : userText.includes(candidate.source.url)
  );
}

// New review items for candidates and mentions not reviewed yet. A mention
// whose name matches a candidate is dropped: the real file or link wins.
//
// A mention that names the same thing as an item already listed or reviewed
// (knownNames) in other words is dropped too (sameResourceName), so the card
// never shows one artifact twice.
export function newResourceItems(
  candidates: ToolkitAssetCandidate[],
  mentions: ToolkitAssetMention[],
  reviewed: Set<string>,
  knownNames: string[] = []
): ResourceReviewItem[] {
  const seen = new Set(reviewed);
  const items: ResourceReviewItem[] = [];
  for (const candidate of candidates) {
    const key = candidateSourceKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    seen.add(mentionItemKey(candidate.name));
    items.push({ key, name: candidate.name, candidate, status: 'pending' });
  }
  for (const mention of mentions) {
    const key = mentionItemKey(mention.name);
    if (!assetMentionKey(mention.name) || seen.has(key)) continue;
    if ([...knownNames, ...items.map((i) => i.name)].some((n) => sameResourceName(n, mention.name))) continue;
    seen.add(key);
    items.push({ key, name: mention.name, mentionedIn: mention.mentionedIn, status: 'pending' });
  }
  return items;
}

function sameSource(a: { fileName: string } | { url: string }, b: { fileName: string } | { url: string }): boolean {
  return 'fileName' in a ? 'fileName' in b && a.fileName === b.fileName : 'url' in b && a.url === b.url;
}

// Folds one companion turn's findings into an open review. Something
// attached from the card takes the candidate that matches its file or link;
// a pending mention takes a candidate with its name; the rest are new items.
// Anything attached from the card that the check didn't list is background
// material (the "doesn't pass the checks" branch).
export function mergeIntoReview(
  review: ResourceReviewState,
  candidates: ToolkitAssetCandidate[],
  mentions: ToolkitAssetMention[],
  reviewed: Set<string>
): ResourceReviewState {
  const items = review.items.map((item) => ({ ...item }));
  const leftover: ToolkitAssetCandidate[] = [];
  for (const candidate of candidates) {
    const attached = items.find((i) => i.attachedSource && sameSource(i.attachedSource, candidate.source));
    if (attached) {
      attached.candidate = candidate;
      attached.attachedSource = undefined;
      if (attached.key.startsWith('attached:')) attached.name = candidate.name;
      continue;
    }
    const named = items.find(
      (i) => !i.candidate && !i.attachedSource && i.status === 'pending' && i.key === mentionItemKey(candidate.name)
    );
    if (named) {
      named.candidate = candidate;
      continue;
    }
    leftover.push(candidate);
  }
  for (const item of items) {
    if (!item.attachedSource) continue;
    item.attachedSource = undefined;
    item.status = 'background';
  }
  const known = new Set([...reviewed, ...items.map((i) => i.key)]);
  return { ...review, items: [...items, ...newResourceItems(leftover, mentions, known, items.map((i) => i.name))] };
}

// Findings from a turn the contributor started in chat (an upload or a link,
// not something attached from a card) get their own new card at the bottom,
// next to that upload, instead of being folded into an older card further
// up where they'd go unnoticed. A still-pending mention on an older open
// card that this turn's file or link now answers moves to the new card with
// it, so the same resource is never asked about twice. Pure — the caller
// applies `messages` and appends a card holding `items`.
export function takeFindingsForFreshReview(
  messages: Message[],
  candidates: ToolkitAssetCandidate[],
  mentions: ToolkitAssetMention[]
): { messages: Message[]; items: ResourceReviewItem[] } {
  const moved: ResourceReviewItem[] = [];
  const remaining: ToolkitAssetCandidate[] = [];
  const movedKeys = new Set<string>();
  for (const candidate of candidates) {
    const key = mentionItemKey(candidate.name);
    const pending = messages.some((m) =>
      m.resourceReview?.status === 'open' &&
      m.resourceReview.items.some((i) => i.key === key && i.status === 'pending' && !i.candidate && !i.attachedSource)
    );
    if (pending && !movedKeys.has(key)) {
      movedKeys.add(key);
      const from = messages
        .flatMap((m) => m.resourceReview?.items ?? [])
        .find((i) => i.key === key && i.status === 'pending');
      moved.push({ ...from!, candidate });
    } else {
      remaining.push(candidate);
    }
  }
  const next = movedKeys.size === 0
    ? messages
    : messages.map((m) => {
        const review = m.resourceReview;
        if (review?.status !== 'open' || !review.items.some((i) => movedKeys.has(i.key) && i.status === 'pending')) return m;
        const updated = { ...review, items: review.items.filter((i) => !(movedKeys.has(i.key) && i.status === 'pending')) };
        return { ...m, resourceReview: updated, content: resourceReviewContent(updated) };
      });
  const reviewed = reviewedResourceKeys(next);
  for (const item of moved) {
    reviewed.add(item.key);
    if (item.candidate) reviewed.add(candidateSourceKey(item.candidate));
  }
  return {
    messages: next,
    items: [...moved, ...newResourceItems(remaining, mentions, reviewed, [...reviewedResourceNames(next), ...moved.map((i) => i.name)])],
  };
}

function publishConsentContent(consent: PublishConsentState): string {
  switch (consent.status) {
    case 'sent':
      return 'The contributor confirmed this version is accurate and sent the pathway for administrator review.';
    case 'kept':
      return 'The contributor chose not to publish for now; the pathway stays a private draft.';
    case 'deleted':
      return 'The contributor deleted this contribution.';
    default:
      return 'Asked the contributor to confirm this version is accurate and may be published to help future adopters once an administrator approves it.';
  }
}

// What to show for a /api/chat response that isn't a reply: an expected
// error's own message (4xx — e.g. a missing role), otherwise the generic one.
// The 5xx body is already the generic message (withErrorHandling); reading it
// is skipped so a non-JSON body can't leak through either.
async function chatErrorText(res: Response): Promise<string> {
  if (res.status >= 400 && res.status < 500) {
    const body = await res.json().catch(() => null);
    if (typeof body?.error === 'string') return body.error;
  }
  return GENERIC_ERROR_MESSAGE;
}

// Thrown when /api/chat answers with an error instead of a document, so the
// document generators can show that message (and never save the error body as
// a document version).
class ChatRequestError extends Error {}

export function toApiMessages(messages: Message[]) {
  return messages.filter((m) => !m.notice).map(({ role, content, images }) => ({
    role,
    content:
      images && images.length > 0
        ? [
            { type: 'text', text: content },
            ...images.map((img) => ({
              type: 'image',
              source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
            })),
          ]
        : content,
  }));
}

interface UseAdoptionConversationOptions {
  // Pass an already-loaded row, or null to create the row lazily on the
  // first message/attachment the user actually sends.
  initial: AdoptionConversation | null;
  // Contributor-only: the pathway this workspace is linked to. Set once at
  // creation time and stored in meta.pathwayId for all subsequent turns.
  pathwayId?: string;
  onCreated?: (conversation: AdoptionConversation) => void;
  onChange?: (conversation: AdoptionConversation) => void;
}

export function useAdoptionConversation({ initial, pathwayId, onCreated, onChange }: UseAdoptionConversationOptions) {
  const [conversation, setConversation] = useState<AdoptionConversation | null>(initial);
  const conversationRef = useRef<AdoptionConversation | null>(initial);
  const [loading, setLoading] = useState(false);
  // The companion turn in flight, if any (see sendMessage). A turn streams
  // into the last message, so nothing else may append to the chat while it
  // runs — see afterCurrentTurn.
  const turnRef = useRef<Promise<void> | null>(null);
  // Contributor pathway drafts run in the background, one at a time, so the
  // chat stays usable while one is written — see runDraftJob.
  const draftQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [pendingAttachments, setPendingAttachments] = useState<StagedAttachment[]>([]);
  // Dedupes concurrent ensureCreated() calls (e.g. several files dropped at
  // once, each triggering extraction) so they share one row-creation insert
  // instead of racing to create duplicates.
  const creatingRef = useRef<Promise<AdoptionConversation> | null>(null);
  // Contributor-only: files that could become toolkit asset files, keyed by
  // file name, held in memory (never uploaded) until the contributor answers
  // the public-sharing consent card for them. Lost on reload by design —
  // nothing is stored before consent.
  const assetFilesRef = useRef<Map<string, File>>(new Map());
  // Consent ids with an upload/register in flight — blocks a double-click
  // from creating two objects and two rows.
  const consentInFlightRef = useRef<Set<string>>(new Set());
  // Bumped after each successfully shared asset so the contributor's
  // ToolkitAssetStatusList re-fetches.
  const [toolkitAssetsVersion, setToolkitAssetsVersion] = useState(0);

  // Contributor-only pathway document state — see PathwayDocState. Mirrored
  // into a ref (same idiom as conversation/conversationRef above) so the
  // internal helpers below always read the latest value even though they're
  // plain functions, not memoized against pathwayDoc's identity.
  const [pathwayDoc, setPathwayDoc] = useState<PathwayDocState>(EMPTY_PATHWAY_DOC);
  const pathwayDocRef = useRef<PathwayDocState>(EMPTY_PATHWAY_DOC);
  const updatePathwayDoc = useCallback((updater: (d: PathwayDocState) => PathwayDocState) => {
    setPathwayDoc((prev) => {
      const next = updater(prev);
      pathwayDocRef.current = next;
      return next;
    });
  }, []);

  // Contributor-only: the pathway's own title/sector/description, fetched as
  // soon as pathwayId is known — lets the pre-chat screen (before any
  // message is sent, so no design row and no conversation.meta yet) show a
  // second contributor what's already named/described instead of nothing.
  // Once a row exists, conversation.meta.name/summary (seeded from this same
  // data in ensureCreated) takes over.
  const [pathwayPreview, setPathwayPreview] = useState<{ title: string; sector: string; description: string } | null>(null);

  // Explorer-only document state — see ExplorerDocState. Same ref-mirroring
  // idiom as pathwayDoc above, for the same reason.
  const [explorerDoc, setExplorerDoc] = useState<ExplorerDocState>(EMPTY_EXPLORER_DOC);
  const explorerDocRef = useRef<ExplorerDocState>(EMPTY_EXPLORER_DOC);
  const updateExplorerDoc = useCallback((updater: (d: ExplorerDocState) => ExplorerDocState) => {
    setExplorerDoc((prev) => {
      const next = updater(prev);
      explorerDocRef.current = next;
      return next;
    });
  }, []);

  // Reads back an existing Explorer adoption's stored documents once, on
  // mount, so the header's "Analysis Document" button and the chat cards work
  // immediately on a reopened conversation — same one-shot pattern as the
  // pathway-document effect below.
  useEffect(() => {
    if (!initial || initial.meta?.flow !== 'explorer') return;
    (async () => {
      const [analysis, summary] = await Promise.all([
        getLatestDesignDocument(initial.id, 'analysis'),
        getLatestDesignDocument(initial.id, 'plan'),
      ]);
      updateExplorerDoc((prev) => ({ ...prev, analysis, summary }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Loads the latest stored draft for an existing contributor workspace once,
  // on mount, loading its full version history so the pane's version
  // dropdown works immediately on a reopened chat. design_documents
  // doc_type='draft' is the storage for contributor-generated pathway
  // drafts (pathway_submissions was retired).
  useEffect(() => {
    if (!initial || initial.meta?.flow !== 'contributor') return;
    (async () => {
      const versions = await listDesignDocumentVersions(initial.id, 'draft');
      if (versions.length === 0) return;
      const latest = versions[0];
      updatePathwayDoc((prev) => ({
        ...prev,
        content: latest.content,
        versionNumber: latest.version_number,
        versions,
      }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetches the pathway's own already-published document once, as a
  // fallback for "View Pathway Document" when this chat has no draft of its
  // own yet (see pathwayPublishedContent's comment above) — covers both a
  // brand-new chat (pathwayId passed as a prop) and a reopened existing one
  // (pathwayId only known from the loaded row's meta).
  useEffect(() => {
    const pid = pathwayId || initial?.meta.pathwayId;
    if (!pid) return;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('pathways')
        .select('slug, content_cache, title, sector, description, review_requested, assembled_design_doc_id, published_design_doc_id')
        .eq('id', pid)
        .maybeSingle();
      if (!data) return;
      updatePathwayDoc((prev) => ({
        ...prev,
        reviewRequested: data.review_requested ?? false,
        assembledDesignDocId: data.assembled_design_doc_id ?? null,
        publishedDesignDocId: data.published_design_doc_id ?? null,
        ...(data.content_cache ? {
          pathwayPublishedContent: data.content_cache,
          pathwayPublishedSlug: data.slug,
        } : {}),
      }));
      setPathwayPreview({ title: data.title ?? '', sector: data.sector ?? '', description: data.description ?? '' });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Updater functions passed to setState must be pure — calling onChange
  // (which triggers the parent's list update) from inside one produces
  // React's "Cannot update a component while rendering a different
  // component" warning. Keep the latest onChange in a ref and fire it from
  // an effect once `conversation` has actually changed, after commit.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (conversation) onChangeRef.current?.(conversation);
  }, [conversation]);

  const update = useCallback((updater: (c: AdoptionConversation) => AdoptionConversation) => {
    setConversation((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      conversationRef.current = next;
      return next;
    });
  }, []);

  async function persist(c: AdoptionConversation) {
    const updatedAt = new Date().toISOString();
    const supabase = createClient();
    await supabase
      .from('designs')
      .update({
        meta: c.meta,
        grid_state: c.grid,
        messages: c.messages.filter((m) => !m.notice),
        updated_at: updatedAt,
      })
      .eq('id', c.id);
    update((cur) => ({ ...cur, updatedAt }));
  }

  // Generates (revisionInstruction omitted) or revises (given) the pathway
  // draft via the `pathway-draft` API mode, then stores the result in
  // design_documents (doc_type='draft') so it survives a reload.
  // Triggered automatically from sendMessage when the companion signals
  // pathwayAction "generate" or "revise" — never called directly by UI code.
  async function generatePathwayDraft(revisionInstruction?: string): Promise<string | null> {
    const c = conversationRef.current;
    if (!c) return null;

    updatePathwayDoc((prev) => ({ ...prev, loading: true, error: null }));

    // The resources the material names are hints for Section 4; the asset
    // card is then built from Section 4 itself (assetCardItems).
    const resources = currentResourceItems(c.messages);
    const trailingMessage = `${
      revisionInstruction
        ? `Please revise the pathway draft as follows: ${revisionInstruction}. Return the full revised document in the same Sections 0-6 + Source Trace appendix format.`
        : 'Draft my adoption as a pathway page now.'
    }\n\n${resourceListForDraft(resources)}`;

    try {
      const latestDraft = pathwayDocRef.current.content;
      const priorDraft = latestDraft ? [{ role: 'assistant', content: latestDraft }] : [];

      // Fetched fresh on every generate/revise, not just the first — another
      // contributor may have published something for this pathway since
      // this chat's own last draft, and if this chat republishes without
      // seeing that, it silently overwrites their work. pathwayDraftSystemPrompt's
      // merge rules tell the model to treat this as the more current state
      // whenever it disagrees with this chat's own prior draft.
      const pathwayId = c.meta.pathwayId;
      let existingPublishedDoc: string | null = null;
      if (pathwayId) {
        const supabase = createClient();
        const { data } = await supabase.from('pathways').select('slug, content_cache, review_requested, assembled_design_doc_id, published_design_doc_id').eq('id', pathwayId).maybeSingle();
        if (data?.content_cache) {
          existingPublishedDoc = data.content_cache;
          updatePathwayDoc((prev) => ({
            ...prev,
            pathwayPublishedContent: data.content_cache,
            pathwayPublishedSlug: data.slug,
            reviewRequested: data.review_requested ?? false,
            assembledDesignDocId: data.assembled_design_doc_id ?? prev.assembledDesignDocId,
            publishedDesignDocId: data.published_design_doc_id ?? prev.publishedDesignDocId,
          }));
        }
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...toApiMessages(c.messages), ...priorDraft, { role: 'user', content: trailingMessage }],
          mode: 'pathway-draft',
          grid: c.grid,
          meta: c.meta,
          existingPublishedDoc,
        }),
      });
      // Never save an error body as a draft version.
      if (!res.ok || !res.body) throw new ChatRequestError(await chatErrorText(res));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }

      // Section 4 without decision/fix rows, and with the shared assets'
      // links (the model never writes those) — kept across every revision.
      if (!text.trim().startsWith('Not enough of this adoption')) {
        text = section4ForMessages(text, c.messages);
      }

      // Every generate/revise is its own version — this is what backs the
      // pane's version dropdown. Becomes the published document verbatim on
      // Publish (see publishPathwayDocument / app/api/pathways/assemble/route.ts).
      const saved = await insertDraftVersion(c.id, text, pathwayDocRef.current.versionNumber);

      updatePathwayDoc((prev) => ({
        ...prev,
        content: text,
        versionNumber: saved?.version_number ?? prev.versionNumber,
        versions: saved ? [saved, ...prev.versions] : prev.versions,
        selectedVersionNumber: null, // jump back to viewing the latest
        loading: false,
      }));

      return text;
    } catch (err) {
      updatePathwayDoc((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof ChatRequestError ? err.message : GENERIC_ERROR_MESSAGE,
      }));
      return null;
    }
  }

  // Publishes this chat's current draft as the pathway's live document,
  // verbatim (see app/api/pathways/assemble/route.ts) — merging another
  // contributor's earlier work already happened once, at generation time
  // (pathwayDraftSystemPrompt's merge rules), not again here. Requires the
  // design to be linked to a pathway (meta.pathwayId).
  async function publishPathwayDocument(commitMessage?: string): Promise<{ ok: boolean; slug?: string; error?: string }> {
    const c = conversationRef.current;
    const pathwayId = c?.meta.pathwayId;
    if (!pathwayId) {
      return { ok: false, error: 'No pathway linked to this workspace. Open a new contribution from the Contribute page.' };
    }
    if (!c?.id) {
      return { ok: false, error: 'No workspace found. Try again.' };
    }
    try {
      const res = await fetch('/api/pathways/assemble', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pathwayId, designId: c.id, commitMessage }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error ?? 'Publish failed.' };
      // The sent document now lists this pathway's shared toolkit assets —
      // refresh their "sent for review" status.
      setToolkitAssetsVersion((v) => v + 1);

      // The server publishes this design's latest draft version verbatim, so
      // the response's content should already match what the pane shows —
      // syncing explicitly keeps them correct even if that ever changes.
      // Also updates pathwayPublishedContent/-Slug immediately so the
      // Draft/Published label (compares the displayed content against
      // these) reflects "published" right away, without waiting for the
      // next generate/revise's fresh fetch.
      updatePathwayDoc((prev) => ({
        ...prev,
        content: typeof data.content === 'string' ? data.content : prev.content,
        publishedSlug: data.slug ?? prev.publishedSlug,
        pathwayPublishedContent: typeof data.content === 'string' ? data.content : prev.pathwayPublishedContent,
        pathwayPublishedSlug: data.slug ?? prev.pathwayPublishedSlug,
        reviewRequested: true,
        assembledDesignDocId: (data.assembled_design_doc_id as string | undefined) ?? prev.versions[0]?.id ?? prev.assembledDesignDocId,
      }));
      return { ok: true, slug: data.slug };
    } catch {
      return { ok: false, error: 'Could not reach the server. Try again.' };
    }
  }

  function openPathwayDocument() {
    updatePathwayDoc((prev) => ({ ...prev, paneOpen: true }));
  }

  function closePathwayDocument() {
    updatePathwayDoc((prev) => ({ ...prev, paneOpen: false }));
  }

  // Switches which version the pane displays — purely a viewing choice, see
  // selectedVersionNumber's comment on PathwayDocState. versionNumber ===
  // the latest version collapses back to null so the pane tracks new
  // generations again instead of staying pinned to a now-stale "latest".
  function selectPathwayDocVersion(versionNumber: number) {
    updatePathwayDoc((prev) => ({
      ...prev,
      selectedVersionNumber: versionNumber === prev.versionNumber ? null : versionNumber,
    }));
  }

  // Appends one client-constructed (never model-authored) assistant message
  // carrying the PATHWAY_DOC_MARKER card — see components/ChatPanel.tsx for
  // the rendering side. Used for both the first draft (with its real gap
  // list, parsed straight from the generated document's own Section 2 — see
  // lib/pathway-gaps.ts) and every later revision (no gap list restated).
  // kind: 'first' = the first draft, with its gap list — the asset card
  // follows it, and its Confirm asks what's next; 'linked' = the draft with
  // the shared assets just linked in Section 4; 'revised' = any other version.
  function pathwayDocMessage(markdown: string, kind: 'first' | 'linked' | 'revised', cardNext?: AssetShareState): Message {
    const gaps = kind === 'first' ? extractGapsFromPathwayDraft(markdown) : [];
    const gapsLine = gaps.length ? `\n\nA few things I couldn't find in the documents:\n${gaps.map((g) => `- ${g}`).join('\n')}` : '';
    const intro =
      kind === 'first'
        ? `Here is the pathway document drafted from your documents.${gapsLine}`
        : kind === 'linked'
          ? "Here's the pathway document with your assets linked in Section 4."
          : "Here's the updated pathway document.";
    const close = !cardNext
      ? 'Do you want to make any changes, or send it for review?'
      : cardNext.noneInSection4
        ? 'Next, one question below about reusable assets.'
        : 'Next, share the reusable assets listed in Section 4 below.';
    return { role: 'assistant', content: `${intro}\n\n${PATHWAY_DOC_MARKER}\n\n${close}` };
  }

  function appendPathwayDocMessage(markdown: string, kind: 'first' | 'linked' | 'revised') {
    commitMessages((msgs) => [...msgs, pathwayDocMessage(markdown, kind)]);
  }

  function assetCardMessage(card: AssetShareState): Message {
    return { role: 'assistant', content: assetShareContent(card), displayContent: ASSET_SHARE_MARKER, assetShare: card };
  }

  function newAssetCardId(): string {
    return `assets-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // The first draft and, right under it, the asset card: Section 4's assets
  // to upload or link, or — when it lists none — whether they have any. One
  // commit, so the persisted copy never holds one without the other.
  function appendFirstDraftWithAssetCard(markdown: string) {
    const id = newAssetCardId();
    // commitMessages runs this twice (state + persist), so it stays pure —
    // the id is fixed above.
    commitMessages((msgs) => {
      const items = assetCardItems(markdown, msgs);
      const card: AssetShareState = { id, items, status: 'open', noneInSection4: items.length === 0 };
      return [...msgs, pathwayDocMessage(markdown, 'first', card), assetCardMessage(card)];
    });
  }

  // A later version. In a conversation using asset cards, Section 4 rows no
  // card has asked about yet get a new card right under it.
  function appendRevisedDraft(markdown: string) {
    const id = newAssetCardId();
    commitMessages((msgs) => {
      const usesCards = msgs.some((m) => m.assetShare);
      const items = usesCards ? assetCardItems(markdown, msgs) : [];
      if (items.length === 0) return [...msgs, pathwayDocMessage(markdown, 'revised')];
      const card: AssetShareState = { id, items, status: 'open', noneInSection4: false };
      return [...msgs, pathwayDocMessage(markdown, 'revised', card), assetCardMessage(card)];
    });
  }

  function appendPublishOutcomeMessage(result: { ok: boolean; slug?: string; error?: string }) {
    const content = result.ok
      ? `Sent for review. An administrator will check it before it goes live.\n\n${PATHWAY_DOC_MARKER}`
      : `I couldn't send it for review — ${result.error || 'something went wrong. Try again.'}`;
    update((c) => ({ ...c, messages: [...c.messages, { role: 'assistant', content }] }));
    if (conversationRef.current) void persist(conversationRef.current);
  }

  // Applies the same message-list change to React state and to the persisted
  // row. Builds the persisted copy from conversationRef directly rather than
  // trusting the (batched) state update to have landed first.
  function commitMessages(mutate: (messages: Message[]) => Message[]) {
    const cur = conversationRef.current;
    if (!cur) return;
    const next = { ...cur, messages: mutate(cur.messages) };
    update((c) => ({ ...c, messages: mutate(c.messages) }));
    // Keep the ref current for a synchronous follow-up — the update above
    // may not have run yet.
    conversationRef.current = next;
    void persist(next);
  }

  // What the model reads back in history for a consent card — states the
  // outcome, so it knows not to flag the same file again.
  function toolkitAssetConsentContent(consent: ToolkitAssetConsentState): string {
    const name = consent.candidate.name;
    const line =
      consent.status === 'shared'
        ? `The contributor agreed to share **${name}** publicly as a toolkit asset; it goes live when this pathway is approved.`
        : consent.status === 'declined'
          ? `The contributor chose not to share **${name}** as a toolkit asset.`
          : `Asked the contributor whether **${name}** can be shared publicly as a toolkit asset.`;
    return `${line}\n\n${TOOLKIT_ASSET_CONSENT_MARKER}`;
  }

  function hasToolkitAssetFile(fileName: string): boolean {
    return assetFilesRef.current.has(fileName);
  }

  // Re-selecting a file after a reload (the copy held in memory is lost) so
  // it can still be shared from the resource review card.
  function rememberToolkitAssetFile(file: File) {
    if (isAllowedAssetFile(file.name, file.size)) assetFilesRef.current.set(file.name, file);
  }

  // Uploads (files only, straight to the private bucket via a signed URL)
  // and registers one asset the contributor agreed to share publicly, as an
  // unpublished contribution_units row. Nothing is stored before this runs.
  async function registerToolkitAsset(
    candidate: ToolkitAssetCandidate
  ): Promise<{ ok: true; assetId: string } | { ok: false; error: string }> {
    const cur = conversationRef.current;
    const pathwayId = cur?.meta.pathwayId;
    if (!cur || !pathwayId) return { ok: false, error: "This workspace isn't linked to a pathway." };
    const fileName = 'fileName' in candidate.source ? candidate.source.fileName : null;
    try {
      const base = {
        pathwayId,
        designId: cur.id,
        name: candidate.name,
        purpose: candidate.purpose ?? '',
        reuseCondition: candidate.reuseCondition ?? '',
        dimension: candidate.dimension ?? '',
        stage: candidate.stage ?? '',
        shareConsent: true,
      };
      let body: Record<string, unknown>;
      if (fileName) {
        const file = assetFilesRef.current.get(fileName);
        if (!file) return { ok: false, error: 'Please attach the file again — it has to be re-selected after the page reloads.' };
        const urlRes = await fetch('/api/toolkit-assets/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pathwayId, fileName: file.name, size: file.size }),
        });
        const upload = await urlRes.json().catch(() => ({}));
        if (!urlRes.ok) return { ok: false, error: upload.error ?? 'Could not prepare the upload. Try again.' };
        const { error: uploadError } = await createClient()
          .storage.from(TOOLKIT_ASSET_BUCKET)
          .uploadToSignedUrl(upload.path, upload.token, file, { contentType: upload.contentType });
        if (uploadError) {
          console.error('[toolkit-assets] upload failed:', uploadError);
          return { ok: false, error: 'The upload failed. Try again.' };
        }
        body = { ...base, kind: 'file', storagePath: upload.path, fileName: file.name };
      } else {
        body = { ...base, kind: 'link', linkUrl: 'url' in candidate.source ? candidate.source.url : '' };
      }

      const res = await fetch('/api/toolkit-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error ?? 'Could not save the asset. Try again.' };

      if (fileName) assetFilesRef.current.delete(fileName);
      setToolkitAssetsVersion((v) => v + 1);
      return { ok: true, assetId: data.id as string };
    } catch (err) {
      console.error('[toolkit-assets] share failed:', err);
      return { ok: false, error: 'Something went wrong. Try again.' };
    }
  }

  // LEGACY one-candidate consent card (older conversations only). No →
  // nothing is stored. The card shows the error and stays answerable if
  // anything fails.
  async function answerToolkitAssetConsent(consentId: string, share: boolean): Promise<{ ok: boolean; error?: string }> {
    const cur = conversationRef.current;
    const consent = cur?.messages.find((m) => m.toolkitAssetConsent?.id === consentId)?.toolkitAssetConsent;
    if (!cur || !consent || consent.status !== 'pending') return { ok: true };
    if (consentInFlightRef.current.has(consentId)) return { ok: false };

    const setStatus = (status: ToolkitAssetConsentState['status'], assetId?: string) =>
      commitMessages((msgs) =>
        msgs.map((m) => {
          if (m.toolkitAssetConsent?.id !== consentId) return m;
          const next = { ...m.toolkitAssetConsent, status, assetId };
          return { ...m, toolkitAssetConsent: next, content: toolkitAssetConsentContent(next) };
        })
      );

    if (!share) {
      if ('fileName' in consent.candidate.source) assetFilesRef.current.delete(consent.candidate.source.fileName);
      setStatus('declined');
      return { ok: true };
    }
    consentInFlightRef.current.add(consentId);
    try {
      const result = await registerToolkitAsset(consent.candidate);
      if (!result.ok) return result;
      setStatus('shared', result.assetId);
      return { ok: true };
    } finally {
      consentInFlightRef.current.delete(consentId);
    }
  }

  // ---- Resource review card -------------------------------------------------

  function findResourceReview(reviewId: string): ResourceReviewState | undefined {
    return conversationRef.current?.messages.find((m) => m.resourceReview?.id === reviewId)?.resourceReview;
  }

  function updateResourceReview(reviewId: string, mutate: (review: ResourceReviewState) => ResourceReviewState) {
    commitMessages((msgs) =>
      msgs.map((m) => {
        if (m.resourceReview?.id !== reviewId) return m;
        const next = mutate(m.resourceReview);
        return { ...m, resourceReview: next, content: resourceReviewContent(next) };
      })
    );
  }

  function updateResourceItem(reviewId: string, itemKey: string, patch: Partial<ResourceReviewItem>) {
    updateResourceReview(reviewId, (review) => ({
      ...review,
      items: review.items.map((item) => (item.key === itemKey ? { ...item, ...patch } : item)),
    }));
  }

  // Contributor-only, after each companion turn: where this turn's resource
  // findings go. If the turn came from a card (something attached from it is
  // waiting for this check), that card takes them and settles the
  // attachment. Otherwise, once the first review has happened, they get a
  // fresh card at the bottom (takeFindingsForFreshReview), even while an
  // older card is still open. Before that they wait on the message for the
  // first review to collect.
  function routeResourceFindings(parsed: ParsedGridUpdate | null) {
    const msgs = conversationRef.current?.messages ?? [];
    const candidates = validCandidates(parsed?.toolkitAssetCandidates ?? [], msgs);
    const mentions = parsed?.toolkitAssetMentions ?? [];
    const fromCard = [...msgs]
      .reverse()
      .find((m) => m.resourceReview?.status === 'open' && m.resourceReview.items.some((i) => i.attachedSource))?.resourceReview;
    if (fromCard) {
      const reviewed = reviewedResourceKeys(msgs.filter((m) => m.resourceReview?.id !== fromCard.id));
      updateResourceReview(fromCard.id, (review) => mergeIntoReview(review, candidates, mentions, reviewed));
      return;
    }
    // Until the first review exists (it comes after the questions that
    // follow the first draft), findings wait on their message for it.
    if (!msgs.some((m) => m.resourceReview)) return;
    if (takeFindingsForFreshReview(msgs, candidates, mentions).items.length === 0) return;
    const review: ResourceReviewState = {
      id: `review-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      items: [],
      status: 'open',
      generateOnComplete: false,
    };
    // commitMessages runs this twice (state + persist), so it stays pure —
    // the id is fixed above.
    commitMessages((all) => {
      const { messages, items } = takeFindingsForFreshReview(all, candidates, mentions);
      if (items.length === 0) return all;
      const fresh = { ...review, items };
      return [
        ...messages,
        { role: 'assistant', content: resourceReviewContent(fresh), displayContent: RESOURCE_REVIEW_MARKER, resourceReview: fresh },
      ];
    });
  }

  // Share or don't share one item. Clicking Share is the consent — the card
  // states under the buttons that shared resources are public.
  async function decideResourceItem(
    reviewId: string,
    itemKey: string,
    share: boolean
  ): Promise<{ ok: boolean; error?: string }> {
    const item = findResourceReview(reviewId)?.items.find((i) => i.key === itemKey);
    if (!item || item.status !== 'pending') return { ok: true };
    if (!share) {
      if (item.candidate && 'fileName' in item.candidate.source) assetFilesRef.current.delete(item.candidate.source.fileName);
      updateResourceItem(reviewId, itemKey, { status: 'declined', attachedSource: undefined });
      return { ok: true };
    }
    if (!item.candidate) return { ok: false, error: 'Attach the file or paste its link first.' };
    const flight = `${reviewId}:${itemKey}`;
    if (consentInFlightRef.current.has(flight)) return { ok: false };
    consentInFlightRef.current.add(flight);
    try {
      // Registered under the name the card (and Section 4) uses, so the
      // published document's File column finds its row.
      const result = await registerToolkitAsset({ ...item.candidate, name: item.name });
      if (!result.ok) return result;
      updateResourceItem(reviewId, itemKey, { status: 'shared', assetId: result.assetId });
      return { ok: true };
    } finally {
      consentInFlightRef.current.delete(flight);
    }
  }

  // The text sent to the companion once a file attached from the card has
  // been read (see the auto-send effect below handleUserSend).
  const autoSendRef = useRef<string | null>(null);

  // Attach the missing file for an item (itemKey, one file) or other
  // resources (null, any number at once). They go through the normal upload
  // path — staged, read, then sent to the companion in one message, which
  // checks them like any upload; mergeIntoReview settles them. Nothing here
  // revises the draft: the card's Done does that once.
  function attachForResourceItem(reviewId: string, itemKey: string | null, files: File[]) {
    const c = conversationRef.current;
    const review = findResourceReview(reviewId);
    if (!c || !review || review.status !== 'open' || files.length === 0) return;
    const item = itemKey ? review.items.find((i) => i.key === itemKey) : undefined;
    const picked = item ? files.slice(0, 1) : files;
    if (item) {
      updateResourceItem(reviewId, item.key, { attachedSource: { fileName: picked[0].name } });
    } else {
      updateResourceReview(reviewId, (r) => ({
        ...r,
        items: [
          ...r.items,
          ...picked
            .filter((f) => !r.items.some((i) => i.key === `attached:file:${f.name}`))
            .map((f) => ({
              key: `attached:file:${f.name}`,
              name: f.name,
              attachedSource: { fileName: f.name },
              status: 'pending' as const,
            })),
        ],
      }));
    }
    autoSendRef.current = item
      ? `This is the ${item.name}${item.mentionedIn ? ` mentioned in ${item.mentionedIn}` : ''}.`
      : picked.length > 1
        ? 'Here are other resources I want to share.'
        : 'Here is another resource I want to share.';
    handleAttachFiles(picked, c.meta.flow);
  }

  function linkForResourceItem(reviewId: string, itemKey: string | null, url: string): { ok: boolean; error?: string } {
    const review = findResourceReview(reviewId);
    if (!review || review.status !== 'open') return { ok: false };
    const link = url.trim();
    if (!/^https:\/\/\S+$/.test(link)) return { ok: false, error: 'Links must start with https://' };
    const item = itemKey ? review.items.find((i) => i.key === itemKey) : undefined;
    if (item) {
      updateResourceItem(reviewId, item.key, { attachedSource: { url: link } });
    } else {
      updateResourceReview(reviewId, (r) => ({
        ...r,
        items: [...r.items, { key: `attached:url:${link}`, name: link, attachedSource: { url: link }, status: 'pending' }],
      }));
    }
    void handleUserSend(item ? `Here's the link for the ${item.name}: ${link}` : `Here's another resource I want to share: ${link}`);
    return { ok: true };
  }

  // Undo the "waiting for check" state of items whose file never got sent
  // (e.g. an unsupported type).
  function revertUnsentAttachments() {
    const msgs = conversationRef.current?.messages ?? [];
    const sent = new Set(extractUploadedFileNames(msgs));
    for (const m of msgs) {
      const review = m.resourceReview;
      if (review?.status !== 'open') continue;
      const stale = review.items.filter((i) => i.attachedSource && 'fileName' in i.attachedSource && !sent.has(i.attachedSource.fileName));
      if (stale.length === 0) continue;
      updateResourceReview(review.id, (r) => ({
        ...r,
        items: r.items
          .filter((i) => !(stale.some((s) => s.key === i.key) && i.key.startsWith('attached:')))
          .map((i) => (stale.some((s) => s.key === i.key) ? { ...i, attachedSource: undefined } : i)),
      }));
    }
  }

  // Done — closes a resource review (conversations from before the asset
  // card, 2026-10-12) and asks what's next. A legacy pre-draft review
  // generates the first draft instead.
  async function finishResourceReview(reviewId: string) {
    const review = findResourceReview(reviewId);
    if (!review || review.status !== 'open' || review.items.some((i) => i.status === 'pending')) return;
    if (review.generateOnComplete) {
      updateResourceReview(reviewId, (r) => ({ ...r, status: 'complete' }));
      void runDraftJob(async () => {
        const markdown = await generatePathwayDraft();
        if (!markdown) return;
        await afterCurrentTurn();
        appendPathwayDocMessage(markdown, 'revised');
      });
      return;
    }
    const shared = review.items.some((i) => i.status === 'shared');
    const content = `${shared ? "Thanks — what you've shared will be listed with this pathway." : 'Thanks.'} Do you want to make any changes to the draft, or send it for review?`;
    commitMessages((msgs) => [
      ...msgs.map((m) => {
        if (m.resourceReview?.id !== reviewId) return m;
        const done = { ...m.resourceReview, status: 'complete' as const };
        return { ...m, resourceReview: done, content: resourceReviewContent(done) };
      }),
      { role: 'assistant', content },
    ]);
  }

  // ---- Asset card (since 2026-10-12) ---------------------------------------
  // Everything here is the app acting on the card directly — no companion
  // turn, so a file always lands on the row it was chosen for.

  function findAssetCard(cardId: string): AssetShareState | undefined {
    return conversationRef.current?.messages.find((m) => m.assetShare?.id === cardId)?.assetShare;
  }

  function updateAssetCard(cardId: string, mutate: (card: AssetShareState) => AssetShareState) {
    commitMessages((msgs) =>
      msgs.map((m) => {
        if (m.assetShare?.id !== cardId) return m;
        const next = mutate(m.assetShare);
        return { ...m, assetShare: next, content: assetShareContent(next) };
      })
    );
  }

  function updateAssetItem(cardId: string, itemKey: string, patch: Partial<AssetShareItem>) {
    updateAssetCard(cardId, (card) => ({
      ...card,
      items: card.items.map((item) => (item.key === itemKey ? { ...item, ...patch } : item)),
    }));
  }

  const ASSET_FILE_RULE =
    "can't be shared — use .pdf, .doc/.docx, .ppt/.pptx, .xls/.xlsx, .csv, .txt, .md, or an image, up to 25 MB (ZIP isn't supported yet).";

  // Choose a file for a row (itemKey; the first file), or add files as new
  // assets (null; any number). Held in memory until Confirm.
  function stageAssetFiles(cardId: string, itemKey: string | null, files: File[]): { ok: boolean; error?: string } {
    const card = findAssetCard(cardId);
    if (!card || card.status !== 'open' || files.length === 0) return { ok: false };
    const picked = itemKey ? files.slice(0, 1) : files;
    const bad = picked.find((f) => !isAllowedAssetFile(f.name, f.size));
    if (bad) return { ok: false, error: `${bad.name} ${ASSET_FILE_RULE}` };
    for (const f of picked) assetFilesRef.current.set(f.name, f);
    if (itemKey) {
      updateAssetItem(cardId, itemKey, { staged: { fileName: picked[0].name }, error: undefined });
      return { ok: true };
    }
    updateAssetCard(cardId, (c) => ({
      ...c,
      items: [
        // A file added again after its asset was deleted starts afresh.
        ...c.items.filter((i) => !(i.deleted && picked.some((f) => i.key === `new:file:${f.name}`))),
        ...picked
          .filter((f) => !c.items.some((i) => i.key === `new:file:${f.name}` && !i.deleted))
          .map((f) => ({
            key: `new:file:${f.name}`,
            name: assetNameFromFile(f.name),
            fromSection4: false,
            staged: { fileName: f.name },
          })),
      ],
    }));
    return { ok: true };
  }

  // Add a link for a row, or as a new asset. Only https, exactly as typed.
  function stageAssetLink(cardId: string, itemKey: string | null, url: string): { ok: boolean; error?: string } {
    const card = findAssetCard(cardId);
    if (!card || card.status !== 'open') return { ok: false };
    const link = url.trim();
    if (!/^https:\/\/\S+$/.test(link)) return { ok: false, error: 'Links must start with https://' };
    if (itemKey) {
      updateAssetItem(cardId, itemKey, { staged: { url: link }, error: undefined });
      return { ok: true };
    }
    if (card.items.some((i) => i.key === `new:url:${link}` && !i.deleted)) return { ok: true };
    updateAssetCard(cardId, (c) => ({
      ...c,
      items: [...c.items.filter((i) => i.key !== `new:url:${link}`), { key: `new:url:${link}`, name: linkDomain(link) ?? link, fromSection4: false, staged: { url: link } }],
    }));
    return { ok: true };
  }

  // "Use the file you already uploaded" — needs that file still in memory
  // (lost on reload: the card then asks for it again).
  function takeSuggestedAssetFile(cardId: string, itemKey: string): { ok: boolean; error?: string } {
    const item = findAssetCard(cardId)?.items.find((i) => i.key === itemKey);
    if (!item?.suggestedFile) return { ok: false };
    if (!assetFilesRef.current.has(item.suggestedFile)) {
      return { ok: false, error: `Please upload ${item.suggestedFile} again — files have to be re-selected after the page reloads.` };
    }
    updateAssetItem(cardId, itemKey, { staged: { fileName: item.suggestedFile }, error: undefined });
    return { ok: true };
  }

  // Undo a choice not confirmed yet; an added asset disappears.
  function unstageAsset(cardId: string, itemKey: string) {
    updateAssetCard(cardId, (c) => ({
      ...c,
      items: c.items
        .filter((i) => !(i.key === itemKey && !i.fromSection4 && !i.shared))
        .map((i) => (i.key === itemKey ? { ...i, staged: undefined, error: undefined } : i)),
    }));
  }

  function renameAsset(cardId: string, itemKey: string, name: string) {
    const item = findAssetCard(cardId)?.items.find((i) => i.key === itemKey);
    if (!item || item.fromSection4 || item.shared) return;
    updateAssetItem(cardId, itemKey, { name: name.replace(/\s+/g, ' ').slice(0, 150), error: undefined });
  }

  // "What is it used for?" for an asset the contributor added. A change
  // clears the reuse condition written from the earlier answer.
  function describeAsset(cardId: string, itemKey: string, text: string) {
    const item = findAssetCard(cardId)?.items.find((i) => i.key === itemKey);
    if (!item || item.fromSection4 || item.shared) return;
    updateAssetItem(cardId, itemKey, {
      howItHelped: text.slice(0, 1000),
      reuseCondition: undefined,
      purpose: undefined,
      error: undefined,
    });
  }

  // Purpose and Section 4 reuse condition for an added asset, written from
  // the contributor's "What is it used for?" (mode `asset-reuse`, one short
  // call). Falls back to their own words if the call fails.
  async function deriveAssetReuse(item: AssetShareItem): Promise<{ purpose: string; reuseCondition: string }> {
    const help = (item.howItHelped ?? '').replace(/\s+/g, ' ').trim();
    const fallback = { purpose: help, reuseCondition: help };
    const meta = conversationRef.current?.meta;
    const content = [
      `Asset title: ${item.name}`,
      item.staged ? `${'fileName' in item.staged ? 'File' : 'Link'}: ${sourceLabel(item.staged)}` : '',
      meta?.name ? `Deployment: ${meta.name}` : '',
      [meta?.sector, meta?.geography].filter(Boolean).length ? `Sector · geography: ${[meta?.sector, meta?.geography].filter(Boolean).join(' · ')}` : '',
      `What it is used for (the contributor's words): ${help}`,
    ]
      .filter(Boolean)
      .join('\n');
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'asset-reuse', messages: [{ role: 'user', content }] }),
      });
      if (!res.ok) return fallback;
      const json = (await res.text()).match(/\{[\s\S]*\}/)?.[0];
      const parsed: unknown = json ? JSON.parse(json) : null;
      const field = (key: string) => {
        const value = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>)[key] : null;
        return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
      };
      return { purpose: field('purpose') || help, reuseCondition: field('reuseCondition') || help };
    } catch {
      return fallback;
    }
  }

  // Saves the latest draft again with Section 4 linked to every shared asset
  // and without deleted ones (no model call). Returns the new text, or null
  // when nothing changed.
  async function saveRelinkedDraft(): Promise<string | null> {
    const c = conversationRef.current;
    const draft = pathwayDocRef.current.content;
    if (!c || !draft) return null;
    const linked = section4ForMessages(draft, c.messages);
    if (linked === draft) return null;
    const saved = await insertDraftVersion(c.id, linked, pathwayDocRef.current.versionNumber);
    updatePathwayDoc((prev) => ({
      ...prev,
      content: linked,
      versionNumber: saved?.version_number ?? prev.versionNumber,
      versions: saved ? [saved, ...prev.versions] : prev.versions,
      selectedVersionNumber: null,
    }));
    return linked;
  }

  // Remove an asset shared on an earlier Confirm (only before the pathway is
  // approved — the route refuses a published one). Its link leaves Section 4.
  async function removeSharedAsset(cardId: string, itemKey: string): Promise<{ ok: boolean; error?: string }> {
    const item = findAssetCard(cardId)?.items.find((i) => i.key === itemKey);
    if (!item?.shared) return { ok: true };
    try {
      const res = await fetch(`/api/toolkit-assets/${item.shared.assetId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error ?? 'Could not remove it. Try again.' };
    } catch {
      return { ok: false, error: 'Could not reach the server. Try again.' };
    }
    updateAssetCard(cardId, (c) => ({
      ...c,
      items: c.items
        .filter((i) => !(i.key === itemKey && !i.fromSection4))
        .map((i) => (i.key === itemKey ? { ...i, shared: undefined } : i)),
    }));
    setToolkitAssetsVersion((v) => v + 1);
    void runDraftJob(async () => {
      const linked = await saveRelinkedDraft();
      await afterCurrentTurn();
      if (linked) appendPathwayDocMessage(linked, 'revised');
    });
    return { ok: true };
  }

  // Delete in the Reusable assets popup: the asset leaves the popup and the
  // chat card (a shared file is deleted first), and its row leaves Section 4
  // in a new draft version. It stays on its card as `deleted`, so
  // section4ForMessages keeps that row out of every later draft.
  async function deleteAsset(cardId: string, itemKey: string): Promise<{ ok: boolean; error?: string }> {
    const item = findAssetCard(cardId)?.items.find((i) => i.key === itemKey);
    if (!item || item.deleted) return { ok: true };
    if (item.shared) {
      try {
        const res = await fetch(`/api/toolkit-assets/${item.shared.assetId}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: data.error ?? 'Could not delete it. Try again.' };
      } catch {
        return { ok: false, error: 'Could not reach the server. Try again.' };
      }
      setToolkitAssetsVersion((v) => v + 1);
    }
    updateAssetCard(cardId, (c) => ({
      ...c,
      items: c.items.map((i) =>
        i.key === itemKey ? { key: i.key, name: i.name, fromSection4: i.fromSection4, deleted: true } : i
      ),
    }));
    void runDraftJob(async () => {
      const linked = await saveRelinkedDraft();
      await afterCurrentTurn();
      if (linked) appendPathwayDocMessage(linked, 'revised');
    });
    return { ok: true };
  }

  const confirmingRef = useRef<Set<string>>(new Set());

  // Shares every chosen file or link on a card (the card's note is the
  // consent) and marks it confirmed. If one fails, the card stays open with
  // the error on that row. `sharedAny`: the card now holds a shared asset.
  async function shareAssetCard(cardId: string): Promise<{ ok: boolean; error?: string; sharedAny?: boolean }> {
    const card = findAssetCard(cardId);
    if (!card || card.status !== 'open' || confirmingRef.current.has(cardId)) return { ok: false };
    confirmingRef.current.add(cardId);
    try {
      // An added asset needs a title and "What is it used for?" — the
      // answer becomes its reuse condition in Section 4.
      const added = card.items.filter((i) => i.staged && !i.fromSection4);
      const incomplete = added.filter((i) => !i.name.trim() || !i.howItHelped?.trim());
      if (incomplete.length > 0) {
        for (const i of incomplete) {
          updateAssetItem(cardId, i.key, {
            error: !i.name.trim() ? 'Please give this asset a title.' : 'Please tell us what it is used for.',
          });
        }
        return { ok: false, error: 'Please fill in the title and "What is it used for?" for each asset you added.' };
      }
      // Written once per answer (describeAsset clears it on a change), so a
      // retry after a failed upload doesn't ask again.
      const derived = new Map(
        await Promise.all(
          added
            .filter((i) => !i.reuseCondition)
            .map(async (i) => {
              const d = await deriveAssetReuse(i);
              updateAssetItem(cardId, i.key, d);
              return [i.key, d] as const;
            })
        )
      );

      let failed = 0;
      for (const item of card.items) {
        if (!item.staged) continue;
        const d = derived.get(item.key);
        const result = await registerToolkitAsset({
          source: item.staged,
          name: item.name.trim(),
          purpose: d?.purpose ?? item.purpose ?? '',
          reuseCondition: d?.reuseCondition ?? item.reuseCondition ?? '',
          dimension: '',
          stage: '',
          sensitiveNote: '',
        });
        if (result.ok) {
          updateAssetItem(cardId, item.key, { shared: { assetId: result.assetId, source: item.staged }, staged: undefined, error: undefined });
        } else {
          failed++;
          updateAssetItem(cardId, item.key, { error: result.error });
        }
      }
      if (failed > 0) {
        return { ok: false, error: `${failed === 1 ? 'One asset' : `${failed} assets`} couldn't be shared — see the card.` };
      }
      updateAssetCard(cardId, (c) => ({ ...c, status: 'confirmed' }));
      return { ok: true, sharedAny: (findAssetCard(cardId)?.items ?? []).some((i) => i.shared) };
    } finally {
      confirmingRef.current.delete(cardId);
    }
  }

  // After a Confirm: links the shared assets in Section 4 and asks what's next.
  function afterAssetsConfirmed(sharedAny: boolean) {
    void runDraftJob(async () => {
      const linked = sharedAny ? await saveRelinkedDraft() : null;
      await afterCurrentTurn();
      if (linked) appendPathwayDocMessage(linked, 'linked');
      else {
        commitMessages((msgs) => [
          ...msgs,
          { role: 'assistant', content: 'Thanks. Do you want to make any changes to the draft, or send it for review?' },
        ]);
      }
    });
  }

  async function confirmAssetCard(cardId: string): Promise<{ ok: boolean; error?: string }> {
    const result = await shareAssetCard(cardId);
    if (result.ok) afterAssetsConfirmed(!!result.sharedAny);
    return result;
  }

  // Confirm in the Reusable assets popup: every open card at once, with one
  // follow-up in chat.
  async function confirmOpenAssetCards(): Promise<{ ok: boolean; error?: string }> {
    const open = (conversationRef.current?.messages ?? []).flatMap((m) =>
      m.assetShare?.status === 'open' ? [m.assetShare.id] : []
    );
    if (open.length === 0) return { ok: false };
    let sharedAny = false;
    for (const cardId of open) {
      const result = await shareAssetCard(cardId);
      if (!result.ok) return result;
      sharedAny ||= !!result.sharedAny;
    }
    afterAssetsConfirmed(sharedAny);
    return { ok: true };
  }

  // A file chosen in the Reusable assets popup. A confirmed card opens again,
  // as its "Add more assets" would, and closes back if the file is refused.
  function stageAssetFilesFromList(cardId: string, itemKey: string | null, files: File[]): { ok: boolean; error?: string } {
    const wasConfirmed = findAssetCard(cardId)?.status === 'confirmed';
    if (wasConfirmed) reopenAssetCard(cardId);
    const result = stageAssetFiles(cardId, itemKey, files);
    if (!result.ok && wasConfirmed) updateAssetCard(cardId, (c) => ({ ...c, status: 'confirmed' }));
    return result;
  }

  // "Add more assets" on a confirmed card.
  function reopenAssetCard(cardId: string) {
    updateAssetCard(cardId, (c) => ({ ...c, status: 'open' }));
  }

  // ---- "May this pathway be published?" ------------------------------------

  // Asked before every Send for Review, whether it came from the document
  // pane's button or the contributor asking in chat.
  async function requestPublishConsent(): Promise<{ ok: boolean; error?: string }> {
    const msgs = conversationRef.current?.messages ?? [];
    if (msgs.some((m) => m.publishConsent?.status === 'pending')) return { ok: true };
    const consent: PublishConsentState = { id: `publish-${Date.now()}-${Math.random().toString(36).slice(2)}`, status: 'pending' };
    commitMessages((all) => [
      ...all,
      { role: 'assistant', content: publishConsentContent(consent), displayContent: PUBLISH_CONSENT_MARKER, publishConsent: consent },
    ]);
    return { ok: true };
  }

  async function answerPublishConsent(
    consentId: string,
    choice: 'send' | 'keep' | 'delete'
  ): Promise<{ ok: boolean; error?: string }> {
    const cur = conversationRef.current;
    const consent = cur?.messages.find((m) => m.publishConsent?.id === consentId)?.publishConsent;
    if (!cur || !consent || consent.status !== 'pending') return { ok: true };
    const setStatus = (status: PublishConsentState['status'], persistIt = true) => {
      const mutate = (msgs: Message[]) =>
        msgs.map((m) => {
          if (m.publishConsent?.id !== consentId) return m;
          const next = { ...m.publishConsent, status };
          return { ...m, publishConsent: next, content: publishConsentContent(next) };
        });
      if (persistIt) commitMessages(mutate);
      else update((c) => ({ ...c, messages: mutate(c.messages) }));
    };

    if (choice === 'keep') {
      setStatus('kept');
      return { ok: true };
    }
    if (choice === 'delete') {
      try {
        const res = await fetch(`/api/contributions/${cur.id}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: data.error ?? 'Could not delete this contribution. Try again.' };
      } catch {
        return { ok: false, error: 'Could not reach the server. Try again.' };
      }
      // The row is gone — nothing left to persist into.
      setStatus('deleted', false);
      return { ok: true };
    }

    setLoading(true);
    try {
      // A draft still being written goes out, not the one before it.
      await draftQueueRef.current;
      const result = await publishPathwayDocument();
      if (!result.ok) return { ok: false, error: result.error };
      setStatus('sent');
      appendPublishOutcomeMessage(result);
      return { ok: true };
    } finally {
      setLoading(false);
    }
  }

  // Explorer-only: generates the Guidance intent's Analysis Document, or the
  // separate Executive Summary, via its own /api/chat mode and stores it in
  // design_documents. Triggered automatically from sendMessage below off the
  // companion's explorerAction signal — there's no manual generate button;
  // the model offers it, the user says yes, and this runs.
  async function generateExplorerDocument(docType: DocType): Promise<DesignDocumentRow | null> {
    const c = conversationRef.current;
    if (!c) return null;

    const stateKey = docType === 'analysis' ? 'analysis' : 'summary';
    const previous = explorerDocRef.current[stateKey];
    const hash = hashConversationState(c.messages, c.grid);

    // Nothing has moved since the stored version — serve it rather than
    // paying for an identical regeneration (see hashConversationState).
    if (previous && previous.content_hash === hash) return previous;

    updateExplorerDoc((prev) => ({ ...prev, generating: docType, error: null }));

    try {
      // The Executive Summary's second half summarizes the suggestions in the
      // Analysis Document, so the current analysis is handed to the model as
      // trailing context — same idiom generatePathwayDraft uses for a prior
      // draft. Its prompt handles the "no analysis yet" case on its own.
      const analysisContent = docType === 'plan' ? explorerDocRef.current.analysis?.content : undefined;
      const trailing = [
        ...(analysisContent ? [{ role: 'assistant', content: analysisContent }] : []),
        {
          role: 'user',
          content:
            docType === 'analysis'
              ? 'Generate the analysis document now.'
              : 'Generate the executive summary now.',
        },
      ];

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...toApiMessages(c.messages), ...trailing],
          mode: docType === 'analysis' ? 'analysis-doc' : 'executive-summary',
          grid: c.grid,
          meta: c.meta,
        }),
      });
      // Never save an error body as a document version.
      if (!res.ok || !res.body) throw new ChatRequestError(await chatErrorText(res));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }

      const row = await insertDesignDocumentVersion(c.id, docType, hash, text, previous?.version_number ?? 0);
      if (!row) throw new Error('Could not save the document.');

      updateExplorerDoc((prev) => ({ ...prev, [stateKey]: row, generating: null }));
      return row;
    } catch (err) {
      updateExplorerDoc((prev) => ({
        ...prev,
        generating: null,
        error: err instanceof ChatRequestError ? err.message : GENERIC_ERROR_MESSAGE,
      }));
      return null;
    }
  }

  function openExplorerDocument(docType: DocType) {
    updateExplorerDoc((prev) => ({ ...prev, open: docType, error: null }));
  }

  function closeExplorerDocument() {
    updateExplorerDoc((prev) => ({ ...prev, open: null }));
  }

  // Appends one client-constructed (never model-authored) assistant message
  // carrying the marker that renders a card reopening the stored document —
  // the Explorer equivalent of appendPathwayDocMessage above. The first-
  // generation variant (typically the upload-triggered auto-analysis — see
  // the "On document uploads" rule in lib/explorer-intents.ts) frames the doc
  // as "here's my analysis" and asks the follow-up question that steers what
  // the user works on next; a later regeneration keeps the terser line since
  // the follow-up would feel repetitive.
  function appendExplorerDocMessage(docType: DocType, opts: { isFirstGeneration: boolean } = { isFirstGeneration: false }) {
    let content: string;
    if (docType === 'analysis') {
      const intro = opts.isFirstGeneration
        ? `Here's my analysis of your adoption — open it to see the full picture.`
        : `Your analysis document is ready — it pulls together what we've covered so far.`;
      const followup = opts.isFirstGeneration
        ? `\n\nWould you like to work on any of the specific gaps it surfaces, or see relevant learnings from other adoptions?`
        : '';
      content = `${intro}\n\n${ANALYSIS_DOC_MARKER}${followup}`;
    } else {
      content = `Here's the executive summary. It's the shorter companion piece — your analysis document is still the fuller picture.\n\n${EXEC_SUMMARY_MARKER}`;
    }

    update((c) => ({ ...c, messages: [...c.messages, { role: 'assistant', content }] }));
    if (conversationRef.current) void persist(conversationRef.current);
  }

  // Reacts to the Explorer companion's explorerAction — see the JSON contract
  // in lib/system-prompts.ts. Runs after the companion's own reply has
  // finished streaming (from inside sendMessage below), so the "Thinking…"
  // indicator covers the extra generation round trip, and opens the document
  // as soon as it exists rather than making the user go hunting for it.
  async function handleExplorerAction(action: NonNullable<ParsedGridUpdate['explorerAction']>) {
    const docType: DocType | null =
      action.type === 'analysis' ? 'analysis' : action.type === 'executive-summary' ? 'plan' : null;
    if (!docType) return;

    // A first-time generation (no prior row in explorerDoc for this docType)
    // gets the "here's my analysis" framing plus the "gaps vs learnings"
    // follow-up in the client card; a regeneration keeps the terser line. See
    // appendExplorerDocMessage.
    const stateKey = docType === 'analysis' ? 'analysis' : 'summary';
    const isFirstGeneration = !explorerDocRef.current[stateKey];

    // No auto-open — matches the Contributor pathway pane, which stays closed
    // until the user clicks its chat card. The chat's own "Thinking…"
    // indicator already covers the generation wait, and auto-popping a modal
    // on a turn the user didn't explicitly ask for one is more disruptive
    // than useful. A generation failure surfaces via explorerDoc.error the
    // next time the user opens the modal from the card.
    const row = await generateExplorerDocument(docType);
    if (row) appendExplorerDocMessage(docType, { isFirstGeneration });
  }

  // Resolves once no companion turn is streaming. Whatever follows in the
  // same tick can append to the chat safely.
  async function afterCurrentTurn() {
    while (turnRef.current) await turnRef.current;
  }

  // Queues a draft job behind any already running. Not awaited by the chat
  // turn that started it, so typing and the cards stay usable meanwhile.
  function runDraftJob(job: () => Promise<void>): Promise<void> {
    const next = draftQueueRef.current.then(job).catch(() => {});
    draftQueueRef.current = next;
    return next;
  }

  // Reacts to the Contributor companion's pathwayAction — see
  // contributorSystemPrompt's JSON contract in lib/system-prompts.ts. Runs
  // after the companion's own reply has finished streaming, from inside
  // sendMessage below, so the "Thinking…" indicator naturally covers the
  // extra draft-generation round trip too.
  async function handlePathwayAction(action: NonNullable<ParsedGridUpdate['pathwayAction']>) {
    if (action.type === 'generate') {
      // A legacy pre-draft review still open drafts when it's finished, so
      // "generate" waits for it.
      const msgs = conversationRef.current?.messages ?? [];
      if (msgs.some((m) => m.resourceReview?.status === 'open' && m.resourceReview.generateOnComplete)) return;
      const markdown = await generatePathwayDraft();
      if (!markdown) return;
      await afterCurrentTurn();
      // The first real draft is followed straight away by the asset card. The
      // drafter's "not enough to draft" fallback isn't a draft.
      const now = conversationRef.current?.messages ?? [];
      const notADraft = markdown.trim().startsWith('Not enough of this adoption');
      const hadDraft = now.some((m) => m.role === 'assistant' && m.content.includes(PATHWAY_DOC_MARKER));
      if (!notADraft && !hadDraft && !now.some((m) => m.resourceReview)) appendFirstDraftWithAssetCard(markdown);
      else if (notADraft) appendPathwayDocMessage(markdown, 'first');
      else appendRevisedDraft(markdown);
    } else if (action.type === 'revise') {
      const markdown = await generatePathwayDraft(action.instruction || 'Apply the requested change.');
      if (!markdown) return;
      await afterCurrentTurn();
      appendRevisedDraft(markdown);
    } else if (action.type === 'publish') {
      await requestPublishConsent();
    }
  }

  const runTurn = useCallback(
    async (id: string, history: Message[], userMessage: Message, flow: AdoptionFlow, grid: GridState, meta: AdoptionMeta) => {
      const next: Message[] = [...history, userMessage];
      update((c) => ({ ...c, messages: next }));
      setLoading(true);

      // A turn that can't complete ends in a notice bubble (never sent back as
      // history or saved) and stops the loading state; nothing else in the
      // turn — grid writes, persistence, pathway/explorer actions — runs.
      const failTurn = (content: string, replaceLast = false) => {
        update((c) => {
          const msgs = replaceLast ? c.messages.slice(0, -1) : [...c.messages];
          return { ...c, messages: [...msgs, { role: 'assistant', content, notice: true }] };
        });
        setLoading(false);
      };

      let res: Response;
      try {
        res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: toApiMessages(next),
            mode: 'companion',
            designId: id,
            flow,
            grid,
            meta,
            // Lets the Contributor flow recognize it's adding to an already-
            // published pathway (see contributorSystemPrompt) rather than
            // demanding a from-scratch write-up — same field pathway-draft
            // generation already uses to merge into it (see
            // generatePathwayDraft above).
            existingPublishedDoc: flow === 'contributor' ? pathwayDocRef.current.pathwayPublishedContent : undefined,
          }),
        });
      } catch {
        failTurn(GENERIC_ERROR_MESSAGE);
        return;
      }

      if (!res.ok || !res.body) {
        failTurn(await chatErrorText(res));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      let lastParsed: ParsedGridUpdate | null = null;

      update((c) => ({ ...c, messages: [...c.messages, { role: 'assistant', content: '' }] }));

      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch {
          // The reply broke off partway: keep what arrived, add the generic
          // message under it, and stop — the partial reply isn't Cube's answer.
          const partial = stripGridUpdate(assistantText).trim();
          failTurn(partial ? `${partial}\n\n${GENERIC_ERROR_MESSAGE}` : GENERIC_ERROR_MESSAGE, true);
          return;
        }
        const { done, value } = chunk;
        if (done) break;
        assistantText += decoder.decode(value, { stream: true });

        const parsed = parseGridUpdate(assistantText);
        if (parsed) {
          lastParsed = parsed;
          update((c) => {
            const nextGrid = { ...c.grid };
            for (const [key, cell] of Object.entries(parsed.cells)) {
              if (cell && key in nextGrid) nextGrid[key] = cell;
            }
            const m = parsed.meta;
            // A confirmed intent switch (Explorer only) restarts the numbered
            // flow — it's the one case where flowStep is allowed to go
            // backward, since the new intent's steps are a different list.
            const nextIntent = m?.intent || c.meta.intent;
            const intentChanged = nextIntent !== c.meta.intent;
            const nextMeta: AdoptionMeta = {
              ...c.meta,
              name: m?.name || c.meta.name,
              sector: m?.sector || c.meta.sector,
              geography: m?.geography || c.meta.geography,
              stage: m?.stage || c.meta.stage,
              summary: m?.summary || c.meta.summary,
              intent: nextIntent,
              flowStep: intentChanged
                ? parsed.flowStep ?? 1
                : parsed.flowStep != null
                  ? Math.max(c.meta.flowStep, parsed.flowStep)
                  : c.meta.flowStep,
              hypothesis: m?.hypothesis || c.meta.hypothesis,
              biggestRisk: m?.biggestRisk || c.meta.biggestRisk,
              confidence: m?.confidence || c.meta.confidence,
              decision: m?.decision || c.meta.decision,
              conversationMode: m?.conversationMode || c.meta.conversationMode,
              persona: m?.persona || c.meta.persona,
              cubeAssessment: m?.cubeAssessment
                ? {
                    currentStage: m.cubeAssessment.currentStage ?? c.meta.cubeAssessment.currentStage,
                    coveredDimensions: m.cubeAssessment.coveredDimensions ?? c.meta.cubeAssessment.coveredDimensions,
                    partialDimensions: m.cubeAssessment.partialDimensions ?? c.meta.cubeAssessment.partialDimensions,
                    missingDimensions: m.cubeAssessment.missingDimensions ?? c.meta.cubeAssessment.missingDimensions,
                    assessmentConfirmed:
                      m.cubeAssessment.assessmentConfirmed ?? c.meta.cubeAssessment.assessmentConfirmed,
                  }
                : c.meta.cubeAssessment,
            };
            return { ...c, grid: nextGrid, meta: nextMeta };
          });
        }

        const stripped = stripGridUpdate(assistantText);
        update((c) => {
          const msgs = [...c.messages];
          msgs[msgs.length - 1] = { role: 'assistant', content: stripped };
          return { ...c, messages: msgs };
        });
      }

      // Final message, with the turn's grid_update fields attached.
      // pathwaysReferenced is stored on the message so source attribution
      // survives reload without re-parsing the stripped grid_update.
      const finalContent = stripGridUpdate(assistantText);
      const finalRefs = lastParsed?.pathwaysReferenced;
      // Explorer-only: toolkit assets offered this turn — kept on the message
      // (like pathwaysReferenced) so the download cards survive reload.
      const finalAssets = flow === 'explorer' ? lastParsed?.toolkitAssetsReferenced : undefined;
      // Contributor-only: this turn's resource findings — kept on the message
      // so the first resource review can collect them, across reloads.
      const finalCandidates = flow === 'contributor' ? lastParsed?.toolkitAssetCandidates : undefined;
      const finalMentions = flow === 'contributor' ? lastParsed?.toolkitAssetMentions : undefined;
      const finalMsg = {
        role: 'assistant' as const,
        content: finalContent,
        ...(finalRefs?.length ? { pathwaysReferenced: finalRefs } : {}),
        ...(finalAssets?.length ? { toolkitAssetsReferenced: finalAssets } : {}),
        ...(finalCandidates?.length ? { toolkitAssetCandidates: finalCandidates } : {}),
        ...(finalMentions?.length ? { toolkitAssetMentions: finalMentions } : {}),
      };
      update((c) => {
        const msgs = [...c.messages];
        msgs[msgs.length - 1] = finalMsg;
        return { ...c, messages: msgs };
      });

      // Persist with pathwaysReferenced explicitly included — React 18+
      // batches async setState so conversationRef may not yet reflect the
      // update above when persist() is called on the next line. Build the
      // correct final state directly instead of relying on the ref.
      if (conversationRef.current && conversationRef.current.id === id) {
        const cur = conversationRef.current;
        const msgs = [...cur.messages];
        msgs[msgs.length - 1] = finalMsg;
        void persist({ ...cur, messages: msgs });
        // Keep the ref current for the synchronous follow-ups below
        // (routeResourceFindings, handlePathwayAction) — the update above may
        // not have run yet.
        conversationRef.current = { ...cur, messages: msgs };
      }

      // A turn started from a resource review card (something attached there
      // is waiting for this check) never redrafts: the card's Done revises
      // once for everything added. Read before routing clears the wait.
      const fromCard =
        flow === 'contributor' &&
        (conversationRef.current?.messages ?? []).some(
          (m) => m.resourceReview?.status === 'open' && m.resourceReview.items.some((i) => i.attachedSource)
        );

      // Contributor-only: this turn's resources go to the review card (see
      // routeResourceFindings) — nothing is uploaded until the contributor
      // agrees on it.
      if (flow === 'contributor') routeResourceFindings(lastParsed);

      // Contributor-only: react to the companion's pathwayAction, if any.
      // Drafting runs in the background (runDraftJob) so the chat and the
      // cards stay usable while it's written; the pane and a note in the
      // chat show it's running. "publish" only raises a card, so it's quick.
      const pathwayAction = lastParsed?.pathwayAction;
      if (flow === 'contributor' && pathwayAction && pathwayAction.type !== 'none') {
        if (fromCard && pathwayAction.type !== 'publish') {
          // Ignored — see fromCard above.
        } else if (pathwayAction.type === 'publish') await handlePathwayAction(pathwayAction);
        else void runDraftJob(() => handlePathwayAction(pathwayAction));
      }

      // Explorer-only equivalent: the Guidance intent's Analysis Document /
      // Executive Summary, generated the same way and for the same reason.
      if (flow === 'explorer' && lastParsed?.explorerAction && lastParsed.explorerAction.type !== 'none') {
        await handleExplorerAction(lastParsed.explorerAction);
      }

      setLoading(false);
    },
    [update]
  );

  // One companion turn, tracked in turnRef so background work (drafts) never
  // appends to the chat while it streams.
  const sendMessage = useCallback(
    (id: string, history: Message[], userMessage: Message, flow: AdoptionFlow, grid: GridState, meta: AdoptionMeta) => {
      const turn = runTurn(id, history, userMessage, flow, grid, meta);
      const tracked: Promise<void> = turn
        .catch(() => {})
        .finally(() => {
          if (turnRef.current === tracked) turnRef.current = null;
        });
      turnRef.current = tracked;
      return turn;
    },
    [runTurn]
  );

  // Creates the row on first use; a no-op if the conversation already exists
  // (in which case `flow`/`intent` are ignored — they only matter at creation
  // time; an intent can still change later, but only through a confirmed
  // switch in sendMessage above). Concurrent callers (e.g. several dropped
  // files each kicking off extraction) share the same in-flight insert rather
  // than racing.
  function ensureCreated(flow: AdoptionFlow = '', intent: ExplorerIntent = ''): Promise<AdoptionConversation> {
    if (conversationRef.current) return Promise.resolve(conversationRef.current);
    if (creatingRef.current) return creatingRef.current;

    const promise = (async () => {
      try {
        const supabase = createClient();

        // A second (or later) contributor joining a pathway another
        // contributor already named and described shouldn't see "New
        // adoption" until the model gets around to re-stating it — the
        // pathway itself already has that information.
        let name = '';
        let summary = '';
        if (pathwayId) {
          const { data: pw } = await supabase.from('pathways').select('title, description').eq('id', pathwayId).maybeSingle();
          if (pw) {
            name = pw.title ?? '';
            summary = pw.description ?? '';
          }
        }

        const initialMeta: AdoptionMeta = { ...EMPTY_META, flow, intent, pathwayId: pathwayId ?? '', name, summary };
        const insertPayload: Record<string, unknown> = {
          meta: initialMeta,
          grid_state: EMPTY_GRID,
          messages: [],
        };
        if (pathwayId) insertPayload.pathway_id = pathwayId;
        const { data, error } = await supabase
          .from('designs')
          .insert(insertPayload)
          .select()
          .single();

        if (error || !data) {
          console.error('Failed to create adoption row:', error);
          throw new Error('Could not start a new adoption workspace. Try again.');
        }

        const created = rowToConversation(data as AdoptionRow);
        conversationRef.current = created;
        setConversation(created);
        onCreated?.(created);
        return created;
      } finally {
        creatingRef.current = null;
      }
    })();

    creatingRef.current = promise;
    return promise;
  }

  // Silent, one-shot extraction pass (mode `extract-insights`): reads one
  // uploaded document on its own, before the user has said anything, and
  // seeds the grid immediately rather than waiting for a chat turn. Never
  // blocks or surfaces an error to the user — the document's text still
  // reaches the model normally once they do send a message.
  async function extractInsightsForAttachment(text: string, flow: AdoptionFlow, intent: ExplorerIntent) {
    try {
      const c = await ensureCreated(flow, intent);

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: text }],
          mode: 'extract-insights',
          grid: c.grid,
          // Lets the Usage page count this upload under Analyse or Contribute.
          flow: c.meta.flow,
        }),
      });
      if (!res.ok || !res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
      }

      const parsed = parseGridUpdate(full);
      if (!parsed) return;

      update((cur) => {
        const nextGrid = { ...cur.grid };
        for (const [key, cell] of Object.entries(parsed.cells)) {
          if (cell && key in nextGrid) nextGrid[key] = cell;
        }
        const m = parsed.meta;
        const nextMeta: AdoptionMeta = {
          ...cur.meta,
          name: m?.name || cur.meta.name,
          sector: m?.sector || cur.meta.sector,
          geography: m?.geography || cur.meta.geography,
          stage: m?.stage || cur.meta.stage,
          summary: m?.summary || cur.meta.summary,
          flowStep: parsed.flowStep != null ? Math.max(cur.meta.flowStep, parsed.flowStep) : cur.meta.flowStep,
        };
        return { ...cur, grid: nextGrid, meta: nextMeta };
      });

      if (conversationRef.current) void persist(conversationRef.current);
    } catch {
      // Best-effort enhancement — silently give up; nothing else depends on it.
    }
  }

  const handleUserSend = useCallback(
    async (text: string, flow: AdoptionFlow = '', intent: ExplorerIntent = '') => {
      const readyAttachments = pendingAttachments.filter((a) => a.state === 'ready');
      const c = await ensureCreated(flow, intent);
      const activeFlow = c.meta.flow;

      if (readyAttachments.length > 0) {
        const images = readyAttachments.filter((a) => a.kind === 'image').map((a) => a.image!);
        const textParts = readyAttachments
          .filter((a) => a.kind === 'text')
          .map((a) => `--- Uploaded: ${a.name} ---\n${a.text}`);
        const assetParts = readyAttachments
          .filter((a) => a.kind === 'asset')
          .map(
            (a) =>
              `--- Uploaded asset file: ${a.name} (${(assetExtension(a.name) ?? 'file').toUpperCase()}, ${formatBytes(a.sizeBytes ?? 0)}) — its contents can't be read here; judge it from its name and what the contributor says about it ---`
          );

        const baseText =
          text || 'Please read the attached file(s) and tell me what they establish about this adoption.';
        const content = [baseText, ...textParts, ...assetParts].join('\n\n');
        const displayLines = [
          ...(text ? [text] : []),
          ...readyAttachments.map((a) => `${a.kind === 'image' ? '🖼️' : a.kind === 'asset' ? '📎' : '📄'} Uploaded **${a.name}**`),
        ];

        setPendingAttachments([]);

        sendMessage(
          c.id,
          c.messages,
          {
            role: 'user',
            content,
            displayContent: displayLines.join('\n'),
            images: images.length ? images : undefined,
          },
          activeFlow,
          c.grid,
          c.meta
        );
        return;
      }

      sendMessage(c.id, c.messages, { role: 'user', content: text }, activeFlow, c.grid, c.meta);
    },
    [pendingAttachments, sendMessage]
  );

  // A file attached from the resource review card is sent to the companion
  // as soon as it's been read (attachForResourceItem sets the text). If it
  // couldn't be read or isn't an allowed type, nothing is sent and the item
  // goes back to waiting for a file.
  useEffect(() => {
    const text = autoSendRef.current;
    if (!text || loading || pendingAttachments.length === 0) return;
    if (pendingAttachments.some((a) => a.state === 'reading')) return;
    autoSendRef.current = null;
    if (pendingAttachments.some((a) => a.state === 'ready')) void handleUserSend(text);
    else revertUnsentAttachments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAttachments, loading, handleUserSend]);

  function handleAttachFiles(files: File[], flow: AdoptionFlow = '', intent: ExplorerIntent = '') {
    const isContributor = (conversationRef.current?.meta.flow || flow) === 'contributor';
    for (const file of files) {
      const attachmentId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const assetEligible = isContributor && isAllowedAssetFile(file.name, file.size);
      if (assetEligible) assetFilesRef.current.set(file.name, file);
      const markAsAssetOnly = () =>
        setPendingAttachments((s) =>
          s.map((a) => (a.id === attachmentId ? { ...a, state: 'ready', kind: 'asset', sizeBytes: file.size } : a))
        );

      // CSV is plain text: in the contributor flow read it so the companion
      // can see what's actually in it (e.g. a filled-in test set) when
      // judging whether it's a toolkit asset — the Explorer flow still
      // doesn't take CSV at all.
      if (assetEligible && assetExtension(file.name) === 'csv') {
        setPendingAttachments((s) => [...s, { id: attachmentId, name: file.name, state: 'reading' }]);
        file
          .text()
          .then((text) => {
            if (!text.trim()) throw new Error('empty');
            setPendingAttachments((s) =>
              s.map((a) => (a.id === attachmentId ? { ...a, state: 'ready', kind: 'text', text } : a))
            );
            if (conversationRef.current) void extractInsightsForAttachment(text, flow, intent);
          })
          .catch(() => markAsAssetOnly());
        continue;
      }

      if (!getFileExtension(file.name)) {
        if (assetEligible) {
          setPendingAttachments((s) => [
            ...s,
            { id: attachmentId, name: file.name, state: 'ready', kind: 'asset', sizeBytes: file.size },
          ]);
          continue;
        }
        setPendingAttachments((s) => [
          ...s,
          {
            id: attachmentId,
            name: file.name,
            state: 'error',
            error: isContributor
              ? 'Unsupported type — use .pdf, .doc/.docx, .ppt/.pptx, .xls/.xlsx, .csv, .txt, .md, or an image (ZIP isn\'t supported yet).'
              : 'Unsupported type — use .pdf, .docx, .xlsx, .xls, .pptx, .txt, .md, or an image.',
          },
        ]);
        continue;
      }

      setPendingAttachments((s) => [...s, { id: attachmentId, name: file.name, state: 'reading' }]);

      (async () => {
        try {
          if (isImageFile(file.name)) {
            const image = await fileToImageBlock(file);
            setPendingAttachments((s) =>
              s.map((a) => (a.id === attachmentId ? { ...a, state: 'ready', kind: 'image', image } : a))
            );
          } else {
            const text = await extractTextFromFile(file);
            if (!text) throw new Error('No readable text found — it may be a scanned/image PDF.');
            setPendingAttachments((s) =>
              s.map((a) => (a.id === attachmentId ? { ...a, state: 'ready', kind: 'text', text } : a))
            );
            // Only pre-seed the grid for an upload into an already-open
            // conversation. On the welcome screen (no row yet), this used to
            // eagerly create the row and flip the UI straight into the chat
            // view before the user had actually sent anything — the file's
            // text still reaches the model normally as part of the real
            // first message once they press Start, so nothing is lost by
            // waiting.
            if (conversationRef.current) void extractInsightsForAttachment(text, flow, intent);
          }
        } catch (err) {
          // Too big to send as an image, or no readable text — still usable
          // as a toolkit asset file in the contributor flow.
          if (assetEligible) {
            markAsAssetOnly();
            return;
          }
          setPendingAttachments((s) =>
            s.map((a) =>
              a.id === attachmentId
                ? { ...a, state: 'error', error: err instanceof Error ? err.message : `Could not read ${file.name}.` }
                : a
            )
          );
        }
      })();
    }
  }

  function removeAttachment(attachmentId: string) {
    setPendingAttachments((s) => s.filter((a) => a.id !== attachmentId));
  }

  return {
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
    stageAssetFiles,
    stageAssetLink,
    takeSuggestedAssetFile,
    unstageAsset,
    renameAsset,
    describeAsset,
    removeSharedAsset,
    confirmAssetCard,
    confirmOpenAssetCards,
    stageAssetFilesFromList,
    deleteAsset,
    reopenAssetCard,
    finishResourceReview,
    requestPublishConsent,
    answerPublishConsent,
    toolkitAssetsVersion,
    pathwayDoc,
    pathwayPreview,
    openPathwayDocument,
    closePathwayDocument,
    selectPathwayDocVersion,
    publishPathwayDocument,
    explorerDoc,
    openExplorerDocument,
    closeExplorerDocument,
  };
}
