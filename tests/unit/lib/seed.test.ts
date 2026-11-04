import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunkText, extensionOf, sourceKey, storagePath, validateManifest } from '@/lib/seed';

const BASE = '/data/seed';
const exists = (files: string[]) => (p: string) => files.includes(p);

describe('validateManifest', () => {
  const ok = {
    pathways: [
      { slug: 'maha', title: 'MahaVISTAAR', sector: 'Agriculture', files: [{ path: 'maha/a.pdf', public: true }, 'maha/b.docx'] },
    ],
  };

  it('resolves paths against the manifest folder and defaults files to contributor-only', () => {
    const { manifest, errors } = validateManifest(ok, BASE, exists(['/data/seed/maha/a.pdf', '/data/seed/maha/b.docx']));
    expect(errors).toEqual([]);
    expect(manifest!.pathways[0]).toEqual({
      slug: 'maha',
      title: 'MahaVISTAAR',
      sector: 'Agriculture',
      organisation: '',
      files: [
        { path: path.resolve(BASE, 'maha/a.pdf'), public: true },
        { path: path.resolve(BASE, 'maha/b.docx'), public: false },
      ],
    });
  });

  it('reports every problem at once and returns no manifest', () => {
    const { manifest, errors } = validateManifest(
      {
        pathways: [
          { slug: 'Bad Slug', title: 'X', files: ['a.pdf'] },
          { slug: 'dup', title: 'A', files: ['missing.pdf', 'archive.zip'] },
          { slug: 'dup', title: '', files: [] },
          { slug: 'flag', title: 'F', files: [{ path: 'f.txt', public: 'yes' }] },
        ],
      },
      BASE,
      exists(['/data/seed/f.txt'])
    );
    expect(manifest).toBeNull();
    expect(errors).toEqual([
      'pathways[0]: "slug" must be lowercase words joined by hyphens (got "Bad Slug").',
      'pathways[1].files[0] (dup): /data/seed/missing.pdf does not exist.',
      'pathways[1].files[1] (dup): archive.zip is not a supported type (pdf, docx, xlsx, xls, pptx, txt, md).',
      'pathways[2]: slug "dup" appears more than once.',
      'pathways[2] (dup): "title" is required.',
      'pathways[2] (dup): "files" must list at least one document.',
      'pathways[3].files[0] (flag): "public" must be true or false.',
    ]);
  });

  it('rejects an empty or missing pathway list', () => {
    expect(validateManifest({}, BASE, () => true).errors).toEqual(['The manifest needs a non-empty "pathways" list.']);
    expect(validateManifest({ pathways: [] }, BASE, () => true).manifest).toBeNull();
  });
});

describe('extensionOf', () => {
  it('accepts the supported types, case-insensitively', () => {
    expect(extensionOf('/x/Report.PDF')).toBe('pdf');
    expect(extensionOf('deck.pptx')).toBe('pptx');
    expect(extensionOf('old.doc')).toBeNull();
    expect(extensionOf('scan.png')).toBeNull();
  });
});

describe('sourceKey / storagePath', () => {
  it('numbers sources src-01, src-02, …', () => {
    expect([0, 1, 9].map(sourceKey)).toEqual(['src-01', 'src-02', 'src-10']);
  });

  it('builds a safe object path under the slug', () => {
    expect(storagePath('maha', 'src-01', 'Vendor Évaluation (v2).pdf')).toBe('maha/src-01-Vendor_Evaluation_v2_.pdf');
    expect(storagePath('maha', 'src-02', '../../etc/passwd')).toBe('maha/src-02-.._.._etc_passwd');
  });
});

describe('chunkText', () => {
  it('returns nothing for empty text and one passage for short text', () => {
    expect(chunkText('   \n\n ')).toEqual([]);
    expect(chunkText('One short paragraph.')).toEqual(['One short paragraph.']);
  });

  it('keeps every passage within the size and covers the whole text', () => {
    const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} talks about data sharing agreements.`).join(' ');
    const chunks = chunkText(text, 400, 50);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(400);
    expect(chunks[0].startsWith('Sentence number 0')).toBe(true);
    expect(chunks[chunks.length - 1].endsWith('Sentence number 59 talks about data sharing agreements.')).toBe(true);
    // Each sentence appears somewhere.
    for (let i = 0; i < 60; i++) expect(chunks.some((c) => c.includes(`number ${i} `))).toBe(true);
  });

  it('prefers to cut at a paragraph break', () => {
    const para = 'a'.repeat(300);
    const chunks = chunkText(`${para}\n\n${para}\n\n${para}`, 700, 0);
    expect(chunks[0]).toBe(`${para}\n\n${para}`);
  });

  it('always makes progress, even on text with no breaks', () => {
    const chunks = chunkText('x'.repeat(5000), 1600, 200);
    expect(chunks.every((c) => c.length <= 1600)).toBe(true);
    expect(chunks.length).toBe(4);
  });
});
