// The admin "Thumbs down" review (/admin/usage/feedback): for each 👎, the
// question the person asked just before the rated reply. Pure, no server
// imports. Only that one question is shown, never the rest of the
// conversation, and only its bubble text (displayContent over content), so
// an uploaded document's extracted text never reaches the page.

/** Thumbs down per page. */
export const PAGE_SIZE = 20;

/** Characters of the question shown on the page. */
export const QUESTION_CHARS = 600;

export type QuestionLookup =
  | { status: 'found'; question: string }
  /** A signed-out Explore visitor: the chat isn't saved. */
  | { status: 'not_saved' }
  /** The person deleted the conversation (or their account). */
  | { status: 'deleted' }
  /** The rated reply is no longer in the conversation (e.g. it was cleared). */
  | { status: 'reply_gone' }
  /** Cube's reply had no question before it (an opening message). */
  | { status: 'no_question' };

const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** The moment `days` days before `now`, as an ISO string (a period's start). */
export function daysAgoIso(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

export function shortText(text: string, max = QUESTION_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The visible user message nearest before the reply with id `messageId`.
 * Tolerates a malformed messages value (users can write their own arrays).
 */
export function questionBefore(messages: unknown, messageId: string): QuestionLookup {
  const list = Array.isArray(messages) ? messages : [];
  const at = list.findIndex((m) => obj(m)?.id === messageId);
  if (at < 0) return { status: 'reply_gone' };
  for (let i = at - 1; i >= 0; i--) {
    const m = obj(list[i]);
    if (!m || m.role !== 'user' || m.hidden === true) continue;
    const bubble = typeof m.displayContent === 'string' && m.displayContent.trim() ? m.displayContent : m.content;
    const text = typeof bubble === 'string' ? shortText(bubble) : '';
    if (text) return { status: 'found', question: text };
  }
  return { status: 'no_question' };
}
