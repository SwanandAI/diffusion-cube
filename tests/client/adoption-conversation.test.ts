import { describe, expect, it, vi } from 'vitest';

// extract-text pulls in pdfjs/mammoth/xlsx at import time; none of the pure
// helpers below touch it.
vi.mock('@/lib/extract-text', () => ({
  ATTACH_ACCEPT: '.pdf',
  CONTRIBUTOR_ATTACH_ACCEPT: '.pdf,.csv',
  extractTextFromFile: vi.fn(),
  fileToImageBlock: vi.fn(),
  getFileExtension: vi.fn(),
  isImageFile: vi.fn(),
}));

import {
  EMPTY_CUBE_ASSESSMENT,
  EMPTY_EXPLORER_DOC,
  EMPTY_GRID,
  EMPTY_META,
  EMPTY_PATHWAY_DOC,
  assetCardItems,
  assetNameFromFile,
  currentResourceItems,
  extractUploadedFileNames,
  mergeIntoReview,
  newResourceItems,
  rowToConversation,
  section4ForMessages,
  sharedAssetLinks,
  takeFindingsForFreshReview,
  toApiMessages,
} from '@/lib/adoption-conversation';
import type { Message } from '@/components/ChatPanel';
import type {
  AssetShareState,
  ResourceReviewItem,
  ResourceReviewState,
  ToolkitAssetCandidate,
} from '@/lib/toolkit-assets';

const ASSET_ID = 'asset-11111111-2222-3333-4444-555555555555';
const ASSET_ID_2 = 'asset-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function fileCandidate(fileName: string, name: string, extra: Partial<ToolkitAssetCandidate> = {}): ToolkitAssetCandidate {
  return { source: { fileName }, name, ...extra };
}
function linkCandidate(url: string, name: string, extra: Partial<ToolkitAssetCandidate> = {}): ToolkitAssetCandidate {
  return { source: { url }, name, ...extra };
}
function uploadMsg(...names: string[]): Message {
  return { role: 'user', content: 'doc text', displayContent: names.map((n) => `📄 Uploaded **${n}**`).join('\n') };
}
function review(items: ResourceReviewItem[], status: ResourceReviewState['status'] = 'open'): ResourceReviewState {
  return { id: 'r1', items, status, generateOnComplete: false };
}

const SECTION4_DOC = [
  '# Pathway',
  '',
  '## Section 3 — Units',
  'Some units.',
  '',
  '## Section 4 — Toolkits and playbooks',
  '',
  '| # | Title | Type | Reuse condition |',
  '|---|---|---|---|',
  '| 1 | Vendor Evaluation Checklist | Toolkit Asset | When picking a vendor |',
  '| 2 | Print Job Test Cases | Toolkit Asset | Before a kiosk rollout |',
  '| 3 | Go-live decision | Decision | Never |',
  '',
  '## Section 5 — Problems',
  'Text.',
].join('\n');

describe('EMPTY_* constants', () => {
  it('EMPTY_META starts with no flow, step 0 and the empty cube assessment', () => {
    expect(EMPTY_META.flow).toBe('');
    expect(EMPTY_META.flowStep).toBe(0);
    expect(EMPTY_META.pathwayId).toBe('');
    expect(EMPTY_META.cubeAssessment).toBe(EMPTY_CUBE_ASSESSMENT);
    expect(EMPTY_CUBE_ASSESSMENT).toEqual({
      currentStage: '',
      coveredDimensions: [],
      partialDimensions: [],
      missingDimensions: [],
      assessmentConfirmed: false,
    });
  });

  it('EMPTY_GRID has all 16 dimension×stage cells at density 0', () => {
    const keys = Object.keys(EMPTY_GRID);
    expect(keys).toHaveLength(16);
    expect(keys).toContain('persona:Explore');
    expect(keys).toContain('ecosystem:Scale');
    for (const cell of Object.values(EMPTY_GRID)) expect(cell).toEqual({ density: 0, note: '' });
  });

  it('EMPTY_PATHWAY_DOC and EMPTY_EXPLORER_DOC are closed, idle and error-free', () => {
    expect(EMPTY_PATHWAY_DOC).toMatchObject({
      content: null,
      versionNumber: 0,
      versions: [],
      selectedVersionNumber: null,
      paneOpen: false,
      loading: false,
      error: null,
      reviewRequested: false,
    });
    expect(EMPTY_EXPLORER_DOC).toEqual({ analysis: null, summary: null, open: null, generating: null, error: null });
  });
});

