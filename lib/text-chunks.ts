import { stripFrontmatter } from '@/lib/strip-frontmatter';
import { stripProvenanceAppendix } from '@/lib/provenance';

// Pure text helpers for indexing and grounding: cutting text into passages,
// cutting a pathway document by section, and picking the passages of a long
// text that share the most words with a question. No I/O.

// Cuts text into passages of at most `size` characters (~400 tokens at
// 1,600), breaking at a paragraph or sentence where it can, with `overlap`
// characters carried into the next passage so no sentence is lost at a seam.
// gte-small reads ~512 tokens, so passages stay under that.
export function chunkText(text: string, size = 1600, overlap = 200): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const para = window.lastIndexOf('\n\n');
      const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n'));
      const cut = para > size * 0.5 ? para : sentence > size * 0.5 ? sentence + 1 : -1;
      if (cut > 0) end = start + cut;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

export interface DocumentChunk {
  section: string; // the section's heading, without the leading #s ('' before the first heading)
  chunk_index: number;
  text: string; // starts with the section heading, so each passage says where it's from
}

// The whole adopter-facing pathway document, cut into passages section by
// section (frontmatter and the contributor-only Source Trace removed). Each
// passage carries its section heading and stays within `size` characters.
export function documentChunks(markdown: string, size = 1600): DocumentChunk[] {
  const body = stripProvenanceAppendix(stripFrontmatter(markdown)).trim();
  if (!body) return [];

  const sections: { heading: string; lines: string[] }[] = [{ heading: '', lines: [] }];
  for (const line of body.split('\n')) {
    const h = line.match(/^#{1,2}\s+(.+?)\s*#*\s*$/);
    if (h) sections.push({ heading: h[1].trim(), lines: [] });
    else sections[sections.length - 1].lines.push(line);
  }

  const out: DocumentChunk[] = [];
  for (const s of sections) {
    const text = s.lines.join('\n').trim();
    if (!text) continue;
    const prefix = s.heading ? `${s.heading}\n` : '';
    for (const piece of chunkText(text, Math.max(400, size - prefix.length))) {
      out.push({ section: s.heading, chunk_index: out.length, text: `${prefix}${piece}` });
    }
  }
  return out;
}

const STOP_WORDS = new Set(
  'a an and are as at be but by did do does for from had has have how i if in into is it its of on or our so that the their them then there these they this to was we were what when where which who why will with would you your about can could should after before than more most other some such only'.split(' ')
);

export function keywordsOf(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOP_WORDS.has(w)))];
}

// How many of the question's keywords a passage contains (each counted once),
// with a small bonus for repeats. 0 when it shares none.
export function keywordScore(passage: string, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const words = passage.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  let score = 0;
  for (const k of keywords) {
    const n = counts.get(k) ?? 0;
    if (n > 0) score += 1 + Math.min(n - 1, 4) * 0.1;
  }
  return score;
}
