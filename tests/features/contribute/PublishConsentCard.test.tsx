// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deferred } from '../../helpers/ui-fork-http';
import PublishConsentCard from '@/components/PublishConsentCard';
import type { PublishConsentState } from '@/lib/toolkit-assets';

type Result = { ok: boolean; error?: string };
const pending: PublishConsentState = { id: 'consent-1', status: 'pending' };

let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  assign = vi.fn();
  vi.stubGlobal('location', { assign });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function renderCard(consent: PublishConsentState = pending, onAnswer = vi.fn(async (): Promise<Result> => ({ ok: true }))) {
  render(<PublishConsentCard consent={consent} onAnswer={onAnswer} />);
  return onAnswer;
}

describe('PublishConsentCard', () => {
  it('pending: shows the question and three choices', () => {
    renderCard();
    expect(screen.getByText('Ready to send for review?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, send for review' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'No, keep it as a private draft' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'No, delete this contribution' })).toBeEnabled();
  });

  it.each([
    ['sent', 'Confirmed and sent for review.'],
    ['kept', 'Kept as a private draft. You can send it for review whenever you like.'],
    ['deleted', 'This contribution was deleted.'],
  ] as const)('%s: shows the outcome and no buttons', (status, text) => {
    renderCard({ id: 'c', status });
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('send answers "send" without a confirmation and does not navigate', async () => {
    const user = userEvent.setup();
    const onAnswer = renderCard();
    await user.click(screen.getByRole('button', { name: 'Yes, send for review' }));
    expect(onAnswer).toHaveBeenCalledWith('send');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it('keep answers "keep"', async () => {
    const user = userEvent.setup();
    const onAnswer = renderCard();
    await user.click(screen.getByRole('button', { name: 'No, keep it as a private draft' }));
    expect(onAnswer).toHaveBeenCalledWith('keep');
  });

  it('delete asks for confirmation; cancelling does nothing', async () => {
    const user = userEvent.setup();
    const onAnswer = renderCard();
    await user.click(screen.getByRole('button', { name: 'No, delete this contribution' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this contribution?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('confirmed delete answers "delete" and goes to /contribute', async () => {
    const user = userEvent.setup();
    const onAnswer = renderCard();
    await user.click(screen.getByRole('button', { name: 'No, delete this contribution' }));
    await user.click(screen.getByRole('button', { name: 'Delete contribution' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/contribute'));
    expect(onAnswer).toHaveBeenCalledWith('delete');
  });

  it('a failed delete shows the error and does not navigate', async () => {
    const user = userEvent.setup();
    renderCard(pending, vi.fn(async () => ({ ok: false, error: 'Could not delete. Try again.' })));
    await user.click(screen.getByRole('button', { name: 'No, delete this contribution' }));
    await user.click(screen.getByRole('button', { name: 'Delete contribution' }));
    expect(await screen.findByText('Could not delete. Try again.')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'No, delete this contribution' })).toBeEnabled();
  });

  it('a failure without an error message shows nothing but re-enables the buttons', async () => {
    const user = userEvent.setup();
    renderCard(pending, vi.fn(async () => ({ ok: false })));
    await user.click(screen.getByRole('button', { name: 'Yes, send for review' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Yes, send for review' })).toBeEnabled());
    expect(document.querySelector('p.text-coral')).toBeNull();
  });

  it('disables every choice while an answer is in flight and ignores a double click', async () => {
    const gate = deferred<Result>();
    const onAnswer = vi.fn(() => gate.promise);
    const user = userEvent.setup();
    renderCard(pending, onAnswer);
    await user.click(screen.getByRole('button', { name: 'Yes, send for review' }));
    const sending = screen.getByRole('button', { name: 'Sending…' });
    expect(sending).toBeDisabled();
    expect(screen.getByRole('button', { name: 'No, keep it as a private draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'No, delete this contribution' })).toBeDisabled();
    await user.click(sending);
    expect(onAnswer).toHaveBeenCalledTimes(1);
    gate.resolve({ ok: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Yes, send for review' })).toBeEnabled());
  });

  it('shows "Deleting…" while a confirmed delete is in flight', async () => {
    const gate = deferred<Result>();
    const user = userEvent.setup();
    renderCard(pending, vi.fn(() => gate.promise));
    await user.click(screen.getByRole('button', { name: 'No, delete this contribution' }));
    await user.click(screen.getByRole('button', { name: 'Delete contribution' }));
    expect(await screen.findByRole('button', { name: 'Deleting…' })).toBeDisabled();
    gate.resolve({ ok: false, error: 'nope' });
    expect(await screen.findByText('nope')).toBeInTheDocument();
  });

  it('clears a previous error on the next answer', async () => {
    const onAnswer = vi
      .fn<(c: 'send' | 'keep' | 'delete') => Promise<Result>>()
      .mockResolvedValueOnce({ ok: false, error: 'Assemble failed' })
      .mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();
    renderCard(pending, onAnswer);
    await user.click(screen.getByRole('button', { name: 'Yes, send for review' }));
    expect(await screen.findByText('Assemble failed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'No, keep it as a private draft' }));
    await waitFor(() => expect(screen.queryByText('Assemble failed')).not.toBeInTheDocument());
  });
});
