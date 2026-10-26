import { assetMentionKey, assetShareContent, resourceReviewContent } from '@/lib/toolkit-assets';
import type {
  AssetShareItem,
  AssetShareState,
  ResourceReviewItem,
  ResourceReviewState,
  ToolkitAssetCandidate,
} from '@/lib/toolkit-assets';
import { ASSET_SHARE_MARKER, RESOURCE_REVIEW_MARKER, TOOLKIT_ASSET_CONSENT_MARKER } from '@/lib/grid-update';
import type { DesignDocumentRow } from '@/lib/design-documents';
import type { Message } from '@/components/ChatPanel';

// Fixtures for useAdoptionConversation tests that start from a conversation
// already holding cards (asset card, resource review, legacy consent) — the
// shapes the hook itself writes, built with the same content helpers so the
// persisted copy reads exactly as the app would have stored it.

export const ASSET_1 = 'asset-11111111-2222-3333-4444-555555555555';
export const ASSET_2 = 'asset-22222222-3333-4444-5555-666666666666';
export const ASSET_3 = 'asset-33333333-4444-5555-6666-777777777777';

// A contributor draft whose Section 4 lists two reusable assets.
export const DRAFT = [
  '# Voice AI pathway',
  '',
  '## Section 4 — Toolkits and playbooks',
  '',
  '| # | Title | Type | Reuse condition |',
  '|---|---|---|---|',
  '| 1 | Farmer FAQ Bank | Toolkit Asset | New language rollout |',
  '| 2 | Call Script | Toolkit Asset | Before a pilot |',
  '',
  '## Section 5 — Problems',
  'Text.',
].join('\n');

export function draftRow(content: string, version = 1): DesignDocumentRow {
  return {
    id: `draft-${version}`,
    design_id: 'design-9',
    doc_type: 'draft',
    version_number: version,
    content_hash: '',
    content,
    created_at: '',
  };
}

export function rowItem(name: string, extra: Partial<AssetShareItem> = {}): AssetShareItem {
  return { key: `row:${assetMentionKey(name)}`, name, fromSection4: true, ...extra };
}

export function assetCardMsg(items: AssetShareItem[], extra: Partial<AssetShareState> = {}): Message {
  const card: AssetShareState = { id: 'card-1', items, status: 'open', noneInSection4: false, ...extra };
  return { role: 'assistant', content: assetShareContent(card), displayContent: ASSET_SHARE_MARKER, assetShare: card };
}

export function reviewMsg(items: ResourceReviewItem[], extra: Partial<ResourceReviewState> = {}): Message {
  const review: ResourceReviewState = { id: 'review-1', items, status: 'open', generateOnComplete: false, ...extra };
  return { role: 'assistant', content: resourceReviewContent(review), displayContent: RESOURCE_REVIEW_MARKER, resourceReview: review };
}

export function consentMsg(candidate: ToolkitAssetCandidate, id = 'consent-1'): Message {
  return {
    role: 'assistant',
    content: `Asked about **${candidate.name}**.\n\n${TOOLKIT_ASSET_CONSENT_MARKER}`,
    displayContent: TOOLKIT_ASSET_CONSENT_MARKER,
    toolkitAssetConsent: { id, candidate, status: 'pending' },
  };
}

export function uploadMsg(...names: string[]): Message {
  return { role: 'user', content: 'doc text', displayContent: names.map((n) => `📄 Uploaded **${n}**`).join('\n') };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

export function pdf(name: string, body = '%PDF-1.4 data'): File {
  return new File([body], name, { type: 'application/pdf' });
}
