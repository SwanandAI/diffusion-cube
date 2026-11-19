// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { jsonResponse, stubFetch } from '../../helpers/ui-fork-http';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import GenerateButton, { DIGEST_MESSAGES } from '@/components/digest/GenerateButton';

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => refresh.mockReset());

function setup(response: () => Response | Promise<Response>, props: { period?: 7 | 30; hasDigest?: boolean } = {}) {
  const http = stubFetch((call) => (call.url === '/api/admin/digest' ? response() : undefined));
  render(<GenerateButton period={props.period ?? 7} hasDigest={props.hasDigest ?? true} />);
  return http;
}

async function clickAndConfirm(label = 'Regenerate') {
  fireEvent.click(screen.getByRole('button', { name: label }));
  const dialog = await screen.findByRole('dialog');
  await act(async () => {
    fireEvent.click(dialog.querySelectorAll('button')[1]); // the confirm button
  });
}

describe('GenerateButton', () => {
  it('reads "Generate digest" without a digest and "Regenerate" with one', () => {
    setup(() => jsonResponse({ ok: true }), { hasDigest: false });
    expect(screen.getByRole('button', { name: 'Generate digest' })).toBeInTheDocument();
  });

  it('asks a plain confirmation without any cost, then posts the period and refreshes', async () => {
    const { calls } = setup(() => jsonResponse({ ok: true }), { period: 30 });
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Regenerate the digest for the last 30 days?');
    expect(dialog.textContent).not.toMatch(/\$|cost/i);
    await act(async () => {
      fireEvent.click(dialog.querySelectorAll('button')[1]);
    });
    expect(calls).toEqual([{ url: '/api/admin/digest', method: 'POST', body: { periodDays: 30 } }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Cancel sends nothing', async () => {
    const { calls } = setup(() => jsonResponse({ ok: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(dialog.querySelectorAll('button')[0]);
    expect(calls).toEqual([]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the waiting state and ignores a second click while generating', async () => {
    let release!: (r: Response) => void;
    const { calls } = setup(() => new Promise<Response>((r) => (release = r)));
    await clickAndConfirm();
    expect(screen.getByRole('button', { name: 'Generating…' })).toBeDisabled();
    expect(screen.getByText('Generating… this can take a minute or two.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Generating…' }));
    expect(calls).toHaveLength(1);
    await act(async () => release(jsonResponse({ ok: true })));
    expect(refresh).toHaveBeenCalled();
  });

  it.each([
    ['busy (409)', () => jsonResponse({ error: 'busy' }, 409), DIGEST_MESSAGES.busy],
    ['daily limit (429)', () => jsonResponse({ error: 'daily_limit' }, 429), DIGEST_MESSAGES.dailyLimit],
    ['a failed run (503)', () => jsonResponse({ error: 'System encountered an error.' }, 503), DIGEST_MESSAGES.failed],
    ['a non-JSON 500', () => new Response('oops', { status: 500 }), DIGEST_MESSAGES.failed],
  ])('shows the message for %s and does not refresh', async (_label, response, message) => {
    setup(response);
    await clickAndConfirm();
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a superseded run shows its message and refreshes to the newer digest', async () => {
    setup(() => jsonResponse({ error: 'superseded' }, 409));
    await clickAndConfirm();
    expect(screen.getByRole('alert')).toHaveTextContent(DIGEST_MESSAGES.superseded);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a network failure shows the failed message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    render(<GenerateButton period={7} hasDigest />);
    await clickAndConfirm();
    expect(screen.getByRole('alert')).toHaveTextContent(DIGEST_MESSAGES.failed);
  });
});
