// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createSupabaseMock, type SupabaseMock } from '../../helpers/supabase-mock';
import { deferred, jsonResponse, stubFetch } from '../../helpers/ui-fork-http';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { showToast } from '@/lib/toast';
import ToolkitAssetStatusList from '@/components/ToolkitAssetStatusList';
import { ASSET_BLOCK_END, ASSET_BLOCK_START } from '@/lib/toolkit-assets';

const PUBLISHED = 'asset-00000001-0000-4000-8000-000000000000';
const SENT = 'asset-00000002-0000-4000-8000-000000000000';
const UNSENT = 'asset-00000003-0000-4000-8000-000000000000';

function unit(id: string, over: Record<string, unknown> = {}) {
  return {
    unit_internal_id: id,
    asset_name: `Asset ${id.slice(13, 14)}`,
    asset_kind: 'file',
    file_name: `file-${id.slice(13, 14)}.pdf`,
    link_url: null,
    published_at: null,
    ...over,
  };
}

// A legacy toolkit-asset block is the simplest document text that carries
// asset-id markers assetIdsInDocument() reads.
const docWith = (...ids: string[]) =>
  `# Doc\n\n${ASSET_BLOCK_START}\n${ids.map((id) => `- x <!-- asset-id: ${id} -->`).join('\n')}\n${ASSET_BLOCK_END}\n`;

let sb: SupabaseMock;
let units: unknown[];
let unitsError: { message: string } | null;
let doc: string | null;

