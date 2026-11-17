'use client';

import { useState } from 'react';
import { feedbackExcerpt, type FeedbackSurface, type FeedbackVote } from '@/lib/message-feedback';

// Thumbs up / down under one of Cube's replies. Clicking the active thumb
// again removes the vote; clicking the other one switches it. The choice is
// shown immediately and posted to /api/feedback; if that fails it's put back.
// On success the parent is told (onChange) so it can keep the vote on the
// message itself, which is what makes it survive a reload.
export default function MessageFeedback({
  messageId,
  surface,
  content,
  vote,
  conversationId,
  pathwaySlug,
  onChange,
}: {
  messageId: string;
  surface: FeedbackSurface;
  // The reply text — its start is stored with the vote for admins.
  content: string;
  vote?: FeedbackVote;
  conversationId?: string | null;
  pathwaySlug?: string | null;
  onChange?: (messageId: string, vote: FeedbackVote | null) => void;
}) {
  const [current, setCurrent] = useState<FeedbackVote | null>(vote ?? null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function choose(clicked: FeedbackVote) {
    if (busy) return;
    const previous = current;
    const next = current === clicked ? null : clicked;
    setCurrent(next);
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId,
          surface,
          vote: next === 1 ? 'up' : next === -1 ? 'down' : null,
          conversationId: conversationId ?? null,
          pathwaySlug: pathwaySlug ?? null,
          excerpt: feedbackExcerpt(content),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onChange?.(messageId, next);
    } catch {
      setCurrent(previous);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const base =
    'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:cursor-wait';
  const idle = 'text-ink-soft/60 hover:bg-navy/5 hover:text-navy';

  return (
    <div className="mt-2 flex items-center gap-1 whitespace-normal" data-testid="message-feedback">
      <button
        type="button"
        aria-label="Helpful"
        aria-pressed={current === 1}
        title="Helpful"
        disabled={busy}
        onClick={() => void choose(1)}
        className={`${base} ${current === 1 ? 'bg-navy/10 text-navy' : idle}`}
      >
        <ThumbIcon />
      </button>
      <button
        type="button"
        aria-label="Not helpful"
        aria-pressed={current === -1}
        title="Not helpful"
        disabled={busy}
        onClick={() => void choose(-1)}
        className={`${base} ${current === -1 ? 'bg-coral/15 text-coral' : idle}`}
      >
        <ThumbIcon down />
      </button>
      {failed && <span className="ml-1 text-xs text-ink-soft">Couldn&rsquo;t save — try again.</span>}
    </div>
  );
}

function ThumbIcon({ down = false }: { down?: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={down ? { transform: 'rotate(180deg)' } : undefined}
    >
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );
}
