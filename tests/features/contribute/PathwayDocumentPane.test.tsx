// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deferred } from '../../helpers/ui-fork-http';

vi.mock('@/lib/adoption-plan-pdf', () => ({ downloadPlanAsPdf: vi.fn() }));

// The real list queries Supabase; here it only reports a not-yet-sent count
// the test chooses, and records the props it was given.
const statusList = vi.hoisted(() => ({ unsent: 0, props: [] as Record<string, unknown>[] }));
vi.mock('@/components/ToolkitAssetStatusList', () => ({
  default: function StubStatusList(props: { onUnsentCountChange?: (n: number) => void }) {
    statusList.props.push(props as Record<string, unknown>);
    const { onUnsentCountChange } = props;
    useEffect(() => {
      onUnsentCountChange?.(statusList.unsent);
    }, [onUnsentCountChange]);
    return null;
  },
}));

import { downloadPlanAsPdf } from '@/lib/adoption-plan-pdf';
import PathwayDocumentPane from '@/components/PathwayDocumentPane';

type Props = Parameters<typeof PathwayDocumentPane>[0];

const DOC = `---
title: Voice AI for Agriculture
sector: Agriculture
stage: Scale
tags: [voice, extension]
---
# Overview

Body text here.`;

const versions = [
  { version_number: 1, created_at: '2026-09-01T10:00:00Z' },
  { version_number: 2, created_at: '2026-09-05T10:00:00Z' },
  { version_number: 3, created_at: '2026-09-09T10:00:00Z' },
];

function renderPane(over: Partial<Props> = {}) {
  const props: Props = {
    markdown: DOC,
    loading: false,
    error: null,
    onClose: vi.fn(),
    onPublish: vi.fn(async () => ({ ok: true })),
    status: 'draft',
    versions,
    selectedVersionNumber: null,
    latestVersionNumber: 3,
    publishedVersionNumber: 1,
    onSelectVersion: vi.fn(),
    deploymentName: 'Kisan Voice / Odisha',
    ...over,
  };
  const utils = render(<PathwayDocumentPane {...props} />);
  return { ...utils, props, user: userEvent.setup() };
}

beforeEach(() => {
  statusList.unsent = 0;
  statusList.props = [];
  Element.prototype.scrollIntoView = vi.fn();
});

