import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STAGES } from '@/lib/dimensions';
import { isValidSlug } from '@/lib/slug';
import { libraryPathways, librarySectors, libraryStages, libraryTags } from '@/lib/library-pathways';

const PATHWAYS_DIR = path.resolve(__dirname, '../../../content/wiki/pathways');

describe('libraryPathways', () => {
  it('is non-empty with unique ids', () => {
    expect(libraryPathways.length).toBeGreaterThan(0);
    const ids = libraryPathways.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(libraryPathways.map((p) => [p.id, p] as const))('%s: id is a valid slug with a corpus document', (id) => {
    expect(isValidSlug(id)).toBe(true);
    expect(existsSync(path.join(PATHWAYS_DIR, `${id}.md`))).toBe(true);
  });

  it.each(libraryPathways.map((p) => [p.id, p] as const))('%s: card fields are filled and valid', (_id, p) => {
    expect(STAGES).toContain(p.stage);
    expect(['coral', 'yellow', 'blue', 'navy']).toContain(p.accent);
    for (const field of [p.title, p.location, p.category, p.hook]) expect(field.trim()).not.toBe('');
    expect(p.tags.length).toBeGreaterThan(0);
    if (p.sector !== undefined) expect(p.sector.trim()).not.toBe('');
  });

  it('tags carry no sector values', () => {
    for (const p of libraryPathways) if (p.sector) expect(p.tags).not.toContain(p.sector);
  });

  // The african-voice-ai hook is written as "\tAdapting ...": a stray tab
  // character copied into the card text.
  it.fails('BUG: no hook has stray leading/trailing whitespace', () => {
    for (const p of libraryPathways) expect(p.hook).toBe(p.hook.trim());
  });
});

describe('derived filters', () => {
  it('stages are the framework stages in order', () => {
    expect(libraryStages).toEqual([...STAGES]);
  });

  it('sectors are unique, present on some pathway, and skip cross-cutting ones', () => {
    expect(new Set(librarySectors).size).toBe(librarySectors.length);
    expect(librarySectors).not.toContain(undefined);
    for (const s of librarySectors) expect(libraryPathways.some((p) => p.sector === s)).toBe(true);
    const withSector = new Set(libraryPathways.map((p) => p.sector).filter(Boolean));
    expect(librarySectors).toHaveLength(withSector.size);
  });

  it('tags are unique, sorted and cover every pathway tag', () => {
    expect(new Set(libraryTags).size).toBe(libraryTags.length);
    expect(libraryTags).toEqual([...libraryTags].sort());
    for (const p of libraryPathways) for (const t of p.tags) expect(libraryTags).toContain(t);
  });
});
