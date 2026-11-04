// Card-tile types for /explore (the Diffusion Library). The cards themselves
// come from the app's own store — every published pathway, nothing
// hard-coded (docs/features/pathway-storage/; the static list that lived in
// lib/library-pathways.ts is gone).
export type Stage = 'Explore' | 'Define' | 'Pilot' | 'Scale';

export type Accent = 'coral' | 'yellow' | 'blue' | 'navy';

export type LibraryPathway = {
  /** The pathway's slug. */
  id: string;
  title: string;
  location: string;
  category: string;
  stage: Stage;
  accent: Accent;
  /** Short, impact-driven hook shown on the tile — the document's description. */
  hook: string;
  /** Sector this pathway belongs to (Agriculture, Livelihoods, etc.). Absent for cross-cutting pathways. */
  sector?: string;
  /** Horizontal technology / approach tags — no sector values. */
  tags: string[];
};

export const libraryStages: Stage[] = ['Explore', 'Define', 'Pilot', 'Scale'];

// An accent colour derived from the slug, so a card's colour never changes
// between publishes and needs no contributor input.
export function slugToAccent(slug: string): Accent {
  const accents = ['coral', 'yellow', 'blue', 'navy'] as const;
  const hash = slug.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return accents[hash % 4];
}

export function toLibraryStage(stage: string | null | undefined): Stage {
  const s = (stage ?? '').trim().toLowerCase();
  return libraryStages.find((x) => x.toLowerCase() === s) ?? 'Explore';
}
