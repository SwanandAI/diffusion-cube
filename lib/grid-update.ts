import type { CellState } from '@/lib/dimensions';
import type { ExplorerIntent } from '@/lib/explorer-intents';
import { isAssetId, type ToolkitAssetCandidate } from '@/lib/toolkit-assets';

// Step 5 (Generate Output) wraps the Deep Dive Report / Holistic Adoption
// Plan's full markdown in this tag pair — shared between ChatPanel (renders
// a Download PDF card in place of it) and adoption-conversation.ts (which
// stops live-streaming the message body the moment this tag appears, so the
// document reveals as a finished whole rather than typing itself out).
export const DELIVERABLE_START = '<deliverable>';
export const DELIVERABLE_END = '</deliverable>';

// Marks where a client-constructed (not model-authored) Contributor-flow
// chat message should render a card that reopens the current pathway
// document — see lib/adoption-conversation.ts's pathwayAction handling and
// components/ChatPanel.tsx's rendering of it. Unlike DELIVERABLE_START/END,
// this wraps no content — the card fetches the document from
// pathway_submission_versions when opened, so nothing needs storing twice.
export const PATHWAY_DOC_MARKER = '<pathway_doc/>';

// The Explorer equivalents: markers in a client-constructed chat message that
// render a card reopening the stored Analysis Document / Executive Summary
// (see lib/adoption-conversation.ts's explorerAction handling). Like
// PATHWAY_DOC_MARKER these wrap no content — the document is read back from
// `design_documents`, never stored twice.
export const ANALYSIS_DOC_MARKER = '<analysis_doc/>';
export const EXEC_SUMMARY_MARKER = '<exec_summary/>';

// Contributor flow: marks a client-constructed message that renders the
// toolkit-asset public-sharing consent card. Like the markers above it wraps
// no content — the card's data travels on the message itself
// (Message.toolkitAssetConsent), see lib/adoption-conversation.ts.
export const TOOLKIT_ASSET_CONSENT_MARKER = '<toolkit_asset_consent/>';

