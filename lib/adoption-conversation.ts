import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_GRID, type GridState } from '@/lib/dimensions';
import { Message } from '@/components/ChatPanel';
import { createClient } from '@/lib/supabase/client';
import { extractTextFromFile, fileToImageBlock, getFileExtension, isImageFile } from '@/lib/extract-text';
import {
  MAX_ASSET_MENTIONS_PER_ASK,
  TOOLKIT_ASSET_BUCKET,
  assetExtension,
  assetMentionKey,
  buildAssetMentionAsk,
  candidateSourceKey,
  isAllowedAssetFile,
  type ToolkitAssetCandidate,
  type ToolkitAssetConsentState,
  type ToolkitAssetMention,
} from '@/lib/toolkit-assets';
import {
  parseGridUpdate,
  stripGridUpdate,
  ANALYSIS_DOC_MARKER,
  DELIVERABLE_START,
  EXEC_SUMMARY_MARKER,
  PATHWAY_DOC_MARKER,
  TOOLKIT_ASSET_CONSENT_MARKER,
  type ParsedGridUpdate,
} from '@/lib/grid-update';
import { extractGapsFromPathwayDraft } from '@/lib/pathway-gaps';
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
// Contributor-only: artifacts the companion saw named in the material
// (Message.toolkitAssetMentions) that haven't been asked about yet and
// haven't already reached a consent card. Nothing at all once the contributor
// has declined attaching assets.
export function pendingAssetMentions(messages: Message[]): ToolkitAssetMention[] {
  if (messages.some((m) => m.toolkitAssetAskDeclined)) return [];
  const done = new Set<string>();
  for (const m of messages) {
    for (const key of m.toolkitAssetMentionsAsked ?? []) done.add(key);
    if (m.toolkitAssetConsent) done.add(assetMentionKey(m.toolkitAssetConsent.candidate.name));
  }
  const pending: ToolkitAssetMention[] = [];
  for (const mention of messages.flatMap((m) => m.toolkitAssetMentions ?? [])) {
    const key = assetMentionKey(mention.name);
    if (!key || done.has(key)) continue;
    done.add(key);
    pending.push(mention);
  }
  return pending;
}

