import path from 'node:path';
import { isValidSlug } from '@/lib/slug';

// Pure helpers for the one-time seed (scripts/seed-pathways.ts,
// docs/features/pathway-storage/, PS-12): the manifest's shape and checks,
// source keys, storage paths and passage chunking. No I/O here, so it is
// unit-tested directly.

export const SUPPORTED_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'xls', 'pptx', 'txt', 'md'] as const;
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

export const MIME_TYPES: Record<SupportedExtension, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  md: 'text/markdown',
};

export interface ManifestFile {
  path: string; // absolute, resolved against the manifest's folder
  public: boolean;
}

export interface ManifestPathway {
  slug: string;
  title: string;
  sector: string;
  organisation: string;
  files: ManifestFile[];
}

export interface Manifest {
  pathways: ManifestPathway[];
}

export function extensionOf(file: string): SupportedExtension | null {
  const ext = path.extname(file).slice(1).toLowerCase();
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext) ? (ext as SupportedExtension) : null;
}

// Checks the whole manifest before anything is written. Returns every
// problem at once, so one run shows them all.
export function validateManifest(
  raw: unknown,
  baseDir: string,
  fileExists: (absPath: string) => boolean
): { manifest: Manifest | null; errors: string[] } {
  const errors: string[] = [];
  const list = (raw as { pathways?: unknown })?.pathways;
  if (!Array.isArray(list) || list.length === 0) {
    return { manifest: null, errors: ['The manifest needs a non-empty "pathways" list.'] };
  }

  const seen = new Set<string>();
  const pathways: ManifestPathway[] = [];
  list.forEach((entry, i) => {
    const where = `pathways[${i}]`;
    const e = (entry ?? {}) as Record<string, unknown>;
    const slug = e.slug;
    if (!isValidSlug(slug)) {
      errors.push(`${where}: "slug" must be lowercase words joined by hyphens (got ${JSON.stringify(slug)}).`);
      return;
    }
    if (seen.has(slug)) errors.push(`${where}: slug "${slug}" appears more than once.`);
    seen.add(slug);
    if (typeof e.title !== 'string' || !e.title.trim()) errors.push(`${where} (${slug}): "title" is required.`);
    if (e.sector !== undefined && typeof e.sector !== 'string') errors.push(`${where} (${slug}): "sector" must be text.`);
    if (e.organisation !== undefined && typeof e.organisation !== 'string') {
      errors.push(`${where} (${slug}): "organisation" must be text.`);
    }

    const files: ManifestFile[] = [];
    if (!Array.isArray(e.files) || e.files.length === 0) {
      errors.push(`${where} (${slug}): "files" must list at least one document.`);
    } else {
      e.files.forEach((f, j) => {
        const fw = `${where}.files[${j}]`;
        const file = (typeof f === 'string' ? { path: f } : (f ?? {})) as Record<string, unknown>;
        if (typeof file.path !== 'string' || !file.path.trim()) {
          errors.push(`${fw} (${slug}): "path" is required.`);
          return;
        }
        if (file.public !== undefined && typeof file.public !== 'boolean') {
          errors.push(`${fw} (${slug}): "public" must be true or false.`);
        }
        const abs = path.resolve(baseDir, file.path);
        if (!extensionOf(abs)) {
          errors.push(`${fw} (${slug}): ${path.basename(abs)} is not a supported type (${SUPPORTED_EXTENSIONS.join(', ')}).`);
        } else if (!fileExists(abs)) {
          errors.push(`${fw} (${slug}): ${abs} does not exist.`);
        }
        // Contributor-only unless marked public (business decision Q22).
        files.push({ path: abs, public: file.public === true });
      });
    }

    pathways.push({
      slug,
      title: typeof e.title === 'string' ? e.title.trim() : '',
      sector: typeof e.sector === 'string' ? e.sector.trim() : '',
      organisation: typeof e.organisation === 'string' ? e.organisation.trim() : '',
      files,
    });
  });

  return { manifest: errors.length ? null : { pathways }, errors };
}

// src-01, src-02, … — the keys the generated Source Trace rows start with,
// so each unit's source_ids point at stored originals.
export function sourceKey(index: number): string {
  return `src-${String(index + 1).padStart(2, '0')}`;
}

export function storagePath(slug: string, key: string, fileName: string): string {
  const safe = fileName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // accents → plain letters
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-120);
  return `${slug}/${key}-${safe}`;
}

// Cuts text into passages of at most `size` characters (~400 tokens at
// 1,600), breaking at a paragraph or sentence where it can, with `overlap`
// characters carried into the next passage so no sentence is lost at a seam.
// gte-small reads ~512 tokens, so passages stay under that.
export function chunkText(text: string, size = 1600, overlap = 200): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const para = window.lastIndexOf('\n\n');
      const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n'));
      const cut = para > size * 0.5 ? para : sentence > size * 0.5 ? sentence + 1 : -1;
      if (cut > 0) end = start + cut;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
