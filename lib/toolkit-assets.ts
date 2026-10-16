// Toolkit asset files — the pure, browser-safe half: types, file-type rules,
// the shared-asset links written into pathway documents' Section 4, and the library-chat
// <toolkit_assets> tag. Storage and database access (service-role only) live
// in lib/toolkit-assets-server.ts so importing this from a client component
// never pulls the admin client into the browser bundle — the same split
// lib/grid-update.ts makes for the route handler.
//
// An asset is one contribution_units row (unit_type='toolkit-asset',
// unit_internal_id='asset-<uuid>'); see
// supabase/migrations/0034_contribution_units_toolkit_assets.sql.

import { linkSection4Assets, section4AssetIds, type Section4Link } from '@/lib/pathway-section4';

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

// Types a browser shows by itself: what a Section 4 title opens as a preview
// in a new tab (?preview=1 on the download route). Text files are always
// served as plain text there, never rendered as a page. Office files have no
// preview, so their title just downloads.
const PREVIEW_TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  csv: 'text/plain; charset=utf-8',
};

export function assetPreviewType(fileName: string): string | null {
  const ext = assetExtension(fileName);
  return ext ? (PREVIEW_TYPE_BY_EXTENSION[ext] ?? null) : null;
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

// ---------------------------------------------------------------------------
// The asset card (contributor flow, since 2026-10-12)
// ---------------------------------------------------------------------------
//
// Shown under the pathway draft. Its items are the draft's Section 4 rows
// (section4Rows in lib/pathway-section4.ts); when Section 4 lists none, it
// asks whether the contributor has any to share and they add their own.
// For each one they upload a file or add a link — no model call in between:
// a file is attached to its row by the app. Nothing is stored until
// Confirm: then every chosen file or link is registered (consent is the
// note on the card), and the app links each title in Section 4. Lives on
// Message.assetShare, persisted with the conversation. Replaces the resource
// review card (ResourceReviewState) for new conversations.

export type AssetSource = { fileName: string } | { url: string };

export interface AssetShareItem {
  // `row:<assetMentionKey>` for a Section 4 row, `new:<file or url>` for one
  // the contributor added.
  key: string;
  name: string;
  fromSection4: boolean;
  reuseCondition?: string;
  // An asset the contributor added (not from Section 4): their answer to
  // "What is it used for?", asked on the card. On Confirm it is turned into
  // `purpose` and `reuseCondition` (mode `asset-reuse`), which fill the
  // asset's own Section 4 row.
  howItHelped?: string;
  purpose?: string;
  // A file uploaded earlier in this conversation that looks like this asset
  // — offered as "Use the file you already uploaded".
  suggestedFile?: string;
  // Chosen on the card, registered on Confirm.
  staged?: AssetSource;
  // Registered on an earlier Confirm.
  shared?: { assetId: string; source: AssetSource };
  // Deleted in the Reusable assets popup: hidden everywhere, kept so no later
  // card asks about it again and no later draft brings its Section 4 row back.
  deleted?: boolean;
  error?: string;
}

export interface AssetShareState {
  id: string;
  items: AssetShareItem[];
  status: 'open' | 'confirmed';
  // Section 4 listed no assets when the card was made: it asks whether the
  // contributor has any.
  noneInSection4: boolean;
}

export function sourceLabel(source: AssetSource): string {
  return 'fileName' in source ? displayAssetFileName(source.fileName) : (linkDomain(source.url) ?? source.url);
}

// What the companion reads back in history for an asset card.
export function assetShareContent(card: AssetShareState): string {
  const lines = card.items.map((item) => {
    if (item.deleted) {
      return `- **${oneLine(item.name)}**: deleted by the contributor and removed from Section 4. Do not add it back.`;
    }
    const state = item.shared
      ? `shared (${sourceLabel(item.shared.source)}); linked in Section 4, goes live when this pathway is approved`
      : item.staged
        ? `chosen (${sourceLabel(item.staged)}), not confirmed yet`
        : 'nothing shared';
    const help = item.howItHelped ? ` What it is used for: ${oneLine(item.howItHelped)}` : '';
    return `- **${oneLine(item.name)}**: ${state}.${help}`;
  });
  const head = card.noneInSection4
    ? 'Asked the contributor whether they have any reusable assets to share (Section 4 listed none).'
    : 'Asked the contributor to upload a file or add a link for each reusable asset in Section 4.';
  const tail = card.status === 'confirmed' ? 'They confirmed they have shared everything they want to.' : 'Not confirmed yet.';
  return [head, ...lines, tail].join('\n');
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
  linkUrl: string | null;
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
// Shared files inside a pathway document
// ---------------------------------------------------------------------------
//
// Shared assets are links on their Section 4 row titles, which the app —
// never the model — writes when the contributor confirms the asset card and
// again on every assemble (app/api/pathways/assemble) from
// contribution_units (pathwayDraftSystemPrompt tells the model to write no
// links or markers there; linkSection4Assets strips whatever it wrote). Each
// linked title carries an <!-- asset-id: … --> marker; admin publish
// (app/api/admin/pathways/publish) publishes exactly the asset ids present
// in the reviewed document, so an asset added after the last assemble never
// rides along unreviewed. A file links to the app's download route, never to
// storage; a link asset to the contributor's own https URL.
//
// Documents assembled before 2026-10-12 carry a separate "Toolkit asset
// files" block between these markers instead; it is still read, and removed
// the next time the document is assembled.

export const ASSET_BLOCK_START = '<!-- toolkit-assets:start -->';
export const ASSET_BLOCK_END = '<!-- toolkit-assets:end -->';
const ASSET_ID_MARKER = /<!--\s*asset-id:\s*(asset-[0-9a-f-]{36})\s*-->/g;

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function removeLegacyBlock(markdown: string): string {
  const start = markdown.indexOf(ASSET_BLOCK_START);
  if (start === -1) return markdown;
  const end = markdown.indexOf(ASSET_BLOCK_END, start);
  const cut = end === -1 ? markdown.length : end + ASSET_BLOCK_END.length;
  return (markdown.slice(0, start).replace(/\n+$/, '\n') + markdown.slice(cut).replace(/^\n+/, '\n')).replace(/\n{3,}/g, '\n\n');
}

// Where a shared asset's Section 4 title links to.
export function assetHref(asset: { id: string; kind: 'file' | 'link'; linkUrl?: string | null }): string {
  return asset.kind === 'link' && asset.linkUrl ? asset.linkUrl : `/api/toolkit-assets/${asset.id}/download`;
}

// Where a shared asset's Section 4 title links to: a preview for a file the
// browser can show, else the same place as its File cell.
export function assetTitleHref(asset: { id: string; kind: 'file' | 'link'; linkUrl?: string | null; fileName?: string | null }): string {
  const href = assetHref(asset);
  return asset.kind === 'file' && asset.fileName && assetPreviewType(asset.fileName) ? `${href}?preview=1` : href;
}

// Links each shared asset from its Section 4 row; an asset no row names
// gets a row of its own.
export function applyToolkitAssetFiles(markdown: string, assets: ToolkitAssetBlockEntry[]): string {
  const links: Section4Link[] = assets.map((a) => ({
    name: oneLine(a.name),
    href: assetHref(a),
    titleHref: assetTitleHref(a),
    assetId: a.id,
    reuseCondition: oneLine(a.reuseCondition),
    label: a.kind === 'file' ? displayAssetFileName(a.fileName ?? '') || a.name : (a.linkDomain ?? linkDomain(a.linkUrl ?? '') ?? ''),
  }));
  return linkSection4Assets(removeLegacyBlock(markdown), links);
}

export function assetIdsInDocument(markdown: string): string[] {
  const ids: string[] = [];
  const start = markdown.indexOf(ASSET_BLOCK_START);
  if (start !== -1) {
    const end = markdown.indexOf(ASSET_BLOCK_END, start);
    const block = markdown.slice(start, end === -1 ? undefined : end);
    ids.push(...[...block.matchAll(ASSET_ID_MARKER)].map((m) => m[1]));
  }
  ids.push(...section4AssetIds(markdown));
  return [...new Set(ids.filter(isAssetId))];
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
// docs/features/toolkit-asset-files/requirement_toolkit_asset_files.md.
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
