// The Source Trace (legacy: Provenance) appendix of a pathway document is
// contributor-only: it never reaches an adopter-facing prompt, the public
// library, or /wiki. Pure, so the unit parser and the seed script can use it
// outside a request (docs/features/pathway-storage/).
//
// The appendix starts at the first heading naming it ("## Source Trace", any
// level, any case) or at a standalone emphasised line that opens with its
// name ("*Source Trace appendix — contributor-facing only…*", the form some
// generated documents use). A word in running text never counts. Trailing
// horizontal rules left behind by the cut are removed.
const APPENDIX_START = /^(?:#{1,6}\s*.*(?:provenance|source trace).*|\s*(?:\*{1,2}|_{1,2})\s*(?:provenance|source trace)\b.*)$/im;

export function stripProvenanceAppendix(markdown: string): string {
  const match = markdown.match(APPENDIX_START);
  if (!match || match.index === undefined) return markdown;
  return markdown
    .slice(0, match.index)
    .replace(/(?:\s*\n\s*---\s*)+$/, '')
    .trim();
}
