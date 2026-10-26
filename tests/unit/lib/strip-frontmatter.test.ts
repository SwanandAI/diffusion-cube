import { describe, expect, it } from 'vitest';
import { parseFrontmatter, stripFrontmatter } from '@/lib/strip-frontmatter';

const DOC = `---
title: Blue Dots — Local Job Discovery
description: Open voice-AI discovery: jobs, talent, services
tags: [Voice AI, Livelihoods, Digital Public Goods]
sector: Livelihoods
stage: Scale
location: Ghaziabad, India
timestamp: 2026-08-31
---

# 0. Reading Guide
Body text.`;

describe('stripFrontmatter', () => {
  it('removes a leading frontmatter block (LF)', () => {
    expect(stripFrontmatter(DOC)).toBe('\n# 0. Reading Guide\nBody text.');
  });

  it('handles CRLF line endings', () => {
    expect(stripFrontmatter(DOC.replace(/\n/g, '\r\n'))).toBe('\r\n# 0. Reading Guide\r\nBody text.');
  });

  it('handles trailing spaces/tabs on the delimiters', () => {
    expect(stripFrontmatter('--- \t\ntitle: x\n---  \nBody')).toBe('Body');
  });

  it('strips a block that ends the file with no trailing newline', () => {
    expect(stripFrontmatter('---\ntitle: x\n---')).toBe('');
  });

  it.each([
    ['no frontmatter', '# Title\nBody'],
    ['empty string', ''],
    ['frontmatter not at the start', 'Intro\n---\ntitle: x\n---\nBody'],
    ['an unterminated block', '---\ntitle: x\nBody without a closing delimiter'],
    ['a leading horizontal rule only', '---\n\nBody'],
    ['four dashes', '----\ntitle: x\n----\nBody'],
  ])('leaves %s untouched', (_label, markdown) => {
    expect(stripFrontmatter(markdown)).toBe(markdown);
  });

  it('only strips the first block, leaving later --- rules in the body', () => {
    expect(stripFrontmatter('---\na: 1\n---\nBody\n\n---\n\nMore')).toBe('Body\n\n---\n\nMore');
  });
});

describe('parseFrontmatter', () => {
  it('parses the known fields', () => {
    expect(parseFrontmatter(DOC)).toEqual({
      title: 'Blue Dots — Local Job Discovery',
      description: 'Open voice-AI discovery: jobs, talent, services',
      tags: ['Voice AI', 'Livelihoods', 'Digital Public Goods'],
      sector: 'Livelihoods',
      stage: 'Scale',
      location: 'Ghaziabad, India',
    });
  });

  it('keeps everything after the first colon in a value', () => {
    expect(parseFrontmatter('---\ntitle: AI: a primer: v2\n---\n')?.title).toBe('AI: a primer: v2');
  });

  it('ignores unknown keys and lines without a colon', () => {
    expect(parseFrontmatter('---\ntype: Pathway\njust a line\ncontributor: EkStep\n---\n')).toEqual({});
  });

  it.each([
    ['a bracketed list', 'tags: [A, B ,C]', ['A', 'B', 'C']],
    ['a list with blank entries', 'tags: [A, , B,]', ['A', 'B']],
    ['an empty list', 'tags: []', []],
    ['a bare single value', 'tags: Voice AI', ['Voice AI']],
    ['no value', 'tags:', []],
    ['unicode tags', 'tags: [किसान, Santé]', ['किसान', 'Santé']],
  ])('parses tags given as %s', (_label, line, tags) => {
    expect(parseFrontmatter(`---\n${line}\n---\n`)?.tags).toEqual(tags);
  });

  it('parses CRLF frontmatter', () => {
    expect(parseFrontmatter('---\r\ntitle: X\r\nstage: Pilot\r\n---\r\nBody')).toEqual({ title: 'X', stage: 'Pilot' });
  });

  it('returns null when there is no frontmatter block', () => {
    expect(parseFrontmatter('# Just a doc')).toBeNull();
    expect(parseFrontmatter('')).toBeNull();
    expect(parseFrontmatter('Intro\n---\ntitle: x\n---\n')).toBeNull();
  });

  it('does not let a key-lookalike in the body leak into the result', () => {
    expect(parseFrontmatter('---\ntitle: Real\n---\ntitle: Fake\nstage: Scale')).toEqual({ title: 'Real' });
  });

  it('does not treat __proto__ as a field (no prototype pollution)', () => {
    const parsed = parseFrontmatter('---\n__proto__: polluted\nconstructor: x\n---\n');
    expect(parsed).toEqual({});
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
