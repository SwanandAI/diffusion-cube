// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ToolkitAssetCards from '@/components/ToolkitAssetCards';
import type { ToolkitAssetSummary } from '@/lib/toolkit-assets';
import { jsonResponse, stubFetch } from '../../helpers/ui-fork-http';

// The component keeps a module-level cache keyed by asset id, so every test
// uses its own ids to stay independent of test order.
let counter = 0;
function newId() {
  counter += 1;
  return `asset-${counter.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

function summary(id: string, over: Partial<ToolkitAssetSummary> = {}): ToolkitAssetSummary {
  return {
    id,
    name: 'Vendor checklist',
    purpose: 'Evaluate vendors before procurement',
    kind: 'file',
    fileName: 'checklist.pdf',
    sizeBytes: 2 * 1024 * 1024,
    linkDomain: null,
    pathwaySlug: 'voice-ai-agri',
    pathwayTitle: 'Voice AI for Agriculture',
    publishedAt: '2026-09-15T00:00:00Z',
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ToolkitAssetCards', () => {
  it('fetches the ids and renders a file card with size, pathway and month', async () => {
    const id = newId();
    const { calls } = stubFetch(() => jsonResponse({ assets: [summary(id)] }));
    render(<ToolkitAssetCards ids={[id]} />);

    expect(await screen.findByText('Vendor checklist')).toBeInTheDocument();
    expect(screen.getByText(/checklist\.pdf · 2\.0 MB · from Voice AI for Agriculture · shared Sep 2026/)).toBeInTheDocument();
    expect(screen.getByText('Evaluate vendors before procurement')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Download' });
    expect(link).toHaveAttribute('href', `/api/toolkit-assets/${id}/download`);
    expect(link).toHaveAttribute('download');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`/api/toolkit-assets?ids=${encodeURIComponent(id)}`);
  });

  it('renders a link asset with its domain and opens in a new tab', async () => {
    const id = newId();
    stubFetch(() =>
      jsonResponse({ assets: [summary(id, { kind: 'link', fileName: null, sizeBytes: null, linkDomain: 'github.com', name: 'Repo' })] })
    );
    render(<ToolkitAssetCards ids={[id]} />);
    const link = await screen.findByRole('link', { name: 'Open link' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).not.toHaveAttribute('download');
    expect(screen.getByText(/github\.com/)).toBeInTheDocument();
  });

  it('shows small files in KB (at least 1 KB)', async () => {
    const id = newId();
    stubFetch(() => jsonResponse({ assets: [summary(id, { sizeBytes: 10 })] }));
    render(<ToolkitAssetCards ids={[id]} />);
    expect(await screen.findByText(/checklist\.pdf · 1 KB/)).toBeInTheDocument();
  });

  it('never fetches for ids that are not valid asset ids', () => {
    const { fn } = stubFetch(() => jsonResponse({ assets: [] }));
    const { container } = render(<ToolkitAssetCards ids={['not-an-id', 'asset-123', '../etc/passwd']} />);
    expect(fn).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an empty id list', () => {
    const { fn } = stubFetch(() => jsonResponse({ assets: [] }));
    const { container } = render(<ToolkitAssetCards ids={[]} />);
    expect(fn).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for ids the API dropped (unknown/unpublished) and caches the miss', async () => {
    const id = newId();
    const { fn } = stubFetch(() => jsonResponse({ assets: [] }));
    const { container, unmount } = render(<ToolkitAssetCards ids={[id]} />);
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
    unmount();
    render(<ToolkitAssetCards ids={[id]} />);
    // Cached as null — no second request.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('treats a non-OK response as no assets', async () => {
    const id = newId();
    const { fn } = stubFetch(() => jsonResponse({ error: 'boom' }, 500));
    const { container } = render(<ToolkitAssetCards ids={[id]} />);
    await waitFor(() => expect(fn).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('leaves ids uncached after a network failure so a later render retries', async () => {
    const id = newId();
    let fail = true;
    const { fn } = stubFetch(() => {
      if (fail) throw new Error('offline');
      return jsonResponse({ assets: [summary(id, { name: 'Retried asset' })] });
    });
    const first = render(<ToolkitAssetCards ids={[id]} />);
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    first.unmount();
    fail = false;
    render(<ToolkitAssetCards ids={[id]} />);
    expect(await screen.findByText('Retried asset')).toBeInTheDocument();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('reuses the cache: an already-fetched asset is not requested again', async () => {
    const a = newId();
    const b = newId();
    const { calls } = stubFetch((call) => {
      const ids = decodeURIComponent(call.url.split('ids=')[1]).split(',');
      return jsonResponse({ assets: ids.map((id) => summary(id, { name: `Asset ${id === a ? 'A' : 'B'}` })) });
    });
    const first = render(<ToolkitAssetCards ids={[a]} />);
    await screen.findByText('Asset A');
    first.unmount();
    render(<ToolkitAssetCards ids={[a, b]} />);
    await screen.findByText('Asset B');
    expect(screen.getByText('Asset A')).toBeInTheDocument();
    expect(calls).toHaveLength(2);
    expect(decodeURIComponent(calls[1].url)).toBe(`/api/toolkit-assets?ids=${b}`);
  });

  it('keeps only the open pathway’s assets when pathwaySlug is given', async () => {
    const mine = newId();
    const other = newId();
    stubFetch(() =>
      jsonResponse({
        assets: [
          summary(mine, { name: 'Mine', pathwaySlug: 'p1' }),
          summary(other, { name: 'Other', pathwaySlug: 'p2' }),
        ],
      })
    );
    render(<ToolkitAssetCards ids={[mine, other]} pathwaySlug="p1" />);
    expect(await screen.findByText('Mine')).toBeInTheDocument();
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
  });

  it('omits the month and pathway parts when missing', async () => {
    const id = newId();
    stubFetch(() =>
      jsonResponse({ assets: [summary(id, { publishedAt: null, pathwayTitle: '', sizeBytes: null, purpose: '' })] })
    );
    render(<ToolkitAssetCards ids={[id]} />);
    const meta = await screen.findByText('checklist.pdf');
    expect(meta.textContent).toBe('checklist.pdf');
  });
});
