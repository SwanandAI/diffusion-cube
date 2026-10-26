import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_DOC_MARKER,
  ASSET_SHARE_MARKER,
  EXEC_SUMMARY_MARKER,
  PATHWAY_DOC_MARKER,
  PUBLISH_CONSENT_MARKER,
  RESOURCE_REVIEW_MARKER,
  TOOLKIT_ASSET_CONSENT_MARKER,
  parseGridUpdate,
  stripGridUpdate,
} from '@/lib/grid-update';

const ID_A = 'asset-0a1b2c3d-1111-2222-3333-444455556666';
const ID_B = 'asset-ffffffff-0000-4000-8000-000000000000';

// Wraps a JSON value the way the model ends a reply.
function block(json: unknown, prose = 'Some reply.'): string {
  return `${prose}\n\n<grid_update>\n${JSON.stringify(json)}\n</grid_update>`;
}

describe('card markers', () => {
  it('are distinct self-closing tags', () => {
    const markers = [
      PATHWAY_DOC_MARKER,
      ANALYSIS_DOC_MARKER,
      EXEC_SUMMARY_MARKER,
      TOOLKIT_ASSET_CONSENT_MARKER,
      RESOURCE_REVIEW_MARKER,
      ASSET_SHARE_MARKER,
      PUBLISH_CONSENT_MARKER,
    ];
    expect(new Set(markers).size).toBe(markers.length);
    for (const m of markers) expect(m).toMatch(/^<[a-z_]+\/>$/);
  });

  it('are never mistaken for a grid_update block', () => {
    expect(parseGridUpdate(`${PATHWAY_DOC_MARKER} hello`)).toBeNull();
    expect(stripGridUpdate(`${ANALYSIS_DOC_MARKER} hi`)).toBe(`${ANALYSIS_DOC_MARKER} hi`);
  });
});

