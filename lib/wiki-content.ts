import { stripFrontmatter } from '@/lib/strip-frontmatter';
import { isValidSlug } from '@/lib/slug';
import { stripProvenanceAppendix } from '@/lib/provenance';
import { getPublishedDocument, listPublished } from '@/lib/pathway-store';

// The /wiki browsing pages and the library stats, over the published
// pathways in the app's store. Source Trace is always stripped: it is
// contributor-only.

export interface WikiPathwaySummary {
  slug: string;
  title: string;
  description: string;
  category: string;
  // The pathway's sector (e.g. Agriculture, Livelihoods), from its
  // document's frontmatter at publish — distinct from `category`, which is
  // derived from its first tags. "Cross-Sector" marks a deliberately
  // horizontal pathway rather than a real sector — callers that want an
  // actual sector list filter it out, same as an undefined sector.
  sector?: string;
  stage?: string;
  timestamp?: string;
  contributor?: string;
}

// Every published pathway, for browsing (/wiki) and the stats line — read
// from the app's store (lib/pathway-store.ts), the one place pathways live
// since docs/features/pathway-storage/. Nothing is read from disk.
export async function listWikiPathways(): Promise<WikiPathwaySummary[]> {
  return (await listPublished()).map((p) => ({
    slug: p.slug,
    title: p.title,
    description: p.description,
    category: p.category,
    sector: p.sector || undefined,
    stage: p.stage || undefined,
    timestamp: p.created_at,
    contributor: p.contributor_org ?? undefined,
  }));
}

export interface WikiStats {
  total: number;
  // Unique real sectors across the merged static + published corpus (see
  // WikiPathwaySummary.sector) — excludes "Cross-Sector" and any pathway with
  // no sector tagged (all community-published ones, for now), since neither
  // is an actual sector to name in browse-intent copy.
  sectors: string[];
}

// Powers the "Explore the Pathways Library" intent's opening line (see
// app/api/wiki-stats/route.ts) — how many pathways exist right now and which
// sectors they span, so that line stays accurate as the corpus grows via
// community publishing instead of being frozen in a prompt file.
export async function getWikiStats(): Promise<WikiStats> {
  const pathways = await listWikiPathways();
  const sectors = Array.from(new Set(pathways.map((p) => p.sector).filter((s): s is string => Boolean(s) && s !== 'Cross-Sector')));
  return { total: pathways.length, sectors };
}

// The Source Trace appendix is contributor-only — never surfaced to adopters
// in any mode, including this browsing page. Lives in lib/provenance.ts (pure,
// usable outside a request); re-exported here for existing callers.
export { stripProvenanceAppendix } from '@/lib/provenance';

export interface WikiPathwayContent {
  title: string;
  content: string;
}

export async function getWikiPathway(slug: string): Promise<WikiPathwayContent | null> {
  if (!isValidSlug(slug)) return null;
  // Published only: a draft, a pathway waiting for review or a retired one
  // is not public.
  const doc = await getPublishedDocument(slug);
  if (!doc) return null;
  return { title: doc.title, content: stripProvenanceAppendix(stripFrontmatter(doc.content)) };
}
