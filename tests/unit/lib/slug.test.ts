import { describe, expect, it } from 'vitest';
import { isValidSlug, SLUG_PATTERN } from '@/lib/slug';

describe('isValidSlug', () => {
  it.each(['blue-dots', 'mahavistaar', 'a', 'pathway-2', 'x1-y2-z3'])('accepts %s', (slug) => {
    expect(isValidSlug(slug)).toBe(true);
  });

  it.each([
    ['empty string', ''],
    ['uppercase', 'Blue-Dots'],
    ['leading hyphen', '-blue'],
    ['trailing hyphen', 'blue-'],
    ['double hyphen', 'blue--dots'],
    ['path traversal', '../../etc/passwd'],
    ['slash', 'a/b'],
    ['backslash', 'a\\b'],
    ['dot', 'index.md'],
    ['space', 'blue dots'],
    ['underscore', 'blue_dots'],
    ['unicode', 'café'],
  ])('rejects %s', (_label, slug) => {
    expect(isValidSlug(slug)).toBe(false);
  });

  it('rejects non-strings', () => {
    for (const value of [undefined, null, 42, {}, ['a'], true]) {
      expect(isValidSlug(value)).toBe(false);
    }
  });

  it('accepts exactly 120 characters and rejects 121', () => {
    expect(isValidSlug('a'.repeat(120))).toBe(true);
    expect(isValidSlug('a'.repeat(121))).toBe(false);
  });

  it('exports the pattern it enforces', () => {
    expect(SLUG_PATTERN.test('ok-slug')).toBe(true);
  });
});