describe('toApiMessages', () => {
  it('drops notice bubbles and strips client-only fields', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'hi', displayContent: 'shown', pathwaysReferenced: ['x'] },
      { role: 'assistant', content: 'System encountered an error.', notice: true },
      { role: 'assistant', content: 'reply', pathwaysReferenced: ['a'], toolkitAssetsReferenced: [ASSET_ID] },
    ];
    expect(toApiMessages(msgs)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'reply' },
    ]);
  });

  it('expands images into a text block followed by base64 image blocks, in order', () => {
    const msgs: Message[] = [
      {
        role: 'user',
        content: 'look at these',
        images: [
          { mediaType: 'image/png', base64: 'AAA' },
          { mediaType: 'image/jpeg', base64: 'BBB' },
        ],
      },
    ];
    expect(toApiMessages(msgs)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look at these' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBB' } },
        ],
      },
    ]);
  });

  it('keeps plain string content when the images array is empty', () => {
    expect(toApiMessages([{ role: 'user', content: 'x', images: [] }])).toEqual([{ role: 'user', content: 'x' }]);
  });

  it('returns an empty list for no messages, or only notices', () => {
    expect(toApiMessages([])).toEqual([]);
    expect(toApiMessages([{ role: 'assistant', content: 'n', notice: true }])).toEqual([]);
  });

  it('still sends legacy hidden messages (only notices are filtered)', () => {
    expect(toApiMessages([{ role: 'user', content: 'note', hidden: true }])).toEqual([{ role: 'user', content: 'note' }]);
  });
});

describe('extractUploadedFileNames', () => {
  it('collects every uploaded file across messages, for all three icons', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'x', displayContent: 'Here you go\n📄 Uploaded **report.pdf**\n🖼️ Uploaded **photo.png**' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'y', displayContent: '📎 Uploaded **sheet.csv**' },
    ];
    expect(extractUploadedFileNames(msgs)).toEqual(['report.pdf', 'photo.png', 'sheet.csv']);
  });

  it('ignores messages without displayContent and plain mentions of uploads in content', () => {
    const msgs: Message[] = [{ role: 'user', content: '📄 Uploaded **not-counted.pdf**' }];
    expect(extractUploadedFileNames(msgs)).toEqual([]);
  });

  it('handles file names with spaces and non-ASCII characters', () => {
    const msgs: Message[] = [{ role: 'user', content: '', displayContent: '📄 Uploaded **Q3 plan – résumé v2.docx**' }];
    expect(extractUploadedFileNames(msgs)).toEqual(['Q3 plan – résumé v2.docx']);
  });

  it('returns [] for no messages', () => {
    expect(extractUploadedFileNames([])).toEqual([]);
  });
});

describe('rowToConversation', () => {
  it('maps a full row', () => {
    const meta = { ...EMPTY_META, name: 'Kiosk', flow: 'contributor' as const };
    const grid = { ...EMPTY_GRID, 'persona:Explore': { density: 2 as const, note: 'n' } };
    const conv = rowToConversation({
      id: 'd1',
      meta,
      grid_state: grid,
      messages: [{ role: 'user', content: 'hi' }],
      updated_at: '2026-10-01T00:00:00Z',
    });
    expect(conv).toEqual({
      id: 'd1',
      meta,
      grid,
      messages: [{ role: 'user', content: 'hi' }],
      updatedAt: '2026-10-01T00:00:00Z',
    });
  });

  it('fills null meta/grid/messages with defaults, and back-fills missing grid cells', () => {
    const conv = rowToConversation({
      id: 'd2',
      meta: null as never,
      grid_state: { 'solution:Pilot': { density: 3, note: 'live' } } as never,
      messages: null as never,
      updated_at: 'x',
    });
    expect(conv.meta).toBe(EMPTY_META);
    expect(conv.messages).toEqual([]);
    expect(Object.keys(conv.grid)).toHaveLength(16);
    expect(conv.grid['solution:Pilot']).toEqual({ density: 3, note: 'live' });
    expect(conv.grid['persona:Explore']).toEqual({ density: 0, note: '' });
  });

  it('does not mutate EMPTY_GRID', () => {
    rowToConversation({
      id: 'd3',
      meta: EMPTY_META,
      grid_state: { 'persona:Explore': { density: 1, note: 'x' } } as never,
      messages: [],
      updated_at: '',
    });
    expect(EMPTY_GRID['persona:Explore']).toEqual({ density: 0, note: '' });
  });
});