beforeEach(() => {
  units = [
    unit(PUBLISHED, { published_at: '2026-09-01T00:00:00Z' }),
    unit(SENT, { asset_kind: 'link', file_name: null, link_url: 'https://www.example.org/tool' }),
    unit(UNSENT),
  ];
  unitsError = null;
  doc = docWith(SENT);
  sb = createSupabaseMock({
    tables: {
      contribution_units: () => ({ data: units, error: unitsError }),
      pathways: () => ({ data: doc === null ? null : { content_cache: doc } }),
    },
  });
  vi.mocked(createClient).mockReturnValue(sb.client);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ToolkitAssetStatusList', () => {
  it('queries this pathway’s toolkit-asset units in creation order', async () => {
    render(<ToolkitAssetStatusList pathwayId="p1" refreshKey={0} />);
    await screen.findByText('Toolkit assets');
    const [op] = sb.ops('contribution_units', 'select');
    expect(op.filters).toEqual([
      ['eq', 'pathway_id', 'p1'],
      ['eq', 'unit_type', 'toolkit-asset'],
      ['order', 'created_at', { ascending: true }],
    ]);
    expect(sb.ops('pathways')[0].filters).toEqual([['eq', 'id', 'p1']]);
  });

  it('labels each asset Published / Sent for review / Not yet sent for review', async () => {
    render(<ToolkitAssetStatusList pathwayId="p1" refreshKey={0} />);
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText('Published')).toBeInTheDocument();
    expect(within(items[1]).getByText('Sent for review')).toBeInTheDocument();
    expect(within(items[2]).getByText('Not yet sent for review')).toBeInTheDocument();
  });

  it('offers Remove only on unpublished assets', async () => {
    render(<ToolkitAssetStatusList pathwayId="p1" refreshKey={0} />);
    const items = await screen.findAllByRole('listitem');
    expect(within(items[0]).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(within(items[1]).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(within(items[2]).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('links files as downloads and links in a new tab, showing the link domain', async () => {
    render(<ToolkitAssetStatusList pathwayId="p1" refreshKey={0} />);
    const items = await screen.findAllByRole('listitem');
    const fileLink = within(items[0]).getByRole('link');
    expect(fileLink).toHaveAttribute('href', `/api/toolkit-assets/${PUBLISHED}/download`);
    expect(fileLink).toHaveAttribute('download');
    const linkLink = within(items[1]).getByRole('link');
    expect(linkLink).toHaveAttribute('target', '_blank');
    expect(within(items[1]).getByText('example.org')).toBeInTheDocument();
  });

  it('reports the not-yet-sent count (unpublished and not in the document)', async () => {
    const onCount = vi.fn();
    render(<ToolkitAssetStatusList pathwayId="p1" refreshKey={0} onUnsentCountChange={onCount} />);
    await waitFor(() => expect(onCount).toHaveBeenCalledWith(1));
  });

  it('counts every unpublished asset as unsent when there is no document yet', async () => {
    doc = null;
    const onCount = vi.fn();
    render(<ToolkitAssetStatusList pathwayId="p1" refreshKey={0} onUnsentCountChange={onCount} />);
    await waitFor(() => expect(onCount).toHaveBeenCalledWith(2));
  });

  it('shows the empty state when no assets are shared', async () => {
    units = [];
    const onCount = vi.fn();
    render(<ToolkitAssetStatusList pathwayId="p1" refreshKey={0} onUnsentCountChange={onCount} />);
    expect(await screen.findByText('No toolkit asset files shared for this pathway yet.')).toBeInTheDocument();
    expect(onCount).toHaveBeenCalledWith(0);
  });

  it('treats a query error as an empty list', async () => {
    units = null as unknown as unknown[];
    unitsError = { message: 'rls' };
    render(<ToolkitAssetStatusList pathwayId="p1" refreshKey={0} />);
    expect(await screen.findByText('No toolkit asset files shared for this pathway yet.')).toBeInTheDocument();
  });

  it('countOnly renders nothing but still reports the count', async () => {
    const onCount = vi.fn();
    const { container } = render(
      <ToolkitAssetStatusList pathwayId="p1" refreshKey={0} countOnly onUnsentCountChange={onCount} />
    );
    await waitFor(() => expect(onCount).toHaveBeenCalledWith(1));
    expect(container).toBeEmptyDOMElement();
  });

  it('refetches when refreshKey changes', async () => {
    const { rerender } = render(<ToolkitAssetStatusList pathwayId="p1" refreshKey={0} />);
    await screen.findByText('Toolkit assets');
    expect(sb.ops('contribution_units')).toHaveLength(1);
    rerender(<ToolkitAssetStatusList pathwayId="p1" refreshKey={1} />);
    await waitFor(() => expect(sb.ops('contribution_units')).toHaveLength(2));
  });

  it('cancelling the confirm leaves the asset and makes no request', async () => {
    const { fn } = stubFetch(() => jsonResponse({}));
    const user = userEvent.setup();
    render(<ToolkitAssetStatusList pathwayId="p1" refreshKey={0} />);
    const items = await screen.findAllByRole('listitem');
    await user.click(within(items[2]).getByRole('button', { name: 'Remove' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Remove "Asset 3"?')).toBeInTheDocument();
    expect(within(dialog).getByText("It won't be shared with this pathway. This can't be undone.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fn).not.toHaveBeenCalled();
  });

  it('warns that a sent asset is also taken out of the version under review', async () => {
    stubFetch(() => jsonResponse({}));
    const user = userEvent.setup();
    render(<ToolkitAssetStatusList pathwayId="p1" refreshKey={0} />);
    const items = await screen.findAllByRole('listitem');
    await user.click(within(items[1]).getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('taken out of the version waiting for review');
  });

  it('removes on confirm: DELETEs the asset, toasts and refetches', async () => {
    const { calls } = stubFetch(() => jsonResponse({ ok: true }));
    const user = userEvent.setup();
    render(<ToolkitAssetStatusList pathwayId="p1" refreshKey={0} />);
    const items = await screen.findAllByRole('listitem');
    units = units.filter((u) => (u as { unit_internal_id: string }).unit_internal_id !== UNSENT);
    await user.click(within(items[2]).getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Remove asset' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Asset removed.'));
    expect(calls).toEqual([{ url: `/api/toolkit-assets/${UNSENT}`, method: 'DELETE', body: undefined }]);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(sb.ops('contribution_units')).toHaveLength(2);
  });

  it('shows the button as Removing… and disabled while the DELETE is in flight', async () => {
    const pending = deferred<Response>();
    stubFetch(() => pending.promise);
    const user = userEvent.setup();
    render(<ToolkitAssetStatusList pathwayId="p1" refreshKey={0} />);
    const items = await screen.findAllByRole('listitem');
    await user.click(within(items[2]).getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Remove asset' }));
    const busy = await within(items[2]).findByRole('button', { name: 'Removing…' });
    expect(busy).toBeDisabled();
    pending.resolve(jsonResponse({}));
    await waitFor(() => expect(showToast).toHaveBeenCalled());
  });

  it('shows the server error as an error toast on failure', async () => {
    stubFetch(() => jsonResponse({ error: 'Asset is already published.' }, 409));
    const user = userEvent.setup();
    render(<ToolkitAssetStatusList pathwayId="p1" refreshKey={0} />);
    const items = await screen.findAllByRole('listitem');
    await user.click(within(items[2]).getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Remove asset' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Asset is already published.', 'error'));
  });

  it('falls back to a generic error toast when the failure has no JSON body', async () => {
    stubFetch(() => new Response('oops', { status: 500 }));
    const user = userEvent.setup();
    render(<ToolkitAssetStatusList pathwayId="p1" refreshKey={0} />);
    const items = await screen.findAllByRole('listitem');
    await user.click(within(items[2]).getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Remove asset' }));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Could not remove the asset. Try again.', 'error')
    );
  });

  it('toasts a network error when the request throws', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const user = userEvent.setup();
    render(<ToolkitAssetStatusList pathwayId="p1" refreshKey={0} />);
    const items = await screen.findAllByRole('listitem');
    await user.click(within(items[2]).getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Remove asset' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not reach the server. Try again.', 'error'));
    expect(within(items[2]).getByRole('button', { name: 'Remove' })).toBeEnabled();
  });
});
