// Toolkit asset files — the pure, browser-safe half: types, file-type rules,
// the asset block written into pathway documents, and the library-chat
// <toolkit_assets> tag. Storage and database access (service-role only) live
// in lib/toolkit-assets-server.ts so importing this from a client component
// never pulls the admin client into the browser bundle — the same split
// lib/grid-update.ts makes for the route handler.
//
// An asset is one contribution_units row (unit_type='toolkit-asset',
// unit_internal_id='asset-<uuid>'); see
// supabase/migrations/0034_contribution_units_toolkit_assets.sql.

export const TOOLKIT_ASSET_BUCKET = 'toolkit-assets';

// Mirrors the bucket's own file_size_limit (0034) — the bucket is the real
// enforcement; this only lets the UI and routes refuse early with a clear
// message instead of a storage error.
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;

// Extension → the one MIME type the upload is declared with. The server picks
// the type from the extension rather than trusting the browser's File.type
// (which varies by OS for .csv/.md), and the bucket's allowed_mime_types list
// (0034) rejects anything else. No ZIP, deliberately.
export const ASSET_MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

export function assetExtension(fileName: string): string | null {
  const ext = fileName.split('.').pop()?.toLowerCase();
  return ext && ext !== fileName.toLowerCase() && ext in ASSET_MIME_BY_EXTENSION ? ext : null;
}

export function isAllowedAssetFile(fileName: string, size: number): boolean {
  return assetExtension(fileName) !== null && size > 0 && size <= MAX_ASSET_BYTES;
}

// The name shown on cards and used as the download's file name: the
// original, minus any path components and control characters (keeps
// non-ASCII letters, unlike the storage key below).
export function displayAssetFileName(fileName: string): string {
  const base = (fileName.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return base.slice(-200) || 'asset';
}

// The storage-key form of the name: Supabase Storage keys are ASCII-only, so
// anything outside a small safe set becomes "_". Never contains a path
// segment separator or "..".
export function sanitizeAssetFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\.\.+/g, '.')
    .replace(/[^\w.\- ()]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-120);
  return cleaned.replace(/^\.+/, '') || 'asset';
}

export const ASSET_ID_PATTERN = /^asset-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isAssetId(value: unknown): value is string {
  return typeof value === 'string' && ASSET_ID_PATTERN.test(value);
}

// What the contributor companion proposes in its <grid_update> — see
// contributorSystemPrompt. Only ever a proposal: nothing is stored until the
// contributor answers the consent card.
export interface ToolkitAssetCandidate {
  source: { fileName: string } | { url: string };
  name: string;
  purpose?: string;
  reuseCondition?: string;
  dimension?: string;
  stage?: string;
  // What may be personal or confidential data the companion noticed in the
  // file's readable contents — shown on the resource review card before the
  // contributor agrees. Not stored with the asset. Empty when none.
  sensitiveNote?: string;
}

// LEGACY: a one-candidate consent card, from before the resource review card
// replaced it. Old conversations still carry these (and can still answer a
// pending one), so they're rendered and counted as decided; nothing new
// creates them.
export interface ToolkitAssetConsentState {
  id: string;
  candidate: ToolkitAssetCandidate;
  status: 'pending' | 'shared' | 'declined';
  assetId?: string;
}

export function candidateSourceKey(candidate: ToolkitAssetCandidate): string {
  return 'fileName' in candidate.source ? `file:${candidate.source.fileName}` : `url:${candidate.source.url}`;
}

// A reusable artifact the contributor's material names but that wasn't
// attached or linked: a document that says "we built a vendor evaluation
// checklist", or "we ran it on <open-source tool>". The contributor
// companion reports these in toolkitAssetMentions, even when it judged the
// document itself to be background material. Nothing is stored from this;
// each becomes an item on the resource review card, asked about once.
export interface ToolkitAssetMention {
  name: string;
  // The uploaded file it was named in, or '' when it was the contributor's
  // own message.
  mentionedIn: string;
}

