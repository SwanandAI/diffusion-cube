// Client-side text extraction — runs entirely in the browser so uploaded
// documents never need to hit a server route or hit Vercel's request-size limits.
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

// Legacy binary Office formats (.doc, .ppt — pre-2007 OLE Compound File
// format) aren't supported; only the modern XML-based .docx/.pptx are.
const TEXT_EXTENSIONS = ['pdf', 'txt', 'md', 'docx', 'xlsx', 'xls', 'pptx'];
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

// The file pickers' accept lists. The contributor flow also takes the
// toolkit-asset-only types (.doc, .ppt, .csv): those can't be read as text
// here, but can still be kept as an asset file (see lib/toolkit-assets.ts
// and handleAttachFiles in lib/adoption-conversation.ts). Still no ZIP.
export const ATTACH_ACCEPT = '.pdf,.docx,.xlsx,.xls,.pptx,.txt,.md,.png,.jpg,.jpeg,.gif,.webp';
export const CONTRIBUTOR_ATTACH_ACCEPT = `${ATTACH_ACCEPT},.doc,.ppt,.csv`;

const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;
// Anthropic's per-image base64 payload limit.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function getFileExtension(fileName: string): string | null {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  return [...TEXT_EXTENSIONS, ...IMAGE_EXTENSIONS].includes(ext) ? ext : null;
}

export function isImageFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.includes(ext);
}

async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pageTexts.push(
      content.items.map((item) => ('str' in item ? item.str : '')).join(' ')
    );
  }
  return pageTexts.join('\n\n').trim();
}

async function extractDocxText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer: buffer });
  return value.trim();
}

async function extractSpreadsheetText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  return workbook.SheetNames.map((name) => {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
    return `Sheet: ${name}\n${csv}`;
  })
    .join('\n\n')
    .trim();
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function extractPptxText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = Number(a.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      const numB = Number(b.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      return numA - numB;
    });

  const slideTexts = await Promise.all(
    slideFiles.map(async (name, i) => {
      const xml = await zip.files[name].async('text');
      const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1]));
      return `Slide ${i + 1}:\n${texts.join(' ')}`;
    })
  );

  return slideTexts.join('\n\n').trim();
}

export async function extractTextFromFile(file: File): Promise<string> {
  const ext = getFileExtension(file.name);
  if (!ext || !TEXT_EXTENSIONS.includes(ext)) {
    throw new Error('This file type is sent as an image, not read as text.');
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new Error('File is too large — please upload something under 100MB.');
  }
  switch (ext) {
    case 'pdf':
      return extractPdfText(file);
    case 'docx':
      return extractDocxText(file);
    case 'xlsx':
    case 'xls':
      return extractSpreadsheetText(file);
    case 'pptx':
      return extractPptxText(file);
    default:
      return (await file.text()).trim();
  }
}

export async function fileToImageBlock(file: File): Promise<{ mediaType: string; base64: string }> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('Image is too large — please upload something under 5MB.');
  }
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return { mediaType: file.type || 'image/png', base64: btoa(binary) };
}
