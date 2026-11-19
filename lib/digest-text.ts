// Text helpers for the Feedback Digest (docs/features/feedback-digest/,
// FD-02). Pure, no server imports. Users' own words go through these before
// they reach the model, and the model's words go through them before they
// are stored: there is no general PII screening in this app (TD-15), so
// contact details are removed here at least.

// The lookbehind makes a match start only at the beginning of a run of
// address characters. Without it every position in a long run of letters
// retried the whole run (quadratic); with it the scan is linear.
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_LIKE = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
// 10 or more digits (ASCII or Devanagari), optionally with a leading +,
// brackets around digits (an area code), and between digits one space, dot
// or dash, or up to two spaces. Shorter numbers ("400 farmers", "2026") and
// a numbered list ("1. 2. 3.") are left alone.
const DIGIT = '[\\d\\u0966-\\u096F]';
const PHONE = new RegExp(
  `(?<![\\w.])\\+?\\(?${DIGIT}\\)?(?:(?:\\s{1,2}|[.-])?\\(?${DIGIT}\\)?){9,}(?![\\w.])`,
  'g'
);

export function scrubContact(text: string): string {
  return text.replace(EMAIL, '[email]').replace(URL_LIKE, '[link]').replace(PHONE, '[phone]');
}

// Cuts to max characters with an ellipsis, never in the middle of a
// surrogate pair (an emoji): half an emoji is not valid text and a database
// would refuse to store it.
export function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = Math.max(0, max - 1);
  const last = text.charCodeAt(end - 1);
  if (end > 0 && last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}

// For text the database already cut to `cut` characters: the last word may
// have been split (half an email address), so drop it before scrubbing. Text
// shorter than the cut, or a single long word, is left as it is.
export function dropCutWord(text: string, cut: number): string {
  return text.length >= cut ? text.replace(/\s+\S+$/, '') : text;
}

// One line of the model's input: no line breaks, no "|" (the field
// separator) and no "<" (so a message can't open or close a data block).
export function oneLine(text: string): string {
  return text.replace(/[\r\n|]+/g, ' ').replace(/</g, '‹').replace(/\s+/g, ' ').trim();
}