describe('assetNameFromFile', () => {
  it.each([
    ['03_A4KIOSK_Print_Job_Test_Cases.pdf', 'A4KIOSK Print Job Test Cases'],
    ['vendor-evaluation-checklist.docx', 'vendor evaluation checklist'],
    ['plain.txt', 'plain'],
    ['archive.tar.gz', 'archive.tar'],
    ['NoExtension', 'NoExtension'],
  ])('%s → %s', (input, expected) => {
    expect(assetNameFromFile(input)).toBe(expected);
  });

  it('falls back to the raw file name when nothing is left after cleaning', () => {
    expect(assetNameFromFile('___.pdf')).toBe('___.pdf');
    expect(assetNameFromFile('.pdf')).toBe('.pdf');
  });

  it('keeps a leading number that is not followed by a separator', () => {
    expect(assetNameFromFile('2026plan.pdf')).toBe('2026plan');
  });
});

describe('newResourceItems', () => {
  it('turns candidates and mentions into pending items with stable keys', () => {
    const items = newResourceItems(
      [fileCandidate('check.pdf', 'Checklist'), linkCandidate('https://ex.com/tool', 'Tool')],
      [{ name: 'Training Deck', mentionedIn: 'report.pdf' }],
      new Set()
    );
    expect(items).toEqual([
      { key: 'file:check.pdf', name: 'Checklist', candidate: fileCandidate('check.pdf', 'Checklist'), status: 'pending' },
      { key: 'url:https://ex.com/tool', name: 'Tool', candidate: linkCandidate('https://ex.com/tool', 'Tool'), status: 'pending' },
      { key: 'mention:training deck', name: 'Training Deck', mentionedIn: 'report.pdf', status: 'pending' },
    ]);
  });

  it('skips anything already reviewed (by source key or mention key)', () => {
    const items = newResourceItems(
      [fileCandidate('check.pdf', 'Checklist')],
      [{ name: 'Training Deck', mentionedIn: '' }],
      new Set(['file:check.pdf', 'mention:training deck'])
    );
    expect(items).toEqual([]);
  });

  it('drops a mention whose name matches a candidate in the same batch (the real file wins)', () => {
    const items = newResourceItems(
      [fileCandidate('check.pdf', 'Vendor Checklist')],
      [{ name: 'vendor checklist', mentionedIn: '' }],
      new Set()
    );
    expect(items.map((i) => i.key)).toEqual(['file:check.pdf']);
  });

  it('drops a mention that names a known item in other words', () => {
    const items = newResourceItems(
      [],
      [{ name: 'Troubleshooting approach for printer failures', mentionedIn: '' }],
      new Set(),
      ['Deployment checklist and troubleshooting approach for printer failures']
    );
    expect(items).toEqual([]);
  });

  it('de-duplicates the same candidate source and the same mention within one batch', () => {
    const items = newResourceItems(
      [fileCandidate('a.pdf', 'A'), fileCandidate('a.pdf', 'A again')],
      [
        { name: 'Deck', mentionedIn: '' },
        { name: 'DECK!', mentionedIn: '' },
      ],
      new Set()
    );
    expect(items.map((i) => i.key)).toEqual(['file:a.pdf', 'mention:deck']);
  });

  it('ignores a mention whose name is only punctuation', () => {
    expect(newResourceItems([], [{ name: '!!!', mentionedIn: '' }], new Set())).toEqual([]);
  });

  it('does not mutate the reviewed set it is given', () => {
    const reviewed = new Set<string>();
    newResourceItems([fileCandidate('a.pdf', 'A')], [], reviewed);
    expect(reviewed.size).toBe(0);
  });
});

