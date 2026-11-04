// Pathway slugs are lookup keys, unit ids (<slug>-uNN) and storage paths
// (pathway-sources/<slug>/…), so anything that reaches one must match this shape —
// lowercase letters/digits in single-hyphen-separated runs, nothing that
// could act as a path segment. Matches what app/api/pathways/route.ts's
// slugify produces; a row inserted any other way that doesn't match is
// refused rather than trusted.
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 120 && SLUG_PATTERN.test(value);
}
