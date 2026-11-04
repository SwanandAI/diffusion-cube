// Removes a YAML frontmatter block from the start of a markdown string.
// Handles both LF and CRLF line endings, and optional trailing spaces on the
// --- delimiters — common in AI-generated content and GitHub file reads.
export function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '');
}

export interface PathwayFrontmatter {
  title?: string;
  description?: string;
  stage?: string;
  sector?: string;
  location?: string;
  tags?: string[];
}

// Parses the YAML frontmatter block into a structured object.
// Returns null if no frontmatter is found.
export function parseFrontmatter(markdown: string): PathwayFrontmatter | null {
  const match = markdown.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
  if (!match) return null;
  const result: PathwayFrontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    // A YAML-quoted value ("AxL: …" — quoted because it holds a colon) is
    // read without its quotes.
    const val = line.slice(colonIdx + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
    if (key === 'tags') {
      result.tags = val.startsWith('[') && val.endsWith(']')
        ? val.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean)
        : val ? [val] : [];
    } else if (key === 'title') result.title = val;
    else if (key === 'description') result.description = val;
    else if (key === 'stage') result.stage = val;
    else if (key === 'sector') result.sector = val;
    else if (key === 'location') result.location = val;
  }
  return result;
}
