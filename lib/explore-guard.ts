// Input checks for /api/chat's 'library' mode — the public /explore chat,
// reachable with no login — run before any database read or Claude call so a
// rejected conversation costs nothing. Default limits started as the customer's
// 20 / 1,000 / 20,000 (see
// docs/features/monitoring-logging-cleanup/requirement_monitoring_logging_cleanup.md
// item 7) and were raised to 50 / 2,000 / 60,000 because ordinary
// conversations hit them after about ten turns; EXPLORE_MAX_MESSAGES / EXPLORE_MAX_USER_MESSAGE_CHARS /
// EXPLORE_MAX_TOTAL_CHARS override them without a code change.
//
// Two deliberate readings of those limits, both forced by how the library
// client actually talks to this route (app/explore/ExploreLibrary.tsx):
// - An empty history is the "just opened a pathway" kickoff, so it passes;
//   the route swaps in LIBRARY_KICKOFF_PROMPT. Every conversation after that
//   starts with Cube's overview, so the first message is allowed to be
//   'assistant' — only the last one has to be the visitor's.
// - The per-message cap applies to the visitor's own messages. Cube's replies
//   are sent back as history and often run past 1,000 characters; they still
//   count towards the conversation total.

const DEFAULT_MAX_MESSAGES = 50;
const DEFAULT_MAX_USER_MESSAGE_CHARS = 2_000;
const DEFAULT_MAX_TOTAL_CHARS = 60_000;

// Same rule as lib/rate-limit.ts: a missing, invalid or non-positive value
// falls back to the default.
function limitFromEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export interface ExploreMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Why a conversation was refused. 'invalid' is a malformed request (nothing a
// real visitor can cause); the other two are limits an ordinary visitor can
// hit, so each gets its own message telling them what to do.
export type ExploreProblem = 'invalid' | 'message-too-long' | 'conversation-full';

export const EXPLORE_PROBLEM_MESSAGES: Record<Exclude<ExploreProblem, 'invalid'>, string> = {
  'message-too-long': 'Your message is too long. Please shorten it and send it again.',
  'conversation-full': 'This conversation has reached its length limit. Go back to the library to start a new chat.',
};

// null when the conversation is fine. Shape is checked before any limit, so
// a malformed request is always 'invalid', never mistaken for a full chat.
export function exploreConversationProblem(messages: unknown): ExploreProblem | null {
  if (!Array.isArray(messages)) return 'invalid';
  if (messages.length === 0) return null;

  let total = 0;
  let messageTooLong = false;
  const maxUserMessageChars = limitFromEnv('EXPLORE_MAX_USER_MESSAGE_CHARS', DEFAULT_MAX_USER_MESSAGE_CHARS);
  for (const message of messages) {
    if (typeof message !== 'object' || message === null) return 'invalid';
    const { role, content } = message as { role?: unknown; content?: unknown };
    if (role !== 'user' && role !== 'assistant') return 'invalid';
    if (typeof content !== 'string') return 'invalid';
    if (role === 'user' && content.length > maxUserMessageChars) messageTooLong = true;
    total += content.length;
  }
  if ((messages[messages.length - 1] as ExploreMessage).role !== 'user') return 'invalid';

  if (messageTooLong) return 'message-too-long';
  const maxMessages = limitFromEnv('EXPLORE_MAX_MESSAGES', DEFAULT_MAX_MESSAGES);
  const maxTotalChars = limitFromEnv('EXPLORE_MAX_TOTAL_CHARS', DEFAULT_MAX_TOTAL_CHARS);
  if (messages.length > maxMessages || total > maxTotalChars) return 'conversation-full';
  return null;
}

export function isValidExploreConversation(messages: unknown): messages is ExploreMessage[] {
  return exploreConversationProblem(messages) === null;
}