// How a mention is matched against items already reviewed, so the same
// artifact is never asked about twice.
export function assetMentionKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// The resource review card (contributor flow)
// ---------------------------------------------------------------------------
//
// One client-constructed chat message listing every potentially reusable
// resource not yet decided: files and links the companion judged reusable
// (toolkitAssetCandidates) plus things the material names but didn't attach
// (toolkitAssetMentions). The contributor decides each item — share (with
// the public-sharing + right-to-share consent), attach the missing file or
// link, or don't share — and then answers "any other resource?". The first
// review is started by the stage confirmation and generates the first draft
// when finished; later ones appear whenever new resources turn up. Lives on
// Message.resourceReview, persisted with the conversation. See
// lib/adoption-conversation.ts for the actions.

export type ResourceItemStatus = 'pending' | 'shared' | 'declined' | 'background';

export interface ResourceReviewItem {
  // candidateSourceKey for a file or link, `mention:<assetMentionKey>` for
  // something named but not attached.
  key: string;
  name: string;
  // Set once there's a real file or link the companion judged reusable.
  candidate?: ToolkitAssetCandidate;
  // A mention: the uploaded file it was named in ('' = their own message).
  mentionedIn?: string;
  // Attached or linked from this card, waiting for the companion's check.
  // Cleared when the check lists it; if it doesn't, the item becomes
  // 'background' (kept as source material only).
  attachedSource?: { fileName: string } | { url: string };
  status: ResourceItemStatus;
  assetId?: string;
}

export interface ResourceReviewState {
  id: string;
  items: ResourceReviewItem[];
  status: 'open' | 'complete';
  // Legacy (conversations from before 2026-10-09, when resources were
  // reviewed before the first draft): finishing it generates the first draft.
  // New reviews always set false.
  generateOnComplete: boolean;
  // The first review, shown once the questions after the first draft end:
  // finishing it asks the contributor whether to change the draft or send
  // it for review.
  followsFirstDraft?: boolean;
}

export function mentionItemKey(name: string): string {
  return `mention:${assetMentionKey(name)}`;
}

// What the companion reads back in history for a review card — the outcome
// of every item, so it never lists a decided file or link again.
export function resourceReviewContent(review: ResourceReviewState): string {
  const label: Record<ResourceItemStatus, string> = {
    pending: 'not decided yet',
    shared: 'the contributor agreed to share it publicly as a toolkit asset; it goes live when this pathway is approved',
    declined: 'the contributor chose not to share it',
    background: "it reads as background material rather than a reusable resource, so it's used for the pathway only",
  };
  const lines = review.items.map((item) => {
    const source = item.candidate
      ? 'fileName' in item.candidate.source
        ? `file ${item.candidate.source.fileName}`
        : `link ${item.candidate.source.url}`
      : item.key.startsWith('attached:')
        ? 'attached from the card'
        : item.mentionedIn
          ? `mentioned in ${item.mentionedIn}`
          : 'mentioned by the contributor';
    return `- **${oneLine(item.name)}** (${source}): ${label[item.status]}`;
  });
  const head =
    review.status === 'complete'
      ? 'Resource review (finished):'
      : 'Resource review shown to the contributor (they decide each item on the card):';
  return [head, ...(lines.length ? lines : ['- nothing identified; the contributor was asked whether they have any resource to share'])].join('\n');
}

// The "may this be published?" step before a pathway is sent for review.
export interface PublishConsentState {
  id: string;
  status: 'pending' | 'sent' | 'kept' | 'deleted';
}

