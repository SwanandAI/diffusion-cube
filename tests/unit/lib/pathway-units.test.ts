import { describe, expect, it } from 'vitest';
import { parseUnits, unitId } from '@/lib/pathway-units';
import { stripProvenanceAppendix } from '@/lib/provenance';

const DOC = `---
title: Test Path
---

# Test Path

## Section 1 — Pathway identity

Body.

## Section 3 — Micro-innovations

### Institution

**1. Sign a data-sharing MoU before the pilot**

- **Dimension:** Institution
- **Sub-category:** A. Mandate, Ownership, and Decision Rights
- **Stage:** Pilot
- **Also relevant at:** Scale, Define
- **Type:** Strategic Decision
- **Decision:** Get a memorandum signed first.
- **Condition — applies when:** A government department owns the data.
- **Condition — fails when:** The department has no legal mandate to share.

---

**2. Three-vendor telephony**

- Dimension: Solution
- Sub-category: UX, Channel, and Integration
- Stage: scale
- Type: tactical decision
- Decision: Split calls across vendors.
- Condition - applies when: Call volume is high.
- Condition - fails when: Not documented in the source

### Persona

**12. Literacy was not the barrier**

- **Dimension:** persona
- **Sub-category:** persona-B
- **Stage:** Explore
- **Type:** Failure & Fix
- **Failure:** Predicted literacy.
- **Condition — applies when:** Shared phones.

## Section 4 — Toolkits and playbooks

No reusable resources documented.

## Section 6 — Retrieval guide

*"How do we get departments to share data?"* → Unit 1

*"Which vendors?"* → Unit 2, Unit 12

*"Anything at scale?"* → Units 1–2

---

*Source Trace appendix — contributor-facing only, not surfaced in adopter responses*

| Source file | Covers | Notes |
|---|---|---|
| src-01 · mou.pdf | Section 1; Unit 1 | Primary |
| src-02 · vendors.docx | Units 2, 12 | Primary |
| notes.md | Units 1–2 | Confirms |
`;

describe('unitId', () => {
  it('zero-pads the unit number', () => {
    expect(unitId('maha', 3)).toBe('maha-u03');
    expect(unitId('maha', 12)).toBe('maha-u12');
  });
});

describe('parseUnits', () => {
  const { units, skipped } = parseUnits(DOC, 'test-path');

  it('parses every valid unit with its labels', () => {
    expect(skipped).toEqual([]);
    expect(units.map((u) => u.id)).toEqual(['test-path-u01', 'test-path-u02', 'test-path-u12']);
    expect(units[0]).toMatchObject({
      unit_number: 1,
      title: 'Sign a data-sharing MoU before the pilot',
      unit_type: 'Strategic Decision',
      dimension: 'institution',
      sub_category: 'institution-A',
      stage: 'Pilot',
      also_relevant_at: ['Scale', 'Define'],
      applies_when: 'A government department owns the data.',
      fails_when: 'The department has no legal mandate to share.',
    });
  });

  it('reads plain (unbolded) bullets, any case, a hyphen dash and a sub-category given by name', () => {
    expect(units[1]).toMatchObject({
      dimension: 'solution',
      sub_category: 'solution-B',
      stage: 'Scale',
      unit_type: 'Tactical Decision',
      applies_when: 'Call volume is high.',
      fails_when: 'Not documented in the source',
    });
  });

  it('reads "dimension-letter" sub-categories and "&" in the type', () => {
    expect(units[2]).toMatchObject({ dimension: 'persona', sub_category: 'persona-B', unit_type: 'Failure and Fix', fails_when: '' });
  });

  it('takes adopter intents from Section 6, ranges included', () => {
    expect(units[0].adopter_intents).toEqual(['How do we get departments to share data?', 'Anything at scale?']);
    expect(units[1].adopter_intents).toEqual(['Which vendors?', 'Anything at scale?']);
    expect(units[2].adopter_intents).toEqual(['Which vendors?']);
  });

  it('takes source ids from the Source Trace: src-NN keys, else the file name', () => {
    expect(units[0].source_ids).toEqual(['src-01', 'notes.md']);
    expect(units[2].source_ids).toEqual(['src-02']);
  });

  it("keeps the unit's own markdown as its body, and never the Source Trace", () => {
    expect(units[0].body.startsWith('**1. Sign a data-sharing MoU before the pilot**')).toBe(true);
    expect(units[0].body).toContain('Get a memorandum signed first.');
    expect(units[0].body).not.toContain('**2.');
    for (const u of units) expect(u.body).not.toMatch(/source trace|mou\.pdf/i);
  });

  it('never lists the unit\'s own stage under also_relevant_at', () => {
    const doc = DOC.replace('- **Also relevant at:** Scale, Define', '- **Also relevant at:** Pilot, Scale');
    expect(parseUnits(doc, 'p').units[0].also_relevant_at).toEqual(['Scale']);
  });
});

describe('parseUnits — skipped units', () => {
  it('skips a unit with an unknown or mismatched label and keeps the rest', () => {
    const doc = DOC
      .replace('- **Dimension:** Institution', '- **Dimension:** Governance')
      .replace('- Sub-category: UX, Channel, and Integration', '- Sub-category: A. Problem and Persona')
      .replace('- **Type:** Failure & Fix', '- **Type:** Lesson');
    const { units, skipped } = parseUnits(doc, 'p');
    expect(units).toEqual([]);
    expect(skipped).toEqual([
      { unit: 1, title: 'Sign a data-sharing MoU before the pilot', reason: 'unknown dimension "Governance"' },
      { unit: 2, title: 'Three-vendor telephony', reason: 'unknown sub-category "A. Problem and Persona" for solution' },
      { unit: 12, title: 'Literacy was not the barrier', reason: 'unknown type "Lesson"' },
    ]);
  });

  it('skips every unit of a document written before sub-categories (legacy format)', () => {
    const legacy = DOC.replace(/^.*Sub-category.*\n/gm, '');
    const { units, skipped } = parseUnits(legacy, 'p');
    expect(units).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(['missing sub-category', 'missing sub-category', 'missing sub-category']);
  });

  it('skips a unit with no stage', () => {
    const { skipped } = parseUnits(DOC.replace('- **Stage:** Explore\n', ''), 'p');
    expect(skipped).toEqual([{ unit: 12, title: 'Literacy was not the barrier', reason: 'missing stage' }]);
  });

  it('returns nothing for a document without Section 3', () => {
    expect(parseUnits('# Doc\n\n## Section 1\n\nBody', 'p')).toEqual({ units: [], skipped: [] });
  });
});

describe('stripProvenanceAppendix (lib/provenance)', () => {
  it('also cuts at a standalone emphasised "Source Trace" line, and the rules before it', () => {
    const out = stripProvenanceAppendix(DOC);
    expect(out).not.toMatch(/source trace|mou\.pdf/i);
    expect(out.endsWith('*"Anything at scale?"* → Units 1–2')).toBe(true);
  });

  it('does not cut at a sentence that merely mentions the words', () => {
    const doc = 'Body.\n\nWe kept a *source trace* of every claim.';
    expect(stripProvenanceAppendix(doc)).toBe(doc);
  });
});
