// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { jsonResponse, stubFetch } from '../../helpers/ui-fork-http';

import AdminPathwayRowCard from '@/components/AdminPathwayRowCard';
import type { AdminPathwayRow, AdminToolkitAsset } from '@/components/AdminPathwaysPanel';
import { ASSET_BLOCK_END, ASSET_BLOCK_START } from '@/lib/toolkit-assets';

const ASSET_A = 'asset-11111111-1111-4111-8111-111111111111';
const ASSET_B = 'asset-22222222-2222-4222-8222-222222222222';
const ASSET_C = 'asset-33333333-3333-4333-8333-333333333333';

function asset(id: string, over: Partial<AdminToolkitAsset> = {}): AdminToolkitAsset {
  return {
    id,
    name: `Asset ${id.slice(6, 7)}`,
    purpose: 'Reusable checklist',
    kind: 'file',
    fileName: 'checklist.pdf',
    sizeBytes: 2 * 1024 * 1024,
    linkDomain: null,
    published: false,
    ...over,
  };
}

const ROW: AdminPathwayRow = {
  id: 'pw-1',
  slug: 'voice-ai',
  title: 'Voice AI for Extension',
  sector: 'Agriculture',
  created_at: '2026-09-15T08:00:00Z',
  reviewRequested: true,
  isPublished: false,
  toolkitAssets: [],
};

// The document comes from the admin route (not the browser Supabase client —
// the pathways RLS can't see ADMIN_EMAILS-only admins).
let docCalls: ReturnType<typeof stubFetch>['calls'];
function withDoc(content: string | null) {
  docCalls = stubFetch(() => jsonResponse({ content: content ?? '' })).calls;
}

function renderCard(row: Partial<AdminPathwayRow> = {}, isPending = false) {
  const onPublish = vi.fn();
  const onRemove = vi.fn();
  render(<AdminPathwayRowCard row={{ ...ROW, ...row }} isPending={isPending} onPublish={onPublish} onRemove={onRemove} />);
  return { onPublish, onRemove };
}

const toggle = () => screen.getByRole('button', { name: /Voice AI for Extension/ });

beforeEach(() => withDoc(null));