// Public metadata for a published asset — what GET /api/toolkit-assets
// returns and ToolkitAssetCard renders. Never carries a storage path or URL.
export interface ToolkitAssetSummary {
  id: string;
  name: string;
  purpose: string;
  kind: 'file' | 'link';
  fileName: string | null;
  sizeBytes: number | null;
  linkDomain: string | null;
  pathwaySlug: string;
  pathwayTitle: string;
  // When the asset went live (its pathway's approval) — shown on the card so
  // an adopter can tell how old it is.
  publishedAt: string | null;
}

// "Sep 2026" — month precision is what an adopter needs to judge age. A
// fixed month list + UTC (not toLocaleDateString, whose short month varies by
// ICU version: "Sep" vs "Sept") keeps the server-rendered prompt and the
// client card in agreement.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatAssetMonth(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// One entry of the block written into a pathway document at assemble time.
export interface ToolkitAssetBlockEntry {
  id: string;
  name: string;
  kind: 'file' | 'link';
  fileName: string | null;
  linkDomain: string | null;
  purpose: string;
  reuseCondition: string;
}

export function linkDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The asset block inside a pathway document
// ---------------------------------------------------------------------------
//
// Regenerated by the app on every assemble (app/api/pathways/assemble) from
// contribution_units, never written by the model — pathwayDraftSystemPrompt
// tells it to leave this block out. Each entry carries an
// <!-- asset-id: … --> marker; admin publish (app/api/admin/pathways/publish)
// publishes exactly the asset ids present in the reviewed document, so an
// asset attached after the last assemble never rides along unreviewed.
// Deliberately no URL in here: downloads only happen through the app.

export const ASSET_BLOCK_START = '<!-- toolkit-assets:start -->';
export const ASSET_BLOCK_END = '<!-- toolkit-assets:end -->';
const ASSET_ID_MARKER = /<!--\s*asset-id:\s*(asset-[0-9a-f-]{36})\s*-->/g;

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function renderToolkitAssetBlock(assets: ToolkitAssetBlockEntry[]): string {
  if (assets.length === 0) return '';
  const lines = assets.map((a) => {
    const where = a.kind === 'file' ? `File: ${a.fileName ?? 'attached file'}` : `Link: ${a.linkDomain ?? 'external link'}`;
    const purpose = a.purpose ? ` — ${oneLine(a.purpose)}` : '';
    const reuse = a.reuseCondition ? ` Reuse when: ${oneLine(a.reuseCondition)}` : '';
    return `- **${oneLine(a.name)}** (${where})${purpose}${reuse} <!-- asset-id: ${a.id} -->`;
  });
  return [
    ASSET_BLOCK_START,
    '### Toolkit asset files',
    '',
    'Files and links the contributor has shared for reuse.',
    '',
    ...lines,
    ASSET_BLOCK_END,
  ].join('\n');
}

// Headings that mark the end of Section 4 — pathway documents number and
// word these inconsistently ("# 4. Toolkits and Playbooks" then
// "## 6. Retrieval guide"; drafts use "## Section 5"), so match on meaning,
// not heading level.
const AFTER_SECTION_4 = /^#{1,6}\s*(?:section\s*)?(?:[5-9]\b|problem|retrieval|source trace|provenance)/i;
const SECTION_4 = /^#{1,6}\s*(?:section\s*)?4\b/i;
const SOURCE_TRACE = /^#{1,6}\s*.*(?:source trace|provenance)/i;

function removeBlock(markdown: string): string {
  const start = markdown.indexOf(ASSET_BLOCK_START);
  if (start === -1) return markdown;
  const end = markdown.indexOf(ASSET_BLOCK_END, start);
  const cut = end === -1 ? markdown.length : end + ASSET_BLOCK_END.length;
  return (markdown.slice(0, start).replace(/\n+$/, '\n') + markdown.slice(cut).replace(/^\n+/, '\n')).replace(/\n{3,}/g, '\n\n');
}

// Line index to insert before: back up over a "---" rule and blank lines
// sitting just above the heading, so the block stays inside the section it
// belongs to rather than landing after its separator.
function insertionIndexBefore(lines: string[], headingIndex: number): number {
  let i = headingIndex;
  while (i > 0 && (lines[i - 1].trim() === '' || lines[i - 1].trim() === '---')) i--;
  return i;
}

