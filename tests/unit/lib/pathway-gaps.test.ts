import { describe, expect, it } from 'vitest';
import { extractGapsFromPathwayDraft } from '@/lib/pathway-gaps';

function draft(section2Body: string, after = '# 3. Micro-Innovations\n- not a gap'): string {
  return `# 0. Reading Guide\nIntro\n\n# 1. Pathway Identity\n- Sector: Health\n\n# 2. Coverage Grid and Gaps\n\n${section2Body}\n\n${after}`;
}

describe('extractGapsFromPathwayDraft', () => {
  it('returns the Gaps bullets of Section 2, stopping at the next # heading', () => {
    const md = draft('| grid |\n\n**Gaps**\n- Who funds year two?\n- How is consent recorded? *(Institution/Pilot)*');
    expect(extractGapsFromPathwayDraft(md)).toEqual(['Who funds year two?', 'How is consent recorded? *(Institution/Pilot)*']);
  });

  it('accepts heading variants: no space after #, trailing text', () => {
    expect(extractGapsFromPathwayDraft('#2. Coverage Grid and Gaps (as of 2026)\n**Gaps**\n- A')).toEqual(['A']);
  });

  it('reads to the end of the document when Section 2 is last', () => {
    expect(extractGapsFromPathwayDraft('# 2. Coverage Grid and Gaps\n**Gaps**\n- Last one')).toEqual(['Last one']);
  });

  it('keeps reading through ## sub-headings (only a top-level # ends the section)', () => {
    const md = draft('**Gaps**\n- One\n## Sub\n- Two');
    expect(extractGapsFromPathwayDraft(md)).toEqual(['One', 'Two']);
  });

  it('skips non-bullet lines and empty bullets, and trims', () => {
    const md = draft('**Gaps**\n*Surfaced as open questions.*\n   -   Indented gap   \n-\n- \nplain text\n- Another');
    expect(extractGapsFromPathwayDraft(md)).toEqual(['Indented gap', 'Another']);
  });

  it('keeps unicode gap text', () => {
    expect(extractGapsFromPathwayDraft(draft('**Gaps**\n- किसान डेटा का मालिक कौन है?'))).toEqual(['किसान डेटा का मालिक कौन है?']);
  });

  it.each([
    ['no Section 2 heading', '# 0. Reading Guide\n**Gaps**\n- not here'],
    ['a Section 2 without a **Gaps** label', draft('- a bullet that is not a gap')],
    ['an empty document', ''],
    ['a **Gaps** label with no bullets', draft('**Gaps**\nNone documented.')],
    ['**Gaps** only in a later section', draft('grid', '# 3. Micro-Innovations\n**Gaps**\n- wrong section')],
    ['a heading that is not Section 2', '# 3. Coverage Grid and Gaps\n**Gaps**\n- x'],
  ])('returns [] for %s', (_label, md) => {
    expect(extractGapsFromPathwayDraft(md)).toEqual([]);
  });

  it('ignores numbered lists (only "-" bullets are gaps)', () => {
    expect(extractGapsFromPathwayDraft(draft('**Gaps**\n1. Numbered\n2. Also numbered'))).toEqual([]);
  });

  // Pathway documents separate sections with a "---" rule just above the next
  // heading (see content/wiki/pathways/*.md and backOverRule in
  // lib/pathway-section4.ts). The line starts with "-", so it is read as a
  // bullet and "--" is quoted to the contributor as one of the gaps.
  it.fails('BUG: a "---" horizontal rule before the next section is returned as a gap', () => {
    const md = draft('**Gaps**\n- Real gap\n\n---');
    expect(extractGapsFromPathwayDraft(md)).toEqual(['Real gap']);
  });
});
