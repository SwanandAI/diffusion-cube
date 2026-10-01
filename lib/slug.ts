// Pathway slugs double as file names (content/wiki/pathways/<slug>.md, the
// GitHub path assemble commits to, content/library-wiki/pathways/<slug>.md)
// and lookup keys, so anything that reaches a path must match this shape —
// lowercase letters/digits in single-hyphen-separated runs, nothing that
// could act as a path segment. Matches what app/api/pathways/route.ts's
// slugify produces; a row inserted any other way that doesn't match is
// refused rather than trusted.
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 120 && SLUG_PATTERN.test(value);
}
