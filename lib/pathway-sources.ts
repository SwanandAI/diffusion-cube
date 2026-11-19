// Client-safe constants for pathways' original documents (migrations 0042,
// 0043). The server side lives in lib/pathway-store.ts; the browser uses
// these to upload a contributor's document to its signed URL.

// Private bucket for pathways' original files: seeded and contributors'.
export const SOURCES_BUCKET = 'pathway-sources';
// The bucket's own limit (0042); a larger file is kept as text only.
export const MAX_SOURCE_FILE_BYTES = 50 * 1024 * 1024;
// About 500k tokens: far beyond what one prompt ever takes (retrieval picks
// what fits), but keeps a request body well under the platform's limit.
export const MAX_SOURCE_TEXT_CHARS = 2_000_000;
