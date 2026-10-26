import { beforeEach, describe, expect, it, vi } from 'vitest';

// The heavy browser parsers are replaced with small fakes: these tests cover
// the routing, guards and post-processing in lib/extract-text.ts, not the
// third-party parsers themselves.
const parsers = vi.hoisted(() => ({
  pdfPages: [] as string[][],
  docxText: '',
  sheets: {} as Record<string, string>,
  zipFiles: {} as Record<string, string>,
}));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({
      numPages: parsers.pdfPages.length,
      getPage: async (i: number) => ({
        getTextContent: async () => ({ items: [...parsers.pdfPages[i - 1].map((str) => ({ str })), { type: 'beginMarkedContent' }] }),
      }),
    }),
  })),
}));
vi.mock('mammoth', () => ({ default: { extractRawText: vi.fn(async () => ({ value: parsers.docxText })) } }));
vi.mock('xlsx', () => ({
  read: vi.fn(() => ({ SheetNames: Object.keys(parsers.sheets), Sheets: parsers.sheets })),
  utils: { sheet_to_csv: vi.fn((sheet: string) => sheet) },
}));
vi.mock('jszip', () => ({
  default: {
    loadAsync: vi.fn(async () => ({
      files: Object.fromEntries(
        Object.entries(parsers.zipFiles).map(([name, xml]) => [name, { async: async () => xml }])
      ),
    })),
  },
}));

import * as pdfjsLib from 'pdfjs-dist';
import {
  ATTACH_ACCEPT,
  CONTRIBUTOR_ATTACH_ACCEPT,
  extractTextFromFile,
  fileToImageBlock,
  getFileExtension,
  isImageFile,
} from '@/lib/extract-text';

// A File-like object with an arbitrary reported size, so size guards can be
// tested without allocating 100 MB.
function fakeFile(name: string, size: number, type = ''): File {
  return { name, size, type, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) } as unknown as File;
}

beforeEach(() => {
  parsers.pdfPages = [];
  parsers.docxText = '';
  parsers.sheets = {};
  parsers.zipFiles = {};
});

describe('module setup', () => {
  it('points pdf.js at its bundled worker', () => {
    expect(pdfjsLib.GlobalWorkerOptions.workerSrc).toMatch(/pdfjs-dist\/build\/pdf\.worker\.min\.mjs$/);
  });
});

describe('accept lists', () => {
  it('the chat picker takes readable documents and images, never ZIP or legacy Office', () => {
    const exts = ATTACH_ACCEPT.split(',');
    expect(exts).toEqual(expect.arrayContaining(['.pdf', '.docx', '.xlsx', '.xls', '.pptx', '.txt', '.md', '.png', '.jpg', '.jpeg', '.gif', '.webp']));
    for (const bad of ['.zip', '.doc', '.ppt', '.csv', '.exe']) expect(exts).not.toContain(bad);
  });

  it('the contributor picker adds the asset-only types', () => {
    expect(CONTRIBUTOR_ATTACH_ACCEPT.split(',')).toEqual([...ATTACH_ACCEPT.split(','), '.doc', '.ppt', '.csv']);
    expect(CONTRIBUTOR_ATTACH_ACCEPT).not.toContain('.zip');
  });

  it('every chat-picker extension is recognised by getFileExtension', () => {
    for (const ext of ATTACH_ACCEPT.split(',')) expect(getFileExtension(`file${ext}`)).toBe(ext.slice(1));
  });
});

describe('getFileExtension', () => {
  it.each([
    ['report.pdf', 'pdf'],
    ['REPORT.PDF', 'pdf'],
    ['notes.v2.md', 'md'],
    ['photo.JPEG', 'jpeg'],
    ['sheet.xls', 'xls'],
  ])('%s -> %s', (name, ext) => {
    expect(getFileExtension(name)).toBe(ext);
  });

  it.each(['archive.zip', 'legacy.doc', 'legacy.ppt', 'data.csv', 'file.', '', 'evil.pdf.exe', 'image.svg', 'x.constructor'])(
    'returns null for %j',
    (name) => {
      expect(getFileExtension(name)).toBeNull();
    }
  );
});

describe('isImageFile', () => {
  it.each(['a.png', 'a.JPG', 'a.jpeg', 'a.gif', 'a.webp'])('%s is an image', (name) => {
    expect(isImageFile(name)).toBe(true);
  });

  it.each(['a.pdf', 'a.svg', 'a.bmp', 'png.txt', '', 'a.'])('%s is not an image', (name) => {
    expect(isImageFile(name)).toBe(false);
  });
});

