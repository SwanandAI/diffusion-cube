import { describe, expect, it } from 'vitest';
import { chunkText, documentChunks, keywordScore, keywordsOf } from '@/lib/text-chunks';
import { chunkText as seedChunkText } from '@/lib/seed';

const DOC = `---
title: Maha
description: secret frontmatter
---

# MahaVISTAAR

Intro line.

## Section 1 — Pathway identity

Scale: 1.2 million farmers.

## Section 3 — Micro-innovations

**1. Sign an MoU**
- **Dimension:** Institution

## Source Trace

| src-01 · mou.pdf | Unit 1 | Primary |
`;

describe('documentChunks', () => {
  it('cuts the document by section, each passage headed by its section, without frontmatter or Source Trace', () => {
    const chunks = documentChunks(DOC);
    expect(chunks.map((c) => c.section)).toEqual(['MahaVISTAAR', 'Section 1 — Pathway identity', 'Section 3 — Micro-innovations']);
    expect(chunks.map((c) => c.chunk_index)).toEqual([0, 1, 2]);
    expect(chunks[1].text).toBe('Section 1 — Pathway identity\nScale: 1.2 million farmers.');
    const all = chunks.map((c) => c.text).join('\n');
    expect(all).not.toMatch(/secret frontmatter|mou\.pdf|Source Trace/);
  });

  it('splits a long section into passages that stay within the size, each keeping the heading', () => {
    const long = `## Section 2 — Gaps\n\n${'A gap sentence here. '.repeat(300)}`;
    const chunks = documentChunks(long, 800);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.startsWith('Section 2 — Gaps\n')).toBe(true);
      expect(c.text.length).toBeLessThanOrEqual(800);
    }
  });

  it('is empty for an empty document', () => {
    expect(documentChunks('---\ntitle: x\n---\n')).toEqual([]);
  });
});

describe('keywords', () => {
  it('drops stop words and duplicates', () => {
    expect(keywordsOf('Which telephony vendor did they choose for the vendor?')).toEqual(['telephony', 'vendor', 'choose']);
  });

  it('scores a passage by how many question keywords it has', () => {
    const k = keywordsOf('telephony vendor');
    expect(keywordScore('The vendor ran telephony.', k)).toBeGreaterThan(keywordScore('The vendor was late.', k));
    expect(keywordScore('Nothing relevant.', k)).toBe(0);
    expect(keywordScore('anything', [])).toBe(0);
  });
});

it('the seed script still gets the same chunkText', () => {
  expect(seedChunkText).toBe(chunkText);
});
