import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Facts about the committed corpus under content/wiki/pathways, read
// independently of lib/wiki-loader.ts so the tests check it rather than
// mirror it.

export const PATHWAYS_DIR = path.join(process.cwd(), 'content', 'wiki', 'pathways');

export function readPathwayFile(slug: string): string {
  return readFileSync(path.join(PATHWAYS_DIR, `${slug}.md`), 'utf-8');
}

// Every markdown link target in index.md — the curated list.
export function indexListedSlugs(): string[] {
  const index = readFileSync(path.join(PATHWAYS_DIR, 'index.md'), 'utf-8');
  return [...index.matchAll(/\]\(([^)\s]+)\.md\)/g)].map((m) => m[1]).filter((s) => s !== 'index');
}

// Files in the folder that index.md does not list — contributors' assembled,
// unpublished drafts. Must never be served from disk.
export function uncuratedDraftSlugs(): string[] {
  const listed = new Set(indexListedSlugs());
  return readdirSync(PATHWAYS_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'index.md')
    .map((f) => f.replace(/\.md$/, ''))
    .filter((s) => !listed.has(s));
}