describe('currentResourceItems', () => {
  it('lists valid fresh candidates (uploaded file / link the user actually typed) and mentions', () => {
    const msgs: Message[] = [
      uploadMsg('check.pdf'),
      { role: 'user', content: 'see https://ex.com/tool please' },
      {
        role: 'assistant',
        content: 'ok',
        toolkitAssetCandidates: [fileCandidate('check.pdf', 'Checklist'), linkCandidate('https://ex.com/tool', 'Tool')],
        toolkitAssetMentions: [{ name: 'Deck', mentionedIn: 'check.pdf' }],
      },
    ];
    expect(currentResourceItems(msgs).map((i) => i.key)).toEqual(['file:check.pdf', 'url:https://ex.com/tool', 'mention:deck']);
  });

  it('drops hallucinated candidates: a file never uploaded, or a link the user never typed', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'see https://ex.com/tool' },
      {
        role: 'assistant',
        content: 'ok',
        toolkitAssetCandidates: [
          fileCandidate('ghost.pdf', 'Ghost'),
          // the model "corrected" the link
          linkCandidate('https://ex.com/tools', 'Tools'),
          // a link only the assistant wrote
          linkCandidate('https://assistant-only.example', 'Assistant link'),
        ],
      },
      { role: 'assistant', content: 'https://assistant-only.example' },
    ];
    expect(currentResourceItems(msgs)).toEqual([]);
  });

  it('includes carded items except background ones and attachments still waiting for their check', () => {
    const msgs: Message[] = [
      {
        role: 'assistant',
        content: '',
        resourceReview: review([
          { key: 'mention:deck', name: 'Deck', status: 'pending' },
          { key: 'file:bg.pdf', name: 'BG', status: 'background', candidate: fileCandidate('bg.pdf', 'BG') },
          { key: 'attached:x', name: 'x.pdf', status: 'pending', attachedSource: { fileName: 'x.pdf' } },
          { key: 'attached:y', name: 'Y', status: 'shared', candidate: fileCandidate('y.pdf', 'Y') },
        ]),
      },
    ];
    expect(currentResourceItems(msgs).map((i) => i.key)).toEqual(['mention:deck', 'attached:y']);
  });

  it('does not repeat a fresh finding already on a card or a legacy consent card', () => {
    const msgs: Message[] = [
      uploadMsg('a.pdf', 'b.pdf'),
      {
        role: 'assistant',
        content: '',
        resourceReview: review([{ key: 'file:a.pdf', name: 'A', candidate: fileCandidate('a.pdf', 'A'), status: 'declined' }]),
      },
      {
        role: 'assistant',
        content: '',
        toolkitAssetConsent: { id: 'c1', candidate: fileCandidate('b.pdf', 'B'), status: 'shared' },
      },
      {
        role: 'assistant',
        content: '',
        toolkitAssetCandidates: [fileCandidate('a.pdf', 'A'), fileCandidate('b.pdf', 'B')],
      },
    ];
    expect(currentResourceItems(msgs).map((i) => i.key)).toEqual(['file:a.pdf']);
    expect(currentResourceItems(msgs)[0].status).toBe('declined');
  });

  it('returns [] for an empty conversation', () => {
    expect(currentResourceItems([])).toEqual([]);
  });
});