export function toApiMessages(messages: Message[]) {
  return messages.map(({ role, content, images }) => ({
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
        messages: c.messages,
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

    const trailingMessage = revisionInstruction
      ? `Please revise the pathway draft as follows: ${revisionInstruction}. Return the full revised document in the same Sections 0-6 + Source Trace appendix format.`
      : 'Draft my adoption as a pathway page now.';

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
      if (!res.body) throw new Error('No response from the server.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
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
    } catch {
      updatePathwayDoc((prev) => ({
        ...prev,
        loading: false,
        error: 'Could not draft this pathway page. Try again.',
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
  function appendPathwayDocMessage(markdown: string, opts: { includeGaps: boolean }) {
    const gaps = opts.includeGaps ? extractGapsFromPathwayDraft(markdown) : [];
    const gapsLine = gaps.length ? `\n\nA few things I couldn't find in the documents:\n${gaps.map((g) => `- ${g}`).join('\n')}` : '';
    const intro = opts.includeGaps ? `Here is the pathway document drafted from your documents.${gapsLine}` : "Here's the updated pathway document.";
    // Asking for assets happens here, under the draft, rather than in the
    // companion's prose, because its step rules leave no turn for it; the
    // companion sees these lines in history and doesn't repeat them (see
    // contributorSystemPrompt's "Toolkit asset files"). Two asks:
    // - artifacts the material named but didn't attach (toolkitAssetMentions),
    //   by name, each once — under the first draft or any later revision,
    //   since a new document can name new ones;
    // - first draft only, when nothing has reached a consent card yet, the
    //   general "any asset to attach?" — folded into the first ask if both
    //   apply, so it's one question.
    // Neither after the contributor has declined attaching assets.
    const msgs = conversationRef.current?.messages ?? [];
    const declined = msgs.some((m) => m.toolkitAssetAskDeclined);
    const mentions = pendingAssetMentions(msgs).slice(0, MAX_ASSET_MENTIONS_PER_ASK);
    const askGeneral = opts.includeGaps && !declined && !msgs.some((m) => m.toolkitAssetConsent);
    const assetAsk = mentions.length
      ? `\n\n${buildAssetMentionAsk(mentions, askGeneral)}`
      : askGeneral
        ? `\n\nIs there any asset you want to attach with this pathway? You can attach the file or paste an https link here.`
        : '';
    const content = `${intro}\n\n${PATHWAY_DOC_MARKER}\n\nDo you want to make any changes or want to publish it?${assetAsk}`;
    const message: Message = {
      role: 'assistant',
      content,
      ...(mentions.length ? { toolkitAssetMentionsAsked: mentions.map((m) => assetMentionKey(m.name)) } : {}),
    };

    update((c) => ({ ...c, messages: [...c.messages, message] }));
    if (conversationRef.current) void persist(conversationRef.current);
  }

  function appendPublishOutcomeMessage(result: { ok: boolean; slug?: string; error?: string }) {
    const content = result.ok ? `Published — it's live now.\n\n${PATHWAY_DOC_MARKER}` : `I couldn't publish it — ${result.error || 'something went wrong. Try again.'}`;
    update((c) => ({ ...c, messages: [...c.messages, { role: 'assistant', content }] }));
    if (conversationRef.current) void persist(conversationRef.current);
  }

  // Applies the same message-list change to React state and to the persisted
  // row. Builds the persisted copy from conversationRef directly rather than
  // trusting the (batched) state update to have landed first.
  function commitMessages(mutate: (messages: Message[]) => Message[]) {
    const cur = conversationRef.current;
    if (!cur) return;
    update((c) => ({ ...c, messages: mutate(c.messages) }));
    void persist({ ...cur, messages: mutate(cur.messages) });
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

  // Contributor-only: one consent card per new toolkit-asset candidate the
  // companion flagged this turn (see contributorSystemPrompt). Nothing is
  // uploaded here — only after the contributor answers Yes on the card. A
  // file candidate must name a file actually uploaded in this conversation,
  // and a source already asked about is never asked again.
  function appendToolkitAssetConsentMessages(candidates: ToolkitAssetCandidate[]) {
    const cur = conversationRef.current;
    if (!cur) return;
    const seen = new Set(
      cur.messages.flatMap((m) => (m.toolkitAssetConsent ? [candidateSourceKey(m.toolkitAssetConsent.candidate)] : []))
    );
    const uploaded = new Set(extractUploadedFileNames(cur.messages));
    // A link must appear verbatim in something the contributor typed — the
    // model has been seen to "correct" a pasted link into a URL nobody gave,
    // which would then be published as theirs.
    const userText = cur.messages
      .filter((m) => m.role === 'user')
      .map((m) => m.displayContent ?? m.content)
      .join('\n');
    const fresh = candidates.filter((candidate) => {
      const key = candidateSourceKey(candidate);
      if (seen.has(key)) return false;
      seen.add(key);
      return 'fileName' in candidate.source
        ? uploaded.has(candidate.source.fileName)
        : userText.includes(candidate.source.url);
    });
    if (fresh.length === 0) return;

    const messages: Message[] = fresh.map((candidate) => {
      const consent: ToolkitAssetConsentState = {
        id: `consent-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        candidate,
        status: 'pending',
      };
      return {
        role: 'assistant',
        content: toolkitAssetConsentContent(consent),
        displayContent: TOOLKIT_ASSET_CONSENT_MARKER,
        toolkitAssetConsent: consent,
      };
    });
    commitMessages((msgs) => [...msgs, ...messages]);
  }

  function hasToolkitAssetFile(fileName: string): boolean {
    return assetFilesRef.current.has(fileName);
  }

  // The contributor's answer on a consent card. No → nothing is stored. Yes →
  // signed upload straight to the private bucket (files only), then register
  // the unpublished contribution_units row. The card shows the error and stays
  // answerable if anything fails.
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
    const { candidate } = consent;
    const fileName = 'fileName' in candidate.source ? candidate.source.fileName : null;

    if (!share) {
      if (fileName) assetFilesRef.current.delete(fileName);
      setStatus('declined');
      return { ok: true };
    }

    const pathwayId = cur.meta.pathwayId;
    if (!pathwayId) return { ok: false, error: "This workspace isn't linked to a pathway." };

    consentInFlightRef.current.add(consentId);
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
      setStatus('shared', data.id);
      setToolkitAssetsVersion((v) => v + 1);
      return { ok: true };
    } catch (err) {
      console.error('[toolkit-assets] consent submit failed:', err);
      return { ok: false, error: 'Something went wrong. Try again.' };
    } finally {
      consentInFlightRef.current.delete(consentId);
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
      if (!res.body) throw new Error('No response from the server.');

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
    } catch {
      updateExplorerDoc((prev) => ({
        ...prev,
        generating: null,
        error: 'Could not generate that document. Try again.',
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

  // Reacts to the Contributor companion's pathwayAction — see
  // contributorSystemPrompt's JSON contract in lib/system-prompts.ts. Runs
  // after the companion's own reply has finished streaming, from inside
  // sendMessage below, so the "Thinking…" indicator naturally covers the
  // extra draft-generation round trip too.
  async function handlePathwayAction(action: NonNullable<ParsedGridUpdate['pathwayAction']>) {
    if (action.type === 'generate') {
      const markdown = await generatePathwayDraft();
      if (markdown) appendPathwayDocMessage(markdown, { includeGaps: true });
    } else if (action.type === 'revise') {
      const markdown = await generatePathwayDraft(action.instruction || 'Apply the requested change.');
      if (markdown) appendPathwayDocMessage(markdown, { includeGaps: false });
    } else if (action.type === 'publish') {
      const result = await publishPathwayDocument();
      appendPublishOutcomeMessage(result);
    }
  }

  const sendMessage = useCallback(
    async (id: string, history: Message[], userMessage: Message, flow: AdoptionFlow, grid: GridState, meta: AdoptionMeta) => {
      const next: Message[] = [...history, userMessage];
      update((c) => ({ ...c, messages: next }));
      setLoading(true);

      const res = await fetch('/api/chat', {
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

      if (!res.body) { setLoading(false); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      let lastParsed: ParsedGridUpdate | null = null;

      update((c) => ({ ...c, messages: [...c.messages, { role: 'assistant', content: '' }] }));

      while (true) {
        const { done, value } = await reader.read();
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

        // Step 5 (Generate Output) wraps the full document in <deliverable>
        // tags — once that tag shows up, stop live-typing the message out.
        // Freeze the visible content at whatever came before the tag (the
        // short intro sentence) and show a loading state instead, so the
        // document itself appears as a finished whole once the stream
        // completes below, rather than streaming in piece by piece.
        const stripped = stripGridUpdate(assistantText);
        const deliverableIdx = stripped.indexOf(DELIVERABLE_START);
        update((c) => {
          const msgs = [...c.messages];
          msgs[msgs.length - 1] =
            deliverableIdx === -1
              ? { role: 'assistant', content: stripped }
              : { role: 'assistant', content: stripped.slice(0, deliverableIdx).trim(), generatingDoc: true };
          return { ...c, messages: msgs };
        });
      }

      // Final reveal — for a deliverable message this is the first time the
      // real content (including the finished document) replaces the loading
      // state; for a normal message it's a no-op past what's already shown.
      // pathwaysReferenced is stored on the message so source attribution
      // survives reload without re-parsing the stripped grid_update.
      const finalContent = stripGridUpdate(assistantText);
      const finalRefs = lastParsed?.pathwaysReferenced;
      // Explorer-only: toolkit assets offered this turn — kept on the message
      // (like pathwaysReferenced) so the download cards survive reload.
      const finalAssets = flow === 'explorer' ? lastParsed?.toolkitAssetsReferenced : undefined;
      // Contributor-only: artifacts the material named but didn't attach, and
      // a "nothing to attach" answer — kept on the message so the asks under
      // the pathway draft (appendPathwayDocMessage) survive reload.
      const finalMentions = flow === 'contributor' ? lastParsed?.toolkitAssetMentions : undefined;
      const finalDeclined = flow === 'contributor' && lastParsed?.toolkitAssetAskDeclined === true;
      const finalMsg = {
        role: 'assistant' as const,
        content: finalContent,
        ...(finalRefs?.length ? { pathwaysReferenced: finalRefs } : {}),
        ...(finalAssets?.length ? { toolkitAssetsReferenced: finalAssets } : {}),
        ...(finalMentions?.length ? { toolkitAssetMentions: finalMentions } : {}),
        ...(finalDeclined ? { toolkitAssetAskDeclined: true } : {}),
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
      }

      // Contributor-only: consent cards for any toolkit-asset candidates the
      // companion flagged this turn (nothing is uploaded until a Yes).
      if (flow === 'contributor' && lastParsed?.toolkitAssetCandidates?.length) {
        appendToolkitAssetConsentMessages(lastParsed.toolkitAssetCandidates);
      }

      // Contributor-only: react to the companion's pathwayAction, if any —
      // done before setLoading(false) so the "Thinking…" indicator covers
      // the extra draft-generation round trip this can trigger (see
      // handlePathwayAction above).
      if (flow === 'contributor' && lastParsed?.pathwayAction && lastParsed.pathwayAction.type !== 'none') {
        await handlePathwayAction(lastParsed.pathwayAction);
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
        }),
      });
      if (!res.body) return;

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
    answerToolkitAssetConsent,
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
