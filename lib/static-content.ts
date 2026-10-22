import { readFile } from 'fs/promises';

// Reads a file committed under content/ (framework, resources, generation
// prompt, the grounding corpus). These only change with a deploy, so in
// production each is read from disk once per server instance and kept in
// memory; in development every call re-reads, so edits show immediately.
// A failed read returns '' and isn't kept, so a missing file is retried.
// Database content (published_pathways) is never cached here — publishing
// must show up on the next request.

const MEMOISE = process.env.NODE_ENV === 'production';
const cache = new Map<string, Promise<string>>();

async function readFromDisk(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

export function readStaticFile(filePath: string): Promise<string> {
  if (!MEMOISE) return readFromDisk(filePath);
  const cached = cache.get(filePath);
  if (cached) return cached;
  const pending = readFromDisk(filePath).then((text) => {
    if (!text) cache.delete(filePath);
    return text;
  });
  cache.set(filePath, pending);
  return pending;
}