describe('assetCardItems', () => {
  it('lists Section 4 asset rows (not decisions/fixes) with their reuse condition', () => {
    expect(assetCardItems(SECTION4_DOC, [])).toEqual([
      {
        key: 'row:vendor evaluation checklist',
        name: 'Vendor Evaluation Checklist',
        fromSection4: true,
        reuseCondition: 'When picking a vendor',
      },
      { key: 'row:print job test cases', name: 'Print Job Test Cases', fromSection4: true, reuseCondition: 'Before a kiosk rollout' },
    ]);
  });

  it('suggests an uploaded file whose name matches a row', () => {
    const items = assetCardItems(SECTION4_DOC, [uploadMsg('03_Print_Job_Test_Cases.pdf')]);
    expect(items.find((i) => i.name === 'Print Job Test Cases')?.suggestedFile).toBe('03_Print_Job_Test_Cases.pdf');
    expect(items.find((i) => i.name === 'Vendor Evaluation Checklist')).not.toHaveProperty('suggestedFile');
  });

  it('prefers a file the companion flagged under that name over a file-name match', () => {
    const msgs: Message[] = [
      uploadMsg('scan_001.pdf', 'Vendor_Evaluation_Checklist.pdf'),
      { role: 'assistant', content: '', toolkitAssetCandidates: [fileCandidate('scan_001.pdf', 'Vendor evaluation checklist')] },
    ];
    expect(assetCardItems(SECTION4_DOC, msgs)[0].suggestedFile).toBe('scan_001.pdf');
  });

  it('skips rows already on an earlier asset card', () => {
    const card: AssetShareState = {
      id: 'a1',
      status: 'confirmed',
      noneInSection4: false,
      items: [{ key: 'row:vendor evaluation checklist', name: 'Vendor Evaluation Checklist', fromSection4: true }],
    };
    const items = assetCardItems(SECTION4_DOC, [{ role: 'assistant', content: '', assetShare: card }]);
    expect(items.map((i) => i.name)).toEqual(['Print Job Test Cases']);
  });

  it('returns [] when there is no Section 4 or no table', () => {
    expect(assetCardItems('# Doc\n\nNo sections here.', [])).toEqual([]);
    expect(assetCardItems('## Section 4 — Toolkits\n\nNo reusable resources documented.\n', [])).toEqual([]);
  });
});

describe('sharedAssetLinks', () => {
  it('links shared asset-card items (file → download route with preview, link → its URL)', () => {
    const card: AssetShareState = {
      id: 'a1',
      status: 'confirmed',
      noneInSection4: false,
      items: [
        {
          key: 'row:checklist',
          name: 'Checklist',
          fromSection4: true,
          reuseCondition: 'Always',
          shared: { assetId: ASSET_ID, source: { fileName: 'check.pdf' } },
        },
        {
          key: 'row:tool',
          name: 'Tool',
          fromSection4: true,
          shared: { assetId: ASSET_ID_2, source: { url: 'https://www.tool.example/x' } },
        },
        { key: 'row:unshared', name: 'Unshared', fromSection4: true, staged: { fileName: 'u.pdf' } },
      ],
    };
    expect(sharedAssetLinks([{ role: 'assistant', content: '', assetShare: card }])).toEqual([
      {
        name: 'Checklist',
        href: `/api/toolkit-assets/${ASSET_ID}/download`,
        titleHref: `/api/toolkit-assets/${ASSET_ID}/download?preview=1`,
        assetId: ASSET_ID,
        reuseCondition: 'Always',
        label: 'check.pdf',
      },
      {
        name: 'Tool',
        href: 'https://www.tool.example/x',
        titleHref: 'https://www.tool.example/x',
        assetId: ASSET_ID_2,
        reuseCondition: undefined,
        label: 'tool.example',
      },
    ]);
  });

  it('links shared legacy resource-review items, skipping undecided, declined, or id-less ones', () => {
    const msgs: Message[] = [
      {
        role: 'assistant',
        content: '',
        resourceReview: review([
          {
            key: 'file:a.docx',
            name: 'A',
            status: 'shared',
            assetId: ASSET_ID,
            candidate: fileCandidate('a.docx', 'A', { reuseCondition: 'R' }),
          },
          { key: 'file:b.pdf', name: 'B', status: 'shared', candidate: fileCandidate('b.pdf', 'B') },
          { key: 'file:c.pdf', name: 'C', status: 'declined', assetId: ASSET_ID_2, candidate: fileCandidate('c.pdf', 'C') },
          { key: 'mention:d', name: 'D', status: 'shared', assetId: ASSET_ID_2 },
        ]),
      },
    ];
    const links = sharedAssetLinks(msgs);
    expect(links).toHaveLength(1);
    // .docx has no browser preview, so the title links to the download itself.
    expect(links[0]).toMatchObject({
      name: 'A',
      href: `/api/toolkit-assets/${ASSET_ID}/download`,
      titleHref: `/api/toolkit-assets/${ASSET_ID}/download`,
      reuseCondition: 'R',
    });
  });

  it('returns [] with nothing shared', () => {
    expect(sharedAssetLinks([{ role: 'user', content: 'x' }])).toEqual([]);
  });
});

