// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deferred } from '../../helpers/ui-fork-http';
import ToolkitAssetConsentCard from '@/components/ToolkitAssetConsentCard';
import type { ToolkitAssetConsentState } from '@/lib/toolkit-assets';

type Result = { ok: boolean; error?: string };

const fileConsent: ToolkitAssetConsentState = {
  id: 'tc-1',
  status: 'pending',
  candidate: { source: { fileName: 'vendor-checklist.xlsx' }, name: 'Vendor evaluation checklist', purpose: 'Scores AI vendors' },
};
const linkConsent: ToolkitAssetConsentState = {
  id: 'tc-2',
  status: 'pending',
  candidate: { source: { url: 'https://www.github.com/org/tool' }, name: 'Open-source IVR tool' },
};

function renderCard(
  consent: ToolkitAssetConsentState = fileConsent,
  fileAvailable = true,
  onAnswer = vi.fn(async (): Promise<Result> => ({ ok: true }))
) {
  render(<ToolkitAssetConsentCard consent={consent} fileAvailable={fileAvailable} onAnswer={onAnswer} />);
  return onAnswer;
}

describe('ToolkitAssetConsentCard', () => {
  it('shows a file candidate with name, file name and purpose', () => {
    renderCard();
    expect(screen.getByText('Vendor evaluation checklist')).toBeInTheDocument();
    expect(screen.getByText('vendor-checklist.xlsx')).toBeInTheDocument();
    expect(screen.getByText('Scores AI vendors')).toBeInTheDocument();
    expect(screen.getByText('📎')).toBeInTheDocument();
  });

  it('shows a link candidate by its domain without www', () => {
    renderCard(linkConsent);
    expect(screen.getByText('github.com')).toBeInTheDocument();
    expect(screen.getByText('🔗')).toBeInTheDocument();
  });

  it('falls back to the raw url when it cannot be parsed', () => {
    renderCard({ ...linkConsent, candidate: { source: { url: 'not a url' }, name: 'Odd' } });
    expect(screen.getByText('not a url')).toBeInTheDocument();
  });

  it('Yes shares, No declines', async () => {
    const user = userEvent.setup();
    const onAnswer = renderCard();
    await user.click(screen.getByRole('button', { name: 'Yes, share' }));
    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(onAnswer.mock.calls).toEqual([[true], [false]]);
  });

  it('a file no longer in memory cannot be shared but can still be declined', async () => {
    const user = userEvent.setup();
    const onAnswer = renderCard(fileConsent, false);
    expect(screen.getByText(/Attach the file again to share it/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, share' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it('a link is shareable even when fileAvailable is false', () => {
    renderCard(linkConsent, false);
    expect(screen.queryByText(/Attach the file again/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, share' })).toBeEnabled();
  });

  it('shows the error from a failed answer', async () => {
    const user = userEvent.setup();
    renderCard(fileConsent, true, vi.fn(async () => ({ ok: false, error: 'Upload failed' })));
    await user.click(screen.getByRole('button', { name: 'Yes, share' }));
    expect(await screen.findByText('Upload failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, share' })).toBeEnabled();
  });

  it('disables both buttons while busy and ignores a double click', async () => {
    const gate = deferred<Result>();
    const onAnswer = vi.fn(() => gate.promise);
    const user = userEvent.setup();
    renderCard(fileConsent, true, onAnswer);
    await user.click(screen.getByRole('button', { name: 'Yes, share' }));
    const sharing = screen.getByRole('button', { name: 'Sharing…' });
    expect(sharing).toBeDisabled();
    expect(screen.getByRole('button', { name: 'No' })).toBeDisabled();
    await user.click(sharing);
    expect(onAnswer).toHaveBeenCalledTimes(1);
    gate.resolve({ ok: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Yes, share' })).toBeEnabled());
  });

  it.each([
    ['shared', 'Added. It will go live when this pathway is approved.'],
    ['declined', 'Not shared.'],
  ] as const)('%s: shows the outcome and no buttons', (status, text) => {
    renderCard({ ...fileConsent, status });
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
