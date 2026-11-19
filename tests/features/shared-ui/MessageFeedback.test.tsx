// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { jsonResponse, stubFetch } from '../../helpers/ui-fork-http';
import MessageFeedback from '@/components/MessageFeedback';
import type { FeedbackVote } from '@/lib/message-feedback';

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(opts: { vote?: FeedbackVote; ok?: boolean } = {}) {
  const http = stubFetch((call) =>
    call.url === '/api/feedback' ? (opts.ok === false ? jsonResponse({ error: 'x' }, 500) : new Response(null, { status: 204 })) : undefined
  );
  const onChange = vi.fn();
  render(
    <MessageFeedback
      messageId="m1"
      surface="explore"
      content={'Closest match:\n\n  the MahaVISTAAR pathway.'}
      vote={opts.vote}
      conversationId={null}
      pathwaySlug="mahavistaar"
      onChange={onChange}
    />
  );
  return {
    ...http,
    onChange,
    up: screen.getByRole('button', { name: 'Helpful' }),
    down: screen.getByRole('button', { name: 'Not helpful' }),
  };
}

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

describe('MessageFeedback', () => {
  it('starts with neither thumb pressed', () => {
    const { up, down } = setup();
    expect(up).toHaveAttribute('aria-pressed', 'false');
    expect(down).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows a stored vote as pressed', () => {
    const { down } = setup({ vote: -1 });
    expect(down).toHaveAttribute('aria-pressed', 'true');
  });

  it('posts a thumbs up with the reply excerpt and reports it to the parent', async () => {
    const { up, calls, onChange } = setup();
    await click(up);
    expect(up).toHaveAttribute('aria-pressed', 'true');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: '/api/feedback',
      method: 'POST',
      body: {
        messageId: 'm1',
        surface: 'explore',
        vote: 'up',
        conversationId: null,
        pathwaySlug: 'mahavistaar',
        excerpt: 'Closest match: the MahaVISTAAR pathway.',
      },
    });
    expect(onChange).toHaveBeenCalledWith('m1', 1);
  });

  it('switches from up to down', async () => {
    const { up, down, calls, onChange } = setup({ vote: 1 });
    await click(down);
    expect(down).toHaveAttribute('aria-pressed', 'true');
    expect(up).toHaveAttribute('aria-pressed', 'false');
    expect((calls[0].body as { vote: string }).vote).toBe('down');
    expect(onChange).toHaveBeenCalledWith('m1', -1);
  });

  it('clicking the pressed thumb again removes the vote', async () => {
    const { up, calls, onChange } = setup({ vote: 1 });
    await click(up);
    expect(up).toHaveAttribute('aria-pressed', 'false');
    expect((calls[0].body as { vote: unknown }).vote).toBeNull();
    expect(onChange).toHaveBeenCalledWith('m1', null);
  });

  it('puts the previous vote back and says so when saving fails', async () => {
    const { up, down, onChange } = setup({ vote: 1, ok: false });
    await click(down);
    expect(up).toHaveAttribute('aria-pressed', 'true');
    expect(down).toHaveAttribute('aria-pressed', 'false');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Couldn.t save/)).toBeInTheDocument();
  });

  it('puts the previous vote back when the network is down', async () => {
    const { up } = setup();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    await click(up);
    expect(up).toHaveAttribute('aria-pressed', 'false');
  });
});
