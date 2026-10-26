import { describe, expect, it } from 'vitest';
import {
  FILE_COLUMN,
  NO_RESOURCES_LINE,
  linkSection4Assets,
  removeSection4Rows,
  sameResourceName,
  section4AssetIds,
  section4Rows,
  type Section4Link,
} from '@/lib/pathway-section4';

const ID_A = 'asset-0a1b2c3d-1111-2222-3333-444455556666';
const ID_B = 'asset-ffffffff-0000-4000-8000-000000000000';

const DOC = `# Pilot pathway

## Section 3 — Micro-innovations
Units here.

---

## Section 4 — Toolkits and Playbooks

| # | Title | Type | Reuse condition |
|---|---|---|---|
| 3 | Vendor evaluation checklist | Toolkit Asset | Any procurement of voice vendors |
| 5 | Go with one vendor | Strategic Decision | Never an asset |
| 7 | Field rollout playbook | Playbook | Districts with ASHA workers |
| 9 | Fixing the ASR drift | Failure and Fix | Not an asset either |

---

## Section 5 — Problem→Solution Patterns
Patterns.

## Source Trace Appendix
| file | covers |
|---|---|
| notes.docx | Section 4 |`;

const fileLink = (over: Partial<Section4Link> = {}): Section4Link => ({
  name: 'Vendor evaluation checklist',
  href: `/api/toolkit-assets/${ID_A}/download`,
  titleHref: `/api/toolkit-assets/${ID_A}/download?preview=1`,
  assetId: ID_A,
  label: 'checklist.xlsx',
  ...over,
});