describe('extractTextFromFile', () => {
  it('reads plain text and markdown, trimmed', async () => {
    await expect(extractTextFromFile(new File(['  hello\nworld \n'], 'n.txt'))).resolves.toBe('hello\nworld');
    await expect(extractTextFromFile(new File(['# किसान'], 'n.md'))).resolves.toBe('# किसान');
  });

  it('returns "" for an empty text file', async () => {
    await expect(extractTextFromFile(new File([''], 'empty.txt'))).resolves.toBe('');
  });

  it('joins PDF pages with blank lines and items with spaces', async () => {
    parsers.pdfPages = [['Page', 'one'], ['Page', 'two']];
    await expect(extractTextFromFile(new File(['%PDF'], 'doc.pdf'))).resolves.toBe('Page one \n\nPage two');
  });

  it('reads .docx through mammoth, trimmed', async () => {
    parsers.docxText = '  Deployment notes  ';
    await expect(extractTextFromFile(new File(['x'], 'notes.docx'))).resolves.toBe('Deployment notes');
  });

  it('reads every spreadsheet sheet as CSV under a heading', async () => {
    parsers.sheets = { Budget: 'a,b\n1,2', Team: 'name\nAsha' };
    await expect(extractTextFromFile(new File(['x'], 'plan.xlsx'))).resolves.toBe('Sheet: Budget\na,b\n1,2\n\nSheet: Team\nname\nAsha');
  });

  it('reads .pptx slides in numeric order and decodes XML entities', async () => {
    parsers.zipFiles = {
      'ppt/slides/slide10.xml': '<a:t>Ten</a:t>',
      'ppt/slides/slide2.xml': '<a:t>Two &amp; &lt;b&gt; &quot;q&quot; &apos;s&apos;</a:t>',
      'ppt/slides/slide1.xml': '<a:t>One</a:t><a:t>more</a:t>',
      'ppt/slides/_rels/slide1.xml.rels': '<a:t>ignored</a:t>',
      'ppt/notesSlides/notesSlide1.xml': '<a:t>speaker notes</a:t>',
    };
    await expect(extractTextFromFile(new File(['x'], 'deck.pptx'))).resolves.toBe(
      'Slide 1:\nOne more\n\nSlide 2:\nTwo & <b> "q" \'s\'\n\nSlide 3:\nTen'
    );
  });

  it('returns "" for a deck with no slides', async () => {
    await expect(extractTextFromFile(new File(['x'], 'deck.pptx'))).resolves.toBe('');
  });

  it.each(['photo.png', 'archive.zip', 'legacy.doc', 'data.csv', 'noext'])('refuses %s as not readable text', async (name) => {
    await expect(extractTextFromFile(new File(['x'], name))).rejects.toThrow('This file type is sent as an image, not read as text.');
  });

  it('accepts exactly 100 MB and refuses one byte more', async () => {
    const max = 100 * 1024 * 1024;
    await expect(extractTextFromFile(fakeFile('big.txt', max))).resolves.toBe('');
    await expect(extractTextFromFile(fakeFile('big.txt', max + 1))).rejects.toThrow('File is too large — please upload something under 100MB.');
  });
});

describe('fileToImageBlock', () => {
  it('base64-encodes the bytes and keeps the declared type', async () => {
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' });
    await expect(fileToImageBlock(file)).resolves.toEqual({ mediaType: 'image/png', base64: 'iVBORw==' });
  });

  it('defaults the media type to image/png when the browser gives none', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'a.webp');
    await expect(fileToImageBlock(file)).resolves.toEqual({ mediaType: 'image/png', base64: 'AQID' });
  });

  it('encodes images larger than one 32 KB chunk correctly', async () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17).map((_, i) => i % 256);
    const { base64 } = await fileToImageBlock(new File([bytes], 'big.jpg', { type: 'image/jpeg' }));
    expect(Buffer.from(base64, 'base64').equals(Buffer.from(bytes))).toBe(true);
  });

  it('handles an empty image', async () => {
    await expect(fileToImageBlock(new File([], 'a.gif', { type: 'image/gif' }))).resolves.toEqual({ mediaType: 'image/gif', base64: '' });
  });

  it('accepts exactly 5 MB and refuses one byte more', async () => {
    const max = 5 * 1024 * 1024;
    await expect(fileToImageBlock(fakeFile('a.png', max, 'image/png'))).resolves.toEqual({ mediaType: 'image/png', base64: '' });
    await expect(fileToImageBlock(fakeFile('a.png', max + 1))).rejects.toThrow('Image is too large — please upload something under 5MB.');
  });
});