// Split out from lib/adoption-conversation.ts so it can be imported from
// server code (app/api/chat/route.ts) without pulling in that file's React
// hooks — Next.js refuses to bundle a route handler that transitively
// imports useState/useEffect.
export interface ParsedGridUpdate {
  cells: Record<string, CellState>;
  meta?: {
    name?: string;
    sector?: string;
    geography?: string;
    stage?: string;
    summary?: string;
    // Explorer-only: which of the four intents this conversation is running
    // (see lib/explorer-intents.ts). Chosen from the menu on /strengthen, and
    // only ever changed by the model after the user has confirmed a switch.
    intent?: ExplorerIntent;
    // The model's own working reasoning state — carried forward every turn
    // the same way flowStep is, since none of this survives in replayed
    // message history either (see AdoptionMeta in adoption-conversation.ts).
    hypothesis?: string;
    biggestRisk?: string;
    confidence?: string;
    decision?: string;
    conversationMode?: string;
    // Explorer-only: the Cube's own working stage/coverage read, carried
    // forward the same way — see CubeAssessment in system-prompts.ts.
    cubeAssessment?: {
      currentStage?: string;
      coveredDimensions?: string[];
      partialDimensions?: string[];
      missingDimensions?: string[];
      assessmentConfirmed?: boolean;
    };
    // Explorer-only: the model's own working read of who the user is —
    // see CompanionMeta.persona in lib/system-prompts.ts.
    persona?: string;
  };
  // Pathway slugs the companion actually drew on this turn (see
  // companionSystemPrompt's grid_update contract) — used server-side to tag
  // the adoption_queries log, not rendered anywhere in the UI.
  pathwaysReferenced?: string[];
  // Which numbered step of the explorer/contributor flow the model reports
  // being on (see gridUpdateContract in lib/system-prompts.ts). Persisted
  // into AdoptionMeta.flowStep and re-injected into the prompt every turn —
  // the grid_update block itself is stripped before a message is stored, so
  // the model can't "read back" its own past JSON from history; the app has
  // to carry this state forward explicitly instead.
  flowStep?: number;
  // Contributor-only: what the model wants the client to do about the
  // pathway document this turn — see contributorSystemPrompt's JSON
  // contract. "generate"/"revise" trigger an automatic pathway-draft mode
  // call; "publish" triggers the push route directly from chat; "none" is
  // every other turn (still waiting on documents, a paused insufficient-info
  // state, or a genuine tangent).
  pathwayAction?: {
    type: 'none' | 'generate' | 'revise' | 'publish';
    instruction?: string;
  };
  // Explorer-only: what the model wants the client to generate this turn —
  // the Guidance intent's Analysis Document, or the separate Executive
  // Summary. Both are produced by their own /api/chat modes and stored in
  // `design_documents`, the same way pathwayAction drives `pathway-draft`.
  explorerAction?: {
    type: 'none' | 'analysis' | 'executive-summary';
  };
  // Contributor-only: uploaded files / pasted https links from this turn the
  // model judged to be genuine Toolkit Assets (see contributorSystemPrompt's
  // "Toolkit asset files" section). Only a proposal — the client asks the
  // contributor for public-sharing consent before anything is stored.
  toolkitAssetCandidates?: ToolkitAssetCandidate[];
  // Explorer-only: ids of published toolkit assets the companion offered this
  // turn — the client validates them against GET /api/toolkit-assets and
  // renders download cards (see explorerSystemPrompt).
  toolkitAssetsReferenced?: string[];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// Drops anything malformed rather than failing the whole block: an entry
// needs a name and either an uploaded file name or an https URL. Lenient
// about shape — the model sometimes writes `source` as a bare string, or the
// url/fileName at the entry's top level, or leaves a trailing quote or
// punctuation on a URL — since silently dropping a real candidate means the
// contributor never sees its consent card.
function parseToolkitAssetCandidates(value: unknown): ToolkitAssetCandidate[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: ToolkitAssetCandidate[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    let fileName = '';
    let url = '';
    if (typeof entry.source === 'string') {
      if (/^https?:\/\//i.test(entry.source.trim())) url = entry.source.trim();
      else fileName = entry.source.trim();
    } else if (entry.source && typeof entry.source === 'object') {
      const source = entry.source as Record<string, unknown>;
      fileName = str(source.fileName ?? source.filename ?? source.file);
      url = str(source.url ?? source.link ?? source.href);
    }
    fileName = fileName || str(entry.fileName ?? entry.filename);
    url = (url || str(entry.url ?? entry.link)).replace(/["'`.,;)\]]+$/, '');
    const name = str(entry.name);
    if (!name || (!fileName && !/^https:\/\/\S+$/.test(url))) continue;
    out.push({
      source: fileName ? { fileName } : { url },
      name,
      purpose: str(entry.purpose),
      reuseCondition: str(entry.reuseCondition),
      dimension: str(entry.dimension).toLowerCase(),
      stage: str(entry.stage).toLowerCase(),
    });
  }
  return out;
}

export function parseGridUpdate(text: string): ParsedGridUpdate | null {
  const match = text.match(/<grid_update>([\s\S]*?)<\/grid_update>/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return {
      cells: parsed.cells ?? {},
      meta: parsed.meta,
      pathwaysReferenced: parsed.pathwaysReferenced,
      flowStep: typeof parsed.flowStep === 'number' ? parsed.flowStep : undefined,
      pathwayAction: parsed.pathwayAction,
      explorerAction: parsed.explorerAction,
      toolkitAssetCandidates: parseToolkitAssetCandidates(parsed.toolkitAssetCandidates),
      toolkitAssetsReferenced: Array.isArray(parsed.toolkitAssetsReferenced)
        ? [...new Set<string>(parsed.toolkitAssetsReferenced.filter(isAssetId))]
        : undefined,
    };
  } catch {
    return null;
  }
}

// Cuts at the opening tag rather than matching a closed block, so a
// <grid_update> that has only partially streamed in never renders.
export function stripGridUpdate(text: string): string {
  const idx = text.indexOf('<grid_update');
  return (idx === -1 ? text : text.slice(0, idx)).trim();
}
