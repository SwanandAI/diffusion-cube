import path from 'path';
import { createAdminClient } from '@/lib/supabase/admin';
import { readStaticFile } from '@/lib/static-content';
import { stripProvenanceAppendix } from '@/lib/wiki-content';
import { libraryPathways } from '@/lib/library-pathways';
import { curatedPathwaySlugs } from '@/lib/wiki-loader';

// The documents behind /explore (the Diffusion Library) chat. Since
// 2026-10-20 the library reads the same grounding corpus as Analyse
// (content/wiki/pathways/) plus published_pathways — the separate
// content/library-wiki/ copy is gone (one source of truth; TD-02). The card
// list itself still comes from lib/library-pathways.ts + published_pathways.
//
// The Source Trace (provenance) appendix is contributor-only and is never
// sent to the public library chat, whichever source a document comes from.

const WIKI_PATH = process.env.WIKI_PATH ?? path.join(process.cwd(), 'content', 'wiki');

// A curated pathway's document by slug, appendix removed; null if it isn't
// one. The slug is validated by the caller (isValidSlug) before it gets here,
// since it becomes a file path. An assembled-but-unpublished draft in the same
// folder is never served — the caller falls back to published_pathways.
export async function readLibraryPathwayDocument(id: string): Promise<string | null> {
  if (!(await curatedPathwaySlugs()).has(id)) return null;
  const text = await readStaticFile(path.join(WIKI_PATH, 'pathways', `${id}.md`));
  return text ? stripProvenanceAppendix(text) : null;
}

// A published (community) pathway's document, appendix removed.
export function libraryDocumentFromPublished(content: string): string {
  return stripProvenanceAppendix(content);
}

type PublishedPathwayRow = {
  slug: string;
  title: string | null;
  description: string | null;
  sector: string | null;
  stage: string | null;
  location: string | null;
  tags: string[] | null;
};

// Format a DB row as a YAML-like frontmatter block that matches the shape
// the static loader emits from .md frontmatter, so the overview blob reads
// uniformly regardless of source.
function formatDbFrontmatter(row: PublishedPathwayRow): string {
  const lines: string[] = [];
  if (row.title) lines.push(`title: ${row.title}`);
  if (row.description) lines.push(`description: ${row.description}`);
  if (row.sector) lines.push(`sector: ${row.sector}`);
  if (row.stage) lines.push(`stage: ${row.stage}`);
  if (row.location) lines.push(`location: ${row.location}`);
  if (row.tags?.length) lines.push(`tags: [${row.tags.join(', ')}]`);
  return lines.join('\n');
}

// Concatenates every library pathway's frontmatter block, prefixed by its id,
// for the general (no-pathway-selected) system prompt — mirrors the original
// Diffusion Library backend's build_library_overview(). Covers exactly what
// the library shows as cards: the static cards (lib/library-pathways.ts)
// plus published_pathways, DB taking precedence by slug. `count` is the number
// of entries, stated in the prompt so the model never has to count the list
// itself (it miscounted: answered 13 for an 11-entry overview).
export async function buildLibraryOverview(): Promise<{ overview: string; count: number }> {
  const dbResult = await createAdminClient()
    .from('published_pathways')
    .select('slug, title, description, sector, stage, location, tags')
    .order('created_at', { ascending: false });

  const dbRows = (dbResult.data ?? []) as PublishedPathwayRow[];
  const dbSlugs = new Set(dbRows.map((r) => r.slug));

  const staticSections = await Promise.all(
    libraryPathways
      .map((p) => p.id)
      .filter((id) => !dbSlugs.has(id))
      .map(async (id) => {
        const text = await readStaticFile(path.join(WIKI_PATH, 'pathways', `${id}.md`));
        if (!text) return null;
        const parts = text.split('---');
        const frontmatter = parts.length >= 3 ? parts[1] : '';
        return `[${id}]\n${frontmatter.trim()}`;
      })
  );

  const dbSections = dbRows.map((row) => `[${row.slug}]\n${formatDbFrontmatter(row)}`);

  const sections = [...dbSections, ...staticSections.filter((s): s is string => s !== null)];
  return { overview: sections.join('\n\n'), count: sections.length };
}