describe('section4ForMessages', () => {
  it('removes deleted assets and links the shared ones', () => {
    const card: AssetShareState = {
      id: 'a1',
      status: 'confirmed',
      noneInSection4: false,
      items: [
        { key: 'row:vendor', name: 'Vendor Evaluation Checklist', fromSection4: true, deleted: true },
        {
          key: 'row:print',
          name: 'Print Job Test Cases',
          fromSection4: true,
          shared: { assetId: ASSET_ID, source: { fileName: 'cases.pdf' } },
        },
      ],
    };
    const out = section4ForMessages(SECTION4_DOC, [{ role: 'assistant', content: '', assetShare: card }]);
    expect(out).not.toContain('Vendor Evaluation Checklist');
    expect(out).not.toContain('Go-live decision');
    expect(out).toContain(`[Print Job Test Cases](/api/toolkit-assets/${ASSET_ID}/download?preview=1) <!-- asset-id: ${ASSET_ID} -->`);
    expect(out).toContain('| File |');
    expect(out).toContain('## Section 5 — Problems');
  });

  it('still drops decision rows and writes no File column when nothing is shared', () => {
    const out = section4ForMessages(SECTION4_DOC, []);
    expect(out).toContain('Vendor Evaluation Checklist');
    expect(out).not.toContain('Go-live decision');
    expect(out).not.toContain('| File |');
  });

  it('leaves a document with no Section 4 untouched when nothing is shared', () => {
    const doc = '# Doc\n\n## Section 3\nText\n';
    expect(section4ForMessages(doc, [])).toBe(doc);
  });
});

describe('mergeIntoReview', () => {
  it('gives an attached item the candidate matching its source and renames an attached: item', () => {
    const r = review([{ key: 'attached:1', name: 'x.pdf', status: 'pending', attachedSource: { fileName: 'x.pdf' } }]);
    const merged = mergeIntoReview(r, [fileCandidate('x.pdf', 'Real Name')], [], new Set());
    expect(merged.items).toEqual([
      { key: 'attached:1', name: 'Real Name', status: 'pending', attachedSource: undefined, candidate: fileCandidate('x.pdf', 'Real Name') },
    ]);
  });

  it('keeps the name of a mention item that was answered by an attachment', () => {
    const r = review([
      { key: 'mention:deck', name: 'Deck', status: 'pending', attachedSource: { url: 'https://d.example' } },
    ]);
    const merged = mergeIntoReview(r, [linkCandidate('https://d.example', 'Slides')], [], new Set());
    expect(merged.items[0]).toMatchObject({ key: 'mention:deck', name: 'Deck', candidate: { name: 'Slides' } });
  });

  it('turns an attachment the check did not list into background material', () => {
    const r = review([{ key: 'attached:1', name: 'x.pdf', status: 'pending', attachedSource: { fileName: 'x.pdf' } }]);
    const merged = mergeIntoReview(r, [], [], new Set());
    expect(merged.items[0]).toMatchObject({ status: 'background', attachedSource: undefined });
  });

  it('attaches a candidate to a pending mention with the same name', () => {
    const r = review([{ key: 'mention:vendor checklist', name: 'Vendor checklist', status: 'pending' }]);
    const merged = mergeIntoReview(r, [fileCandidate('v.pdf', 'Vendor Checklist')], [], new Set());
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].candidate?.source).toEqual({ fileName: 'v.pdf' });
  });

  it('adds leftovers and new mentions as new items, skipping known ones', () => {
    const r = review([{ key: 'mention:deck', name: 'Deck', status: 'declined' }]);
    const merged = mergeIntoReview(
      r,
      [fileCandidate('new.pdf', 'New'), fileCandidate('old.pdf', 'Old')],
      [
        { name: 'Deck', mentionedIn: '' },
        { name: 'Playbook', mentionedIn: 'new.pdf' },
      ],
      new Set(['file:old.pdf'])
    );
    expect(merged.items.map((i) => i.key)).toEqual(['mention:deck', 'file:new.pdf', 'mention:playbook']);
  });

  it('does not mutate the review passed in', () => {
    const r = review([{ key: 'attached:1', name: 'x.pdf', status: 'pending', attachedSource: { fileName: 'x.pdf' } }]);
    const snapshot = JSON.parse(JSON.stringify(r));
    mergeIntoReview(r, [], [], new Set());
    expect(r).toEqual(snapshot);
  });

  it('does not match a file attachment to a link candidate', () => {
    const r = review([{ key: 'attached:1', name: 'x', status: 'pending', attachedSource: { fileName: 'x' } }]);
    const merged = mergeIntoReview(r, [linkCandidate('https://x.example', 'X')], [], new Set());
    expect(merged.items[0].status).toBe('background');
    expect(merged.items[1]).toMatchObject({ key: 'url:https://x.example', status: 'pending' });
  });
});