function section4Table(markdown: string): string[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => /^## Section 4/.test(l));
  const end = lines.findIndex((l, i) => i > start && /^## Section 5/.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end).filter((l) => l.startsWith('|'));
}

describe('sameResourceName', () => {
  it.each([
    ['identical', 'Vendor checklist', 'Vendor checklist'],
    ['case and punctuation differ', 'Vendor-Checklist!', 'vendor checklist'],
    ['every word of one in the other', 'Troubleshooting approach for printer failures', 'Deployment checklist and troubleshooting approach for printer failures'],
    ['plural vs singular', 'Cost models', 'cost model'],
    ['stopwords ignored', 'The checklist of vendors', 'vendor checklist'],
  ])('matches when %s', (_label, a, b) => {
    expect(sameResourceName(a, b)).toBe(true);
    expect(sameResourceName(b, a)).toBe(true);
  });

  it.each([
    ['different artifacts sharing a word', 'Vendor checklist', 'Vendor contract'],
    ['an empty name', '', 'Vendor checklist'],
    ['punctuation only', '!!!', '???'],
    ['stopwords only vs a real name', 'the and of', 'checklist'],
    ['non-latin names (normalised away)', 'किसान', 'किसान'],
  ])('does not match %s', (_label, a, b) => {
    expect(sameResourceName(a, b)).toBe(false);
  });
});

describe('section4Rows', () => {
  it('returns the reusable-asset rows, dropping decisions and fixes', () => {
    expect(section4Rows(DOC)).toEqual([
      { title: 'Vendor evaluation checklist', type: 'Toolkit Asset', reuseCondition: 'Any procurement of voice vendors' },
      { title: 'Field rollout playbook', type: 'Playbook', reuseCondition: 'Districts with ASHA workers' },
    ]);
  });

  it('strips links, asset-id markers and emphasis from cells', () => {
    const md = `## Section 4\n\n| # | Title | Type | Reuse condition |\n|---|---|---|---|\n| 1 | **[Checklist](/x)** <!-- asset-id: ${ID_A} --> | *Toolkit Asset* | \`any\` |`;
    expect(section4Rows(md)).toEqual([{ title: 'Checklist', type: 'Toolkit Asset', reuseCondition: 'any' }]);
  });

  it('accepts heading variants ("# 4. Toolkits", "### Section 4")', () => {
    for (const heading of ['# 4. Toolkits and Playbooks', '### Section 4', '#4 Toolkits']) {
      const md = `${heading}\n| Title | Type |\n|---|---|\n| Kit | Toolkit Asset |`;
      expect(section4Rows(md)).toEqual([{ title: 'Kit', type: 'Toolkit Asset', reuseCondition: '' }]);
    }
  });

  it('copes with a table that has no Type or Reuse column', () => {
    const md = '## Section 4\n| Toolkit |\n|---|\n| Glossary |';
    expect(section4Rows(md)).toEqual([{ title: 'Glossary', type: '', reuseCondition: '' }]);
  });

  it('skips rows with an empty title', () => {
    const md = '## Section 4\n| # | Title | Type |\n|---|---|---|\n| 1 |  | Playbook |\n| 2 | Kit | Playbook |';
    expect(section4Rows(md).map((r) => r.title)).toEqual(['Kit']);
  });

  it.each([
    ['no Section 4', '## Section 3\n| Title |\n|---|\n| Kit |'],
    ['a Section 4 with no table', `## Section 4\n${NO_RESOURCES_LINE}\n## Section 5`],
    ['a table only after Section 4 ends', '## Section 4\nNone.\n## Section 5\n| Title |\n|---|\n| Kit |'],
    ['an empty document', ''],
    ['a header with no separator row', '## Section 4\n| Title |\n| Kit |'],
  ])('returns [] for %s', (_label, md) => {
    expect(section4Rows(md)).toEqual([]);
  });
});

describe('linkSection4Assets', () => {
  it('links the matching row title, adds a File column and drops decision/fix rows', () => {
    const out = linkSection4Assets(DOC, [fileLink()]);
    expect(section4Table(out)).toEqual([
      `| # | Title | Type | Reuse condition | ${FILE_COLUMN} |`,
      '| --- | --- | --- | --- | --- |',
      `| 3 | [Vendor evaluation checklist](/api/toolkit-assets/${ID_A}/download?preview=1) <!-- asset-id: ${ID_A} --> | Toolkit Asset | Any procurement of voice vendors | [checklist.xlsx](/api/toolkit-assets/${ID_A}/download) |`,
      '| 7 | Field rollout playbook | Playbook | Districts with ASHA workers | — |',
    ]);
    // Everything outside Section 4 is untouched.
    expect(out).toContain('## Section 5 — Problem→Solution Patterns\nPatterns.');
    expect(out).toContain('| notes.docx | Section 4 |');
  });

  it('is idempotent: re-running with the same links gives the same document', () => {
    const once = linkSection4Assets(DOC, [fileLink()]);
    expect(linkSection4Assets(once, [fileLink()])).toBe(once);
  });

  it('removes earlier links, markers and the File column when no asset is shared any more', () => {
    const linked = linkSection4Assets(DOC, [fileLink()]);
    const unlinked = linkSection4Assets(linked, []);
    expect(section4Table(unlinked)).toEqual([
      '| # | Title | Type | Reuse condition |',
      '| --- | --- | --- | --- |',
      '| 3 | Vendor evaluation checklist | Toolkit Asset | Any procurement of voice vendors |',
      '| 7 | Field rollout playbook | Playbook | Districts with ASHA workers |',
    ]);
    expect(unlinked).not.toContain('asset-id');
  });

  it('strips links and markers the model wrote itself', () => {
    const md = DOC.replace(
      '| 7 | Field rollout playbook |',
      `| 7 | [Field rollout playbook](https://evil.example) <!-- asset-id: ${ID_B} --> |`
    );
    const out = linkSection4Assets(md, []);
    expect(out).not.toContain('evil.example');
    expect(out).not.toContain(ID_B);
    expect(out).toContain('| 7 | Field rollout playbook | Playbook |');
  });

  it('gives an asset no row names a row of its own, then drops it once it is unshared', () => {
    const extra = fileLink({ name: 'Cost model', assetId: ID_B, href: '/dl/b', titleHref: undefined, label: 'cost.xlsx', reuseCondition: 'Any state | budget' });
    const out = linkSection4Assets(DOC, [extra]);
    expect(section4Table(out)).toContain(
      `| — | [Cost model](/dl/b) <!-- asset-id: ${ID_B} --> | Toolkit Asset | Any state / budget | [cost.xlsx](/dl/b) |`
    );
    const after = linkSection4Assets(out, []);
    expect(after).not.toContain('Cost model');
  });

  it('defaults a missing reuse condition and File label', () => {
    const out = linkSection4Assets(DOC, [{ name: 'Glossary', href: 'https://example.org/g' }]);
    expect(out).toContain('| — | [Glossary](https://example.org/g) | Toolkit Asset | Not documented in the source | [Download](https://example.org/g) |');
  });

  it('keeps table cells safe: pipes and brackets in a label cannot break the row', () => {
    const out = linkSection4Assets(DOC, [fileLink({ label: 'a|b [c]' })]);
    expect(out).toContain('[a/b c](/api/toolkit-assets/');
  });

  it('each asset links at most one row', () => {
    const md = DOC.replace('| 7 | Field rollout playbook |', '| 7 | Vendor evaluation checklist |');
    const out = linkSection4Assets(md, [fileLink()]);
    expect(out.match(/asset-id/g)).toHaveLength(1);
  });

  it('replaces a "no resources" line with a table, keeping the heading', () => {
    const md = `## Section 4 — Toolkits\n\n${NO_RESOURCES_LINE}\n\n---\n\n## Section 5\nP`;
    const out = linkSection4Assets(md, [fileLink()]);
    expect(out).toContain('## Section 4 — Toolkits\n\n| # | Title | Type | Reuse condition | File |');
    expect(out).not.toContain(NO_RESOURCES_LINE);
    expect(out).toContain('---\n\n## Section 5\nP');
  });

  it('turns a table emptied of assets into the "no resources" line', () => {
    const md = '## Section 4\n| # | Title | Type |\n|---|---|---|\n| 1 | Pick a vendor | Strategic Decision |\n## Section 5';
    expect(linkSection4Assets(md, [])).toBe(`## Section 4\n${NO_RESOURCES_LINE}\n## Section 5`);
  });

  it('adds a Section 4 before Section 5 when the document has none and an asset is shared', () => {
    const md = '## Section 3\nUnits\n\n---\n\n## Section 5 — Patterns\nP';
    const out = linkSection4Assets(md, [fileLink()]);
    expect(out.indexOf('## Section 4 — Toolkits and playbooks')).toBeGreaterThan(out.indexOf('Units'));
    expect(out.indexOf('## Section 4 — Toolkits and playbooks')).toBeLessThan(out.indexOf('---'));
    expect(out).toContain(`<!-- asset-id: ${ID_A} -->`);
  });

  it('adds a Section 4 before the Source Trace appendix when nothing else follows', () => {
    const md = '## Section 3\nUnits\n\n## Source Trace Appendix\n| f |';
    const out = linkSection4Assets(md, [fileLink()]);
    expect(out.indexOf('## Section 4')).toBeLessThan(out.indexOf('## Source Trace'));
  });

  it('appends a Section 4 at the end when nothing follows Section 3', () => {
    const out = linkSection4Assets('## Section 3\nUnits\n\n\n', [fileLink()]);
    expect(out.startsWith('## Section 3\nUnits\n\n## Section 4 — Toolkits and playbooks\n\n| # |')).toBe(true);
    expect(out.endsWith('|\n')).toBe(true);
  });

  it('leaves a document with no Section 4 alone when nothing is shared', () => {
    const md = '## Section 3\nUnits';
    expect(linkSection4Assets(md, [])).toBe(md);
  });

  // A contributor's https link may contain ")" (e.g. Wikipedia URLs). The
  // link-stripping regex stops at the first ")", so every re-assemble leaves
  // a stray ")" glued to the title, and it grows by one each time.
  it.fails('BUG: a link asset whose URL contains ")" is not idempotent — the title gains a ")" on every re-link', () => {
    const link = { name: 'Vendor evaluation checklist', href: 'https://en.wikipedia.org/wiki/Checklist_(tool)' };
    const once = linkSection4Assets(DOC, [link]);
    const twice = linkSection4Assets(once, [link]);
    expect(twice).toBe(once);
  });
});

describe('removeSection4Rows', () => {
  it('drops the named row and keeps the rest exactly as written', () => {
    const out = removeSection4Rows(DOC, ['Vendor evaluation checklist']);
    expect(out).not.toContain('Vendor evaluation checklist');
    expect(out).toContain('| 5 | Go with one vendor | Strategic Decision | Never an asset |');
    expect(out).toContain('| 7 | Field rollout playbook |');
  });

  it('falls back to a fuzzy name match', () => {
    expect(removeSection4Rows(DOC, ['field rollout playbooks'])).not.toContain('Field rollout playbook');
  });

  it('matches a linked title by its text', () => {
    const linked = linkSection4Assets(DOC, [fileLink()]);
    expect(removeSection4Rows(linked, ['Vendor evaluation checklist'])).not.toContain(ID_A);
  });

  it('removes one row per name even when two rows share a title', () => {
    const md = '## Section 4\n| # | Title |\n|---|---|\n| 1 | Kit |\n| 2 | Kit |';
    expect(removeSection4Rows(md, ['Kit'])).toBe('## Section 4\n| # | Title |\n|---|---|\n| 2 | Kit |');
    expect(removeSection4Rows(md, ['Kit', 'Kit'])).toBe(`## Section 4\n${NO_RESOURCES_LINE}`);
  });

  it('returns the document unchanged when nothing matches, no names are given, or there is no table', () => {
    expect(removeSection4Rows(DOC, ['Something else entirely'])).toBe(DOC);
    expect(removeSection4Rows(DOC, [])).toBe(DOC);
    expect(removeSection4Rows('## Section 3\nx', ['Kit'])).toBe('## Section 3\nx');
  });
});

describe('section4AssetIds', () => {
  it('returns the ids carried by Section 4 linked titles', () => {
    const linked = linkSection4Assets(DOC, [fileLink(), fileLink({ name: 'Field rollout playbook', assetId: ID_B, href: '/b' })]);
    expect(section4AssetIds(linked)).toEqual([ID_A, ID_B]);
  });

  it('ignores markers outside Section 4', () => {
    const md = `## Section 3\n<!-- asset-id: ${ID_A} -->\n## Section 4\nNone\n## Section 5\n<!-- asset-id: ${ID_B} -->`;
    expect(section4AssetIds(md)).toEqual([]);
  });

  it.each([
    ['uppercase hex', `<!-- asset-id: ${ID_A.toUpperCase()} -->`],
    ['a short id', '<!-- asset-id: asset-123 -->'],
    ['a path-traversal id', '<!-- asset-id: ../../../../etc/passwd -->'],
  ])('ignores a malformed marker (%s)', (_label, marker) => {
    expect(section4AssetIds(`## Section 4\n| T |\n|---|\n| x ${marker} |`)).toEqual([]);
  });

  it('returns [] with no Section 4', () => {
    expect(section4AssetIds(`<!-- asset-id: ${ID_A} -->`)).toEqual([]);
  });
});