describe('PathwayDocumentPane', () => {
  it('renders the frontmatter block and the document body (frontmatter stripped)', () => {
    renderPane();
    expect(screen.getByText('Voice AI for Agriculture')).toBeInTheDocument();
    expect(screen.getByText('Scale · Agriculture')).toBeInTheDocument();
    expect(screen.getByText('voice')).toBeInTheDocument();
    expect(screen.getByText('Body text here.')).toBeInTheDocument();
    expect(screen.queryByText(/^title:/)).not.toBeInTheDocument();
  });

  it.each([
    ['draft', 'Draft'],
    ['awaiting', 'Awaiting Review'],
    ['published', 'Published'],
  ] as const)('shows the %s status label', (status, label) => {
    renderPane({ status });
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('shows the drafting placeholder while loading with no markdown, and no footer', () => {
    renderPane({ markdown: '', loading: true });
    expect(screen.getByText('Drafting your pathway page…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download PDF' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send for Review' })).not.toBeInTheDocument();
  });

  it('shows only the error when there is one', () => {
    renderPane({ error: 'Could not load the draft.' });
    expect(screen.getByText('Could not load the draft.')).toBeInTheDocument();
    expect(screen.queryByText('Body text here.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download PDF' })).not.toBeInTheDocument();
  });

  it('Close calls onClose', async () => {
    const { user, props } = renderPane();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('downloads a PDF named after the deployment', async () => {
    const { user } = renderPane();
    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(downloadPlanAsPdf).toHaveBeenCalledWith(DOC, 'kisan-voice-odisha-pathway.pdf');
  });

  it('a name ending in punctuation gives no double hyphen in the PDF name', async () => {
    const { user } = renderPane({ deploymentName: 'Kisan Voice!' });
    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(downloadPlanAsPdf).toHaveBeenCalledWith(DOC, 'kisan-voice-pathway.pdf');
  });

  it('falls back to "pathway" for the PDF name', async () => {
    const { user } = renderPane({ deploymentName: undefined });
    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(downloadPlanAsPdf).toHaveBeenCalledWith(DOC, 'pathway-pathway.pdf');
  });

  it('disables Download PDF and Send for Review while loading', () => {
    renderPane({ loading: true });
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send for Review' })).toBeDisabled();
  });

  it('lists versions with latest/published tags and selects one', async () => {
    const { user, props } = renderPane();
    const select = screen.getByRole('combobox', { name: 'Select version' });
    expect(select).toHaveTextContent(/^v0\.3 \(latest\)/);
    await user.click(select);
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent?.split(' — ')[0])).toEqual(['v0.1 (published)', 'v0.2', 'v0.3 (latest)']);
    await user.click(options[1]);
    expect(props.onSelectVersion).toHaveBeenCalledWith(2);
  });

  it('hides the version picker when there are no versions', () => {
    renderPane({ versions: [] });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('viewing an older version hides Send for Review and explains why', () => {
    renderPane({ selectedVersionNumber: 2 });
    expect(screen.getByText('Viewing v0.2 — publishing always uses the latest version.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send for Review' })).not.toBeInTheDocument();
  });

  it('offers Send for Review on the latest version of a draft', () => {
    renderPane({ selectedVersionNumber: 3 });
    expect(screen.getByRole('button', { name: 'Send for Review' })).toBeEnabled();
  });

  it('does not offer Send for Review once sent, with no new assets', () => {
    renderPane({ status: 'awaiting', pathwayId: 'p1' });
    expect(screen.queryByRole('button', { name: 'Send for Review' })).not.toBeInTheDocument();
  });

  it('offers Send for Review again when new toolkit assets are unsent', async () => {
    statusList.unsent = 2;
    renderPane({ status: 'published', pathwayId: 'p1', toolkitAssetsRefreshKey: 4 });
    expect(await screen.findByText('2 new toolkit assets not yet sent for review.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send for Review' })).toBeInTheDocument();
    expect(statusList.props[0]).toMatchObject({ pathwayId: 'p1', refreshKey: 4, countOnly: true });
  });

  it('uses the singular for one unsent asset', async () => {
    statusList.unsent = 1;
    renderPane({ status: 'awaiting', pathwayId: 'p1' });
    expect(await screen.findByText('1 new toolkit asset not yet sent for review.')).toBeInTheDocument();
  });

  it('only tracks assets when a pathwayId is given', () => {
    renderPane();
    expect(statusList.props).toHaveLength(0);
  });

  it('Send for Review asks in chat and then says to confirm there', async () => {
    const { user, props } = renderPane();
    await user.click(screen.getByRole('button', { name: 'Send for Review' }));
    expect(props.onPublish).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Please confirm in the chat to send it.')).toBeInTheDocument();
  });

  it('shows Sending… disabled while pending (no double submit)', async () => {
    const pending = deferred<{ ok: boolean; error?: string }>();
    const { user, props } = renderPane({ onPublish: vi.fn(() => pending.promise) });
    await user.click(screen.getByRole('button', { name: 'Send for Review' }));
    const busy = screen.getByRole('button', { name: 'Sending…' });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(props.onPublish).toHaveBeenCalledTimes(1);
    pending.resolve({ ok: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send for Review' })).toBeEnabled());
  });

  it('shows the publish error (or a generic one) and re-enables the button', async () => {
    const onPublish = vi
      .fn<() => Promise<{ ok: boolean; error?: string }>>()
      .mockResolvedValueOnce({ ok: false, error: 'Pathway is locked.' })
      .mockResolvedValueOnce({ ok: false });
    const { user } = renderPane({ onPublish });
    await user.click(screen.getByRole('button', { name: 'Send for Review' }));
    expect(await screen.findByText('Pathway is locked.')).toBeInTheDocument();
    expect(screen.queryByText('Please confirm in the chat to send it.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send for Review' }));
    expect(await screen.findByText('Could not publish. Try again.')).toBeInTheDocument();
  });

  it('renders a document with no frontmatter without the frontmatter block', () => {
    renderPane({ markdown: '# Just a heading\n\nPlain.' });
    expect(screen.getByText('Plain.')).toBeInTheDocument();
  });
});