describe('takeFindingsForFreshReview', () => {
  it('returns new items and leaves messages untouched when nothing pending matches', () => {
    const msgs: Message[] = [{ role: 'user', content: 'hi' }];
    const out = takeFindingsForFreshReview(msgs, [fileCandidate('a.pdf', 'A')], [{ name: 'Deck', mentionedIn: '' }]);
    expect(out.messages).toBe(msgs);
    expect(out.items.map((i) => i.key)).toEqual(['file:a.pdf', 'mention:deck']);
  });

  it('moves a pending mention on an older open card to the fresh card with its new candidate', () => {
    const msgs: Message[] = [
      {
        role: 'assistant',
        content: 'old',
        resourceReview: review([
          { key: 'mention:deck', name: 'Deck', status: 'pending', mentionedIn: 'r.pdf' },
          { key: 'mention:other', name: 'Other', status: 'pending' },
        ]),
      },
    ];
    const out = takeFindingsForFreshReview(msgs, [fileCandidate('deck.pptx', 'Deck')], []);
    expect(out.items).toEqual([
      { key: 'mention:deck', name: 'Deck', status: 'pending', mentionedIn: 'r.pdf', candidate: fileCandidate('deck.pptx', 'Deck') },
    ]);
    const oldCard = out.messages[0].resourceReview!;
    expect(oldCard.items.map((i) => i.key)).toEqual(['mention:other']);
    // The card's history text is rebuilt so the model doesn't see the moved item.
    expect(out.messages[0].content).not.toContain('Deck');
    expect(out.messages[0].content).toContain('Other');
    // input not mutated
    expect(msgs[0].resourceReview!.items).toHaveLength(2);
  });

  it('does not move from a completed card or a decided item', () => {
    const msgs: Message[] = [
      { role: 'assistant', content: '', resourceReview: review([{ key: 'mention:deck', name: 'Deck', status: 'pending' }], 'complete') },
      { role: 'assistant', content: '', resourceReview: { ...review([{ key: 'mention:kit', name: 'Kit', status: 'declined' }]), id: 'r2' } },
    ];
    const out = takeFindingsForFreshReview(msgs, [fileCandidate('deck.pdf', 'Deck'), fileCandidate('kit.pdf', 'Kit')], []);
    expect(out.messages).toBe(msgs);
    // Both are fresh source keys, so they become new items.
    expect(out.items.map((i) => i.key)).toEqual(['file:deck.pdf', 'file:kit.pdf']);
  });

  it('drops a mention that duplicates an item moved this turn', () => {
    const msgs: Message[] = [
      { role: 'assistant', content: '', resourceReview: review([{ key: 'mention:deck', name: 'Deck', status: 'pending' }]) },
    ];
    const out = takeFindingsForFreshReview(msgs, [fileCandidate('d.pdf', 'Deck')], [{ name: 'deck', mentionedIn: '' }]);
    expect(out.items.map((i) => i.key)).toEqual(['mention:deck']);
  });

  it('moves a mention only once when two candidates share its name', () => {
    const msgs: Message[] = [
      { role: 'assistant', content: '', resourceReview: review([{ key: 'mention:deck', name: 'Deck', status: 'pending' }]) },
    ];
    const out = takeFindingsForFreshReview(msgs, [fileCandidate('d1.pdf', 'Deck'), fileCandidate('d2.pdf', 'Deck')], []);
    expect(out.items.map((i) => i.key)).toEqual(['mention:deck', 'file:d2.pdf']);
  });

  it('returns no items for no findings', () => {
    expect(takeFindingsForFreshReview([], [], []).items).toEqual([]);
  });
});
