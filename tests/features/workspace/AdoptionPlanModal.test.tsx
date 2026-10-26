// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/adoption-plan-pdf', () => ({ downloadPlanAsPdf: vi.fn() }));

import { downloadPlanAsPdf } from '@/lib/adoption-plan-pdf';
import AdoptionPlanModal from '@/components/AdoptionPlanModal';

type Props = Parameters<typeof AdoptionPlanModal>[0];

function renderModal(props: Partial<Props> = {}) {
  const onClose = vi.fn();
  render(
    <AdoptionPlanModal
      title="Analysis Document"
      markdown=""
      loading={false}
      error={null}
      deploymentName="Kisan Voice Pilot"
      onClose={onClose}
      filenameSuffix="analysis"
      loadingLabel="Writing your analysis…"
      {...props}
    />
  );
  return onClose;
}

describe('AdoptionPlanModal', () => {
  it('shows the title and closes via the × button', async () => {
    const user = userEvent.setup();
    const onClose = renderModal({ markdown: '# Hi' });
    expect(screen.getByRole('heading', { name: 'Analysis Document' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('loading with no content yet shows the loading label and no download', () => {
    renderModal({ loading: true });
    expect(screen.getByText('Writing your analysis…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download PDF' })).not.toBeInTheDocument();
  });

  it('streaming content shows the markdown, a Generating… note and a disabled download', () => {
    renderModal({ loading: true, markdown: '## Findings\n\nPartial text' });
    expect(screen.getByRole('heading', { name: 'Findings' })).toBeInTheDocument();
    expect(screen.getByText('Generating…')).toBeInTheDocument();
    expect(screen.queryByText('Writing your analysis…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
  });

  it('an error replaces content and hides the download', () => {
    renderModal({ error: 'Generation failed. Try again.', markdown: '# stale' });
    expect(screen.getByText('Generation failed. Try again.')).toBeInTheDocument();
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download PDF' })).not.toBeInTheDocument();
  });

  it('empty and not loading shows nothing in the body', () => {
    renderModal();
    expect(screen.queryByText('Writing your analysis…')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download PDF' })).not.toBeInTheDocument();
  });

  it('downloads a PDF named from a slugified deployment name', async () => {
    const user = userEvent.setup();
    renderModal({ markdown: '# Plan' });
    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(downloadPlanAsPdf).toHaveBeenCalledWith('# Plan', 'kisan-voice-pilot-analysis.pdf');
  });

  it('falls back to "deployment" when there is no name', async () => {
    const user = userEvent.setup();
    renderModal({ markdown: '# Plan', deploymentName: '', filenameSuffix: 'executive-summary' });
    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(downloadPlanAsPdf).toHaveBeenLastCalledWith('# Plan', 'deployment-executive-summary.pdf');
  });

  it('trims edge punctuation so the name has no leading or double hyphen', async () => {
    const user = userEvent.setup();
    renderModal({ markdown: 'x', deploymentName: '¡Kisan Voice!' });
    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(downloadPlanAsPdf).toHaveBeenLastCalledWith('x', 'kisan-voice-analysis.pdf');
  });

  it('collapses non-alphanumeric runs (including non-ASCII) into single hyphens', async () => {
    const user = userEvent.setup();
    renderModal({ markdown: 'x', deploymentName: 'Mahā VISTAAR / Phase 2' });
    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(downloadPlanAsPdf).toHaveBeenLastCalledWith('x', 'mah-vistaar-phase-2-analysis.pdf');
  });
});