describe('parseGridUpdate', () => {
  it('parses a full explorer block', () => {
    const parsed = parseGridUpdate(
      block({
        cells: { 'persona:Explore': { density: 2, note: 'Cotton farmers in Punjab' } },
        meta: { name: 'Farm voice', sector: 'Agriculture', intent: 'analyse', cubeAssessment: { currentStage: 'Pilot' } },
        pathwaysReferenced: ['mahavistaar'],
        flowStep: 3,
        explorerAction: { type: 'analysis' },
      })
    );
    expect(parsed).toEqual({
      cells: { 'persona:Explore': { density: 2, note: 'Cotton farmers in Punjab' } },
      meta: { name: 'Farm voice', sector: 'Agriculture', intent: 'analyse', cubeAssessment: { currentStage: 'Pilot' } },
      pathwaysReferenced: ['mahavistaar'],
      flowStep: 3,
      pathwayAction: undefined,
      explorerAction: { type: 'analysis' },
      toolkitAssetCandidates: undefined,
      toolkitAssetMentions: undefined,
      toolkitAssetsReferenced: undefined,
    });
  });

  it('parses a contributor pathwayAction', () => {
    const parsed = parseGridUpdate(block({ cells: {}, pathwayAction: { type: 'revise', instruction: 'Fix the stage' } }));
    expect(parsed?.pathwayAction).toEqual({ type: 'revise', instruction: 'Fix the stage' });
  });

  it('defaults cells to {} when missing or null', () => {
    expect(parseGridUpdate(block({ meta: {} }))?.cells).toEqual({});
    expect(parseGridUpdate(block({ cells: null }))?.cells).toEqual({});
  });

  it('accepts a block with no prose around it and surrounding whitespace in the JSON', () => {
    expect(parseGridUpdate('<grid_update>   {"cells":{}}   </grid_update>')).toMatchObject({ cells: {} });
  });

  it.each([
    ['no block at all', 'Just prose, no JSON.'],
    ['empty string', ''],
    ['unclosed block (still streaming)', 'Reply\n<grid_update>\n{"cells": {}'],
    ['malformed JSON', '<grid_update>{cells: {}}</grid_update>'],
    ['JSON with the prompt-template // comments left in', '<grid_update>{"cells": {} // note\n}</grid_update>'],
    ['literal null', '<grid_update>null</grid_update>'],
    ['empty block', '<grid_update></grid_update>'],
    ['wrong tag case', '<GRID_UPDATE>{"cells":{}}</GRID_UPDATE>'],
  ])('returns null for %s', (_label, text) => {
    expect(parseGridUpdate(text)).toBeNull();
  });

  it('only reads the first block when the reply carries two', () => {
    const text = `${block({ cells: {}, flowStep: 1 })}\n${block({ cells: {}, flowStep: 4 })}`;
    expect(parseGridUpdate(text)?.flowStep).toBe(1);
  });

  it.each([
    ['a string', '3'],
    ['null', null],
    ['an object', { step: 3 }],
  ])('drops a non-numeric flowStep (%s)', (_label, flowStep) => {
    expect(parseGridUpdate(block({ cells: {}, flowStep }))?.flowStep).toBeUndefined();
  });

  it('keeps a numeric flowStep of 0', () => {
    expect(parseGridUpdate(block({ cells: {}, flowStep: 0 }))?.flowStep).toBe(0);
  });

  describe('toolkitAssetsReferenced', () => {
    it('keeps only well-formed asset ids, de-duplicated', () => {
      const parsed = parseGridUpdate(
        block({ cells: {}, toolkitAssetsReferenced: [ID_A, ID_A, 'asset-nope', 42, null, ID_B, ID_A.toUpperCase()] })
      );
      expect(parsed?.toolkitAssetsReferenced).toEqual([ID_A, ID_B]);
    });

    it('is undefined when not an array, [] for an empty array', () => {
      expect(parseGridUpdate(block({ cells: {}, toolkitAssetsReferenced: ID_A }))?.toolkitAssetsReferenced).toBeUndefined();
      expect(parseGridUpdate(block({ cells: {}, toolkitAssetsReferenced: [] }))?.toolkitAssetsReferenced).toEqual([]);
    });

    it('rejects a path-traversal or URL dressed as an id', () => {
      const parsed = parseGridUpdate(
        block({ cells: {}, toolkitAssetsReferenced: ['../../etc/passwd', 'https://evil.example/asset-1', `${ID_A}/../x`] })
      );
      expect(parsed?.toolkitAssetsReferenced).toEqual([]);
    });
  });

  describe('toolkitAssetCandidates', () => {
    const candidates = (list: unknown) => parseGridUpdate(block({ cells: {}, toolkitAssetCandidates: list }))?.toolkitAssetCandidates;

    it('parses the documented shape and normalises fields', () => {
      expect(
        candidates([
          {
            source: { fileName: ' checklist.xlsx ' },
            name: ' Vendor checklist ',
            purpose: 'Pick vendors',
            reuseCondition: 'Any procurement',
            dimension: 'Solution',
            stage: 'PILOT',
            sensitiveNote: '',
          },
        ])
      ).toEqual([
        {
          source: { fileName: 'checklist.xlsx' },
          name: 'Vendor checklist',
          purpose: 'Pick vendors',
          reuseCondition: 'Any procurement',
          dimension: 'solution',
          stage: 'pilot',
          sensitiveNote: '',
        },
      ]);
    });

    it('accepts an https URL source', () => {
      expect(candidates([{ source: { url: 'https://github.com/org/repo' }, name: 'Repo' }])?.[0].source).toEqual({
        url: 'https://github.com/org/repo',
      });
    });

    it.each([
      ['bare string url as source', { source: 'https://x.org/t.pdf', name: 'T' }, { url: 'https://x.org/t.pdf' }],
      ['bare string file name as source', { source: 'plan.docx', name: 'T' }, { fileName: 'plan.docx' }],
      ['url at the top level', { url: 'https://x.org/a', name: 'T' }, { url: 'https://x.org/a' }],
      ['fileName at the top level', { fileName: 'a.csv', name: 'T' }, { fileName: 'a.csv' }],
      ['lowercase filename key', { filename: 'a.csv', name: 'T' }, { fileName: 'a.csv' }],
      ['link/href aliases in source', { source: { href: 'https://x.org/h' }, name: 'T' }, { url: 'https://x.org/h' }],
      ['file alias in source', { source: { file: 'f.pdf' }, name: 'T' }, { fileName: 'f.pdf' }],
    ])('is lenient about shape: %s', (_label, entry, source) => {
      expect(candidates([entry])?.[0].source).toEqual(source);
    });

    it.each([
      ['a trailing quote', 'https://x.org/a"', 'https://x.org/a'],
      ['a trailing period', 'https://x.org/a.', 'https://x.org/a'],
      ['a trailing bracket and comma', 'https://x.org/a],', 'https://x.org/a'],
      ['a trailing backtick', 'https://x.org/a`', 'https://x.org/a'],
    ])('strips %s from a URL', (_label, url, expected) => {
      expect(candidates([{ source: { url }, name: 'T' }])?.[0].source).toEqual({ url: expected });
    });

    it('prefers the file name when an entry carries both a file and a url', () => {
      expect(candidates([{ source: { fileName: 'a.pdf', url: 'https://x.org' }, name: 'T' }])?.[0].source).toEqual({
        fileName: 'a.pdf',
      });
    });

    it.each([
      ['no name', { source: { fileName: 'a.pdf' } }],
      ['blank name', { source: { fileName: 'a.pdf' }, name: '   ' }],
      ['no source at all', { name: 'T' }],
      ['an http (not https) link', { source: { url: 'http://x.org/a' }, name: 'T' }],
      ['a javascript: link', { source: { url: 'javascript:alert(1)' }, name: 'T' }],
      ['a url with a space', { source: { url: 'https://x.org/a b' }, name: 'T' }],
      ['a bare-string http source', { source: 'http://x.org/a', name: 'T' }],
      ['a non-string name', { source: { fileName: 'a.pdf' }, name: 42 }],
    ])('drops an entry with %s', (_label, entry) => {
      expect(candidates([entry])).toEqual([]);
    });

    it('skips non-object entries but keeps the valid ones', () => {
      expect(candidates([null, 'str', 5, [], { source: { fileName: 'ok.pdf' }, name: 'Ok' }])).toHaveLength(1);
    });

    it('caps sensitiveNote at 500 characters and accepts the sensitiveData alias', () => {
      const [c] = candidates([{ source: { fileName: 'a.pdf' }, name: 'T', sensitiveData: 'x'.repeat(600) }])!;
      expect(c.sensitiveNote).toHaveLength(500);
    });

    it('fills missing optional fields with empty strings', () => {
      expect(candidates([{ source: { fileName: 'a.pdf' }, name: 'T' }])?.[0]).toEqual({
        source: { fileName: 'a.pdf' },
        name: 'T',
        purpose: '',
        reuseCondition: '',
        dimension: '',
        stage: '',
        sensitiveNote: '',
      });
    });

    it('is undefined when not an array', () => {
      expect(candidates({ source: { fileName: 'a.pdf' }, name: 'T' })).toBeUndefined();
    });

    // A Wikipedia-style URL legitimately ends in ")". The trailing-punctuation
    // cleanup strips it, so the stored link 404s. A balanced-paren check (as
    // autolinkers do) would keep it.
    it.fails('BUG: strips the closing paren of a URL with balanced parentheses', () => {
      const url = 'https://en.wikipedia.org/wiki/Mercury_(planet)';
      expect(candidates([{ source: { url }, name: 'T' }])?.[0].source).toEqual({ url });
    });
  });

  describe('toolkitAssetMentions', () => {
    const mentions = (list: unknown) => parseGridUpdate(block({ cells: {}, toolkitAssetMentions: list }))?.toolkitAssetMentions;

    it('takes bare strings as names and objects with mentionedIn', () => {
      expect(mentions(['  Vendor checklist ', { name: 'Cost model', mentionedIn: 'report.pdf' }])).toEqual([
        { name: 'Vendor checklist', mentionedIn: '' },
        { name: 'Cost model', mentionedIn: 'report.pdf' },
      ]);
    });

    it('accepts source / fileName as aliases for mentionedIn', () => {
      expect(mentions([{ name: 'A', source: 's.pdf' }, { name: 'B', fileName: 'f.pdf' }])).toEqual([
        { name: 'A', mentionedIn: 's.pdf' },
        { name: 'B', mentionedIn: 'f.pdf' },
      ]);
    });

    it('accepts a 150-character name and drops a 151-character one', () => {
      expect(mentions(['a'.repeat(150), 'b'.repeat(151)])).toEqual([{ name: 'a'.repeat(150), mentionedIn: '' }]);
    });

    it('caps mentionedIn at 200 characters', () => {
      expect(mentions([{ name: 'A', mentionedIn: 'x'.repeat(300) }])?.[0].mentionedIn).toHaveLength(200);
    });

    it('caps the list at 10 entries', () => {
      expect(mentions(Array.from({ length: 15 }, (_, i) => `Item ${i}`))).toHaveLength(10);
    });

    it('drops empty, blank and non-string/non-object entries', () => {
      expect(mentions(['', '   ', null, 7, { name: '' }, { mentionedIn: 'x' }])).toEqual([]);
    });

    it('keeps unicode names', () => {
      expect(mentions(['किसान चेकलिस्ट'])).toEqual([{ name: 'किसान चेकलिस्ट', mentionedIn: '' }]);
    });
  });
});

describe('stripGridUpdate', () => {
  it('removes a complete trailing block and trims', () => {
    expect(stripGridUpdate(block({ cells: {} }, 'Hello there.'))).toBe('Hello there.');
  });

  it('cuts at a partially streamed opening tag so it never renders', () => {
    expect(stripGridUpdate('Hello.\n<grid_update>\n{"cel')).toBe('Hello.');
    expect(stripGridUpdate('Hello.\n<grid_update')).toBe('Hello.');
  });

  it('drops anything after the block too (the block always ends the reply)', () => {
    expect(stripGridUpdate('A <grid_update>{}</grid_update> trailing')).toBe('A');
  });

  it('returns trimmed text unchanged when there is no block', () => {
    expect(stripGridUpdate('  plain reply \n')).toBe('plain reply');
    expect(stripGridUpdate('')).toBe('');
  });

  it('returns an empty string for a reply that is only a block', () => {
    expect(stripGridUpdate('<grid_update>{"cells":{}}</grid_update>')).toBe('');
  });
});