describe('AdminPathwayRowCard', () => {
  it('shows sector and date, with a fallback for no sector', () => {
    renderCard({ sector: '' });
    expect(screen.getByText(/^No sector · /)).toBeInTheDocument();
  });

  it('awaiting review: Publish + Delete call their handlers', async () => {
    const user = userEvent.setup();
    const { onPublish, onRemove } = renderCard();
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('a published row (not awaiting) shows the Published badge and no Publish', () => {
    renderCard({ reviewRequested: false, isPublished: true });
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
  });

  it('awaiting review takes precedence over published (re-review of a live pathway)', () => {
    renderCard({ reviewRequested: true, isPublished: true });
    expect(screen.getByText('Awaiting Review')).toBeInTheDocument();
    expect(screen.queryByText('Published')).not.toBeInTheDocument();
  });

  it('a row neither awaiting nor published shows the Draft badge', () => {
    renderCard({ reviewRequested: false, isPublished: false });
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.queryByText('Published')).not.toBeInTheDocument();
    expect(screen.queryByText('Awaiting Review')).not.toBeInTheDocument();
  });

  it('pending: awaiting row labels Publish "Publishing…" and Delete stays "Delete"', () => {
    renderCard({}, true);
    expect(screen.getByRole('button', { name: 'Publishing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('pending: draft row labels Delete "Deleting…"', () => {
    renderCard({ reviewRequested: false }, true);
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
  });

  it('expanding loads content_cache once and collapsing hides it', async () => {
    withDoc('# Voice AI\n\nFarmers call a helpline.');
    const user = userEvent.setup();
    renderCard();
    await user.click(toggle());
    expect(await screen.findByText('Farmers call a helpline.')).toBeInTheDocument();
    expect(docCalls).toEqual([
      { url: '/api/admin/pathways/document?pathway_id=pw-1', method: 'GET', body: undefined },
    ]);
    await user.click(toggle());
    expect(screen.queryByText('Farmers call a helpline.')).not.toBeInTheDocument();
    await user.click(toggle());
    expect(await screen.findByText('Farmers call a helpline.')).toBeInTheDocument();
    expect(docCalls).toHaveLength(1);
  });

  it('shows the placeholder when the document request fails or cannot reach the server', async () => {
    stubFetch(() => jsonResponse({ error: 'Admin only.' }, 403));
    const user = userEvent.setup();
    renderCard();
    await user.click(toggle());
    expect(await screen.findByText('No assembled document yet.')).toBeInTheDocument();
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    renderCard({ id: 'pw-2', title: 'Second pathway' });
    await user.click(screen.getByRole('button', { name: /Second pathway/ }));
    expect(await screen.findAllByText('No assembled document yet.')).toHaveLength(2);
  });

  it('shows a placeholder when no document has been assembled', async () => {
    withDoc(null);
    const user = userEvent.setup();
    renderCard();
    await user.click(toggle());
    expect(await screen.findByText('No assembled document yet.')).toBeInTheDocument();
  });

  it('renders frontmatter as a block and strips it from the body', async () => {
    withDoc('---\ntitle: Kisan Voice\nsector: Agriculture\nstage: Pilot\n---\n\nBody text here.');
    const user = userEvent.setup();
    renderCard();
    await user.click(toggle());
    expect(await screen.findByText('Kisan Voice')).toBeInTheDocument();
    expect(screen.getByText('Pilot · Agriculture')).toBeInTheDocument();
    expect(screen.getByText('Body text here.')).toBeInTheDocument();
    expect(screen.queryByText(/title: Kisan Voice/)).not.toBeInTheDocument();
  });

  it('splits toolkit assets into those in this review and those shared later', async () => {
    withDoc(`# Doc\n\n${ASSET_BLOCK_START}\n<!-- asset-id: ${ASSET_A} -->\n${ASSET_BLOCK_END}\n`);
    const user = userEvent.setup();
    renderCard({
      toolkitAssets: [
        asset(ASSET_A),
        asset(ASSET_B, { kind: 'link', fileName: null, sizeBytes: null, linkDomain: 'github.com', name: 'Repo link' }),
        asset(ASSET_C, { published: true, name: 'Old published' }),
      ],
    });
    await user.click(toggle());
    expect(await screen.findByText('Toolkit assets in this review (1)')).toBeInTheDocument();
    const included = screen.getByText('Toolkit assets in this review (1)').parentElement as HTMLElement;
    expect(within(included).getByText(/checklist\.pdf · 2\.0 MB/)).toBeInTheDocument();
    expect(within(included).getByText(/Not scanned for malware/)).toBeInTheDocument();
    const download = within(included).getAllByRole('link', { name: 'Download' })[0];
    expect(download).toHaveAttribute('href', `/api/toolkit-assets/${ASSET_A}/download`);
    expect(download).toHaveAttribute('download');

    expect(screen.getByText(/Shared after this review was sent \(1\)/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Open link' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('github.com')).toBeInTheDocument();
    // Already-published assets not in this document are not listed at all.
    expect(screen.queryByText(/Old published/)).not.toBeInTheDocument();
  });

  it('says None when no assets are listed in the document', async () => {
    withDoc('# Doc with no assets');
    const user = userEvent.setup();
    renderCard({ toolkitAssets: [asset(ASSET_A, { sizeBytes: 500 })] });
    await user.click(toggle());
    expect(await screen.findByText('Toolkit assets in this review (0)')).toBeInTheDocument();
    expect(screen.getByText('None.')).toBeInTheDocument();
    // Small files round up to 1 KB.
    expect(screen.getByText(/checklist\.pdf · 1 KB/)).toBeInTheDocument();
  });
});