export function applyToolkitAssetBlock(markdown: string, assets: ToolkitAssetBlockEntry[]): string {
  const base = removeBlock(markdown);
  const block = renderToolkitAssetBlock(assets);
  if (!block) return base;

  const lines = base.split('\n');
  const s4 = lines.findIndex((l) => SECTION_4.test(l.trim()));
  let at = -1;
  if (s4 !== -1) {
    const next = lines.findIndex((l, i) => i > s4 && AFTER_SECTION_4.test(l.trim()));
    at = next === -1 ? lines.length : insertionIndexBefore(lines, next);
  } else {
    const trace = lines.findIndex((l) => SOURCE_TRACE.test(l.trim()));
    if (trace !== -1) at = insertionIndexBefore(lines, trace);
  }
  if (at === -1) return `${base.replace(/\n+$/, '')}\n\n${block}\n`;

  const before = lines.slice(0, at).join('\n').replace(/\n+$/, '');
  const after = lines.slice(at).join('\n').replace(/^\n+/, '');
  return `${before}\n\n${block}\n\n${after}`;
}

export function assetIdsInDocument(markdown: string): string[] {
  const start = markdown.indexOf(ASSET_BLOCK_START);
  if (start === -1) return [];
  const end = markdown.indexOf(ASSET_BLOCK_END, start);
  const block = markdown.slice(start, end === -1 ? undefined : end);
  return [...new Set([...block.matchAll(ASSET_ID_MARKER)].map((m) => m[1]).filter(isAssetId))];
}

// ---------------------------------------------------------------------------
// The library chat's <toolkit_assets> tag
// ---------------------------------------------------------------------------
//
// /explore's library chat has no <grid_update> contract, so when the model
// tells a visitor which assets belong to the pathway it ends that reply with
// <toolkit_assets>["asset-…"]</toolkit_assets> (see libraryPathwaySystemPrompt).
// ExploreLibrary strips it from the visible text and renders validated ids as
// download cards — the model never writes a URL.

export const TOOLKIT_ASSETS_TAG_START = '<toolkit_assets>';
export const TOOLKIT_ASSETS_TAG_END = '</toolkit_assets>';

export function parseToolkitAssetsTag(text: string): string[] {
  const match = text.match(/<toolkit_assets>([\s\S]*?)<\/toolkit_assets>/);
  if (!match) return [];
  try {
    const parsed: unknown = JSON.parse(match[1]);
    return Array.isArray(parsed) ? [...new Set(parsed.filter(isAssetId))] : [];
  } catch {
    return [];
  }
}

// Cuts at the opening tag rather than matching a closed one, so a tag that
// has only partially streamed in never flashes in the UI — same approach as
// stripGridUpdate, plus a trailing half-arrived "<toolk…" is held back too.
export function stripToolkitAssetsTag(text: string): string {
  const idx = text.indexOf('<toolkit_assets');
  if (idx !== -1) return text.slice(0, idx).trimEnd();
  const lt = text.lastIndexOf('<');
  if (lt !== -1 && TOOLKIT_ASSETS_TAG_START.startsWith(text.slice(lt))) return text.slice(0, lt).trimEnd();
  return text;
}

// ---------------------------------------------------------------------------
// Prompt text shared by /analyse (explorerSystemPrompt) and /explore
// (libraryPathwaySystemPrompt) — one source, so both chats offer assets the
// same way, at the same moments.
// ---------------------------------------------------------------------------

export interface ToolkitAssetPromptEntry {
  id: string;
  pathwaySlug: string;
  pathwayTitle: string;
  name: string;
  purpose: string;
  reuseCondition: string;
  kind: 'file' | 'link';
  publishedAt?: string | null;
}

