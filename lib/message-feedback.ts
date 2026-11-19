// Thumbs up / down on Cube's chat replies — shared by the browser
// (components/MessageFeedback.tsx) and POST /api/feedback. Safe to import
// from client components: no server-only dependencies.

export type FeedbackSurface = 'explore' | 'analyse' | 'contribute';
export const FEEDBACK_SURFACES: readonly FeedbackSurface[] = ['explore', 'analyse', 'contribute'];

// Stored on the message (Message.feedback / Explore's ChatMessage.feedback)
// and in message_feedback.vote.
export type FeedbackVote = 1 | -1;

// How much of the reply is kept with the vote (message_feedback's check
// constraint allows 500 characters).
export const FEEDBACK_EXCERPT_CHARS = 500;

// The id given to each finished, streamed reply. Only these replies show the
// thumbs — app-written messages, notices and cards never get one.
export function newMessageId(): string {
  return crypto.randomUUID();
}

export function feedbackExcerpt(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, FEEDBACK_EXCERPT_CHARS);
}

export interface FeedbackRequest {
  messageId: string;
  surface: FeedbackSurface;
  // null removes the visitor's vote.
  vote: 'up' | 'down' | null;
  conversationId?: string | null;
  pathwaySlug?: string | null;
  excerpt: string;
}
