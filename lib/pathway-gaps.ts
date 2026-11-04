// Every generated pathway document (see content/pathway-generation-prompt.md's
// Section 2 spec) carries a "**Gaps**" bullet list under its
// "# 2. Coverage Grid and Gaps" heading, ending at the next "# " heading. The Contributor flow's automatic
// draft message quotes these bullets verbatim rather than having the
// companion model separately (and possibly inconsistently) reason about gaps
// itself — see lib/adoption-conversation.ts's handling of pathwayAction
// "generate".
export function extractGapsFromPathwayDraft(markdown: string): string[] {
  const startMatch = markdown.match(/^#\s*2\.\s*Coverage Grid and Gaps.*$/m);
  if (!startMatch || startMatch.index === undefined) return [];

  const afterStart = startMatch.index + startMatch[0].length;
  const nextHeading = markdown.slice(afterStart).match(/^#\s/m);
  const section = nextHeading?.index != null ? markdown.slice(afterStart, afterStart + nextHeading.index) : markdown.slice(afterStart);

  const gapsMatch = section.match(/\*\*Gaps\*\*\s*\n([\s\S]*)/);
  if (!gapsMatch) return [];

  return gapsMatch[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('-'))
    .map((line) => line.replace(/^-\s*/, '').trim())
    .filter(Boolean);
}