export function renderToolkitAssetsForPrompt(assets: ToolkitAssetPromptEntry[]): string {
  return assets
    .map((a) => {
      const purpose = a.purpose ? ` — ${oneLine(a.purpose)}` : '';
      const reuse = a.reuseCondition ? ` Reuse when: ${oneLine(a.reuseCondition)}` : '';
      const shared = formatAssetMonth(a.publishedAt);
      return `- id: ${a.id} · pathway: ${a.pathwayTitle || a.pathwaySlug} (${a.pathwaySlug}) · ${a.kind === 'file' ? 'file' : 'link'}${shared ? ` · shared ${shared}` : ''} · ${oneLine(a.name)}${purpose}${reuse}`;
    })
    .join('\n');
}

// `whereRelevant` narrows which pathway's assets qualify: in /analyse a
// pathway that matches the user's situation;
// in /explore the one pathway the conversation is about. `howToAttach` names
// the contract field that carries the ids (the model never writes a link
// itself). The match rules and the explicit-ask rules are the behaviour in
// docs/tasks/toolkit-asset-files/requirement.md.
export function toolkitAssetTimingRules(whereRelevant: string, howToAttach: string): string {
  return `Toolkit asset files are real files and links that a pathway's contributors have shared publicly for reuse — templates, checklists, cost models, test sets, glossaries, tools. Offer them only inside the conversation, and only at the right moment:
- Not in your first reply of the conversation — unless the user's own message explicitly asks for tools, templates, resources, files, or downloads.
- From the user's second message onward, once the conversation is genuinely about ${whereRelevant} that has assets listed below, bring up the ones that bear on what they're doing, once, as assets associated with that pathway.
- Straight away, at any point, if the user asks about tools, templates, resources, files, downloads, or how to implement or reuse something.
- Don't offer the same asset again later in the conversation unless the user asks for it again.
- Never invent an asset, and never write a URL, link, or file path for one — ${howToAttach}; the product then shows a download card under your reply.

How well each asset fits — judge every asset on its own, never a pathway's assets as a bundle:
- **Match** — when an asset matches what the user is working on or asking about (its sector, problem, or "Reuse when"), surface it directly: show that this is a relevant tool from this pathway that can help them with this, stating what it is and when it helps based on its "Reuse when". Framed as something they could reuse from another deployment, never as a recommendation or "you should".
- **No match** — don't mention it. Stretching an asset to fit is worse than leaving it out.
- If the user explicitly asked for tools, templates, or files and no asset below fits, say so plainly in one line (e.g. "No shared toolkit files match this yet") instead of saying nothing. You may then point to a toolkit a pathway document only describes in its text, saying plainly that it's described there and there's no file to download.
- When assets come from more than one pathway, say which pathway each comes from. When two assets serve the same need from different pathways, offer both, each with its own "Reuse when" — don't pick one.
- You only know each asset's name, purpose, "Reuse when", and when it was shared — never its contents. Don't describe what's inside a file beyond its stated purpose; the user can download it.
- If an asset was shared more than 12 months ago, mention when, in one clause, where its purpose depends on things that change (prices, models, vendors, policy).`;
}

// The prompt block for when there are no shared asset files to offer (no
// published assets anywhere for /analyse, or none on the open pathway for
// /explore — every curated pathway). The explicit-ask answer still has to
// reach the model, or a user asking for templates gets silence or a guess.
export function noToolkitAssetsRule(whereRelevant: string): string {
  return `No toolkit asset files (downloadable templates, checklists, tools or links shared by contributors) exist for ${whereRelevant} yet. Don't bring the subject up yourself. If the user explicitly asks for tools, templates, resources, files, or downloads, say so plainly in one line (e.g. "No shared toolkit files match this yet"). You may then point to a toolkit a pathway document only describes in its text, saying plainly that it's described there and there's no file to download. Never invent a file, a link, or a download.`;
}
