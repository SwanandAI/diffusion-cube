// Input checks for /api/chat's 'library' mode — the public /explore chat,
// reachable with no login — run before any database read or Claude call so a
// rejected conversation costs nothing. Default limits are the customer's (see
// docs/features/monitoring-logging-cleanup/requirement_monitoring_logging_cleanup.md
// item 7); EXPLORE_MAX_MESSAGES / EXPLORE_MAX_USER_MESSAGE_CHARS /
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

const DEFAULT_MAX_MESSAGES = 20;
const DEFAULT_MAX_USER_MESSAGE_CHARS = 1_000;
const DEFAULT_MAX_TOTAL_CHARS = 20_000;

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

export function isValidExploreConversation(messages: unknown): messages is ExploreMessage[] {
  if (!Array.isArray(messages)) return false;
  if (messages.length === 0) return true;
  const maxMessages = limitFromEnv('EXPLORE_MAX_MESSAGES', DEFAULT_MAX_MESSAGES);
  const maxUserMessageChars = limitFromEnv('EXPLORE_MAX_USER_MESSAGE_CHARS', DEFAULT_MAX_USER_MESSAGE_CHARS);
  const maxTotalChars = limitFromEnv('EXPLORE_MAX_TOTAL_CHARS', DEFAULT_MAX_TOTAL_CHARS);
  if (messages.length > maxMessages) return false;

  let total = 0;
  for (const message of messages) {
    if (typeof message !== 'object' || message === null) return false;
    const { role, content } = message as { role?: unknown; content?: unknown };
    if (role !== 'user' && role !== 'assistant') return false;
    if (typeof content !== 'string') return false;
    if (role === 'user' && content.length > maxUserMessageChars) return false;
    total += content.length;
    if (total > maxTotalChars) return false;
  }

  return (messages[messages.length - 1] as ExploreMessage).role === 'user';
}
