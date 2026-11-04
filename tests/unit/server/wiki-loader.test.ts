import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  datedLine,
  loadFrameworkContent,
  loadPathwayGenerationPrompt,
  loadResourcesContent,
} from '@/lib/wiki-loader';

// lib/wiki-loader.ts now loads only the app's own shipped content. Pathways
// live in the database (docs/features/pathway-storage/) and are covered by
// tests/unit/server/pathway-store.test.ts.

describe('static content loaders', () => {
  it('loadFrameworkContent returns content/framework.md', async () => {
    const text = await loadFrameworkContent();
    expect(text).toBe(readFileSync(path.join(process.cwd(), 'content', 'framework.md'), 'utf-8'));
    expect(text.length).toBeGreaterThan(100);
  });

  it('loadPathwayGenerationPrompt returns content/pathway-generation-prompt.md', async () => {
    expect(await loadPathwayGenerationPrompt()).toBe(
      readFileSync(path.join(process.cwd(), 'content', 'pathway-generation-prompt.md'), 'utf-8')
    );
  });

  it('loadResourcesContent returns content/resources.md', async () => {
    expect(await loadResourcesContent()).toBe(readFileSync(path.join(process.cwd(), 'content', 'resources.md'), 'utf-8'));
  });
});

describe('datedLine', () => {
  it('uses the document’s own timestamp frontmatter', () => {
    expect(datedLine('---\ntitle: X\ntimestamp: 2026-08-31\n---\nBody', '2026-10-01T10:00:00Z')).toBe(
      'Documented as of: 2026-08-31\n\n'
    );
  });

  it('falls back to the first-published date (date part only)', () => {
    expect(datedLine('---\ntitle: X\n---\nBody', '2026-10-01T10:00:00Z')).toBe('First published: 2026-10-01\n\n');
  });

  it('is empty with neither', () => {
    expect(datedLine('Body')).toBe('');
    expect(datedLine('Body', null)).toBe('');
    expect(datedLine('Body', '')).toBe('');
  });

  it('only matches timestamp at the start of a line', () => {
    expect(datedLine('the timestamp: 2020 is inline')).toBe('');
  });
});
