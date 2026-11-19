import { createClient } from '@/lib/supabase/client';
import { MAX_SOURCE_FILE_BYTES, MAX_SOURCE_TEXT_CHARS, SOURCES_BUCKET } from '@/lib/pathway-sources';

// Browser side of keeping a contributor's original document (migration
// 0043): upload the file to a signed URL, then record it with its extracted
// text (app/api/pathway-sources). Runs in the background after the message
// is sent — it never blocks or fails the chat. Tries up to 3 times (the
// first try + 2 retries) on a network or server error; a refusal (not a
// contributor, wrong workspace) is not retried. A file the bucket can't take
// (over 50 MB, or its upload keeps failing) is still kept as text.

export const KEEP_ATTEMPTS = 3;

class Refused extends Error {}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function failed(res: Response, step: string): Error {
  return res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429
    ? new Refused(`${step}: ${res.status}`)
    : new Error(`${step}: ${res.status}`);
}

export async function keepOriginalDocument(
  input: { file: File; text: string; pathwayId: string; designId: string },
  options: { retryDelayMs?: number } = {}
): Promise<boolean> {
  const delay = options.retryDelayMs ?? 1500;
  const text = input.text.slice(0, MAX_SOURCE_TEXT_CHARS);
  // Once the file is in storage, a retry only re-sends the record.
  let storagePath: string | null = null;
  let fileDone = input.file.size <= 0 || input.file.size > MAX_SOURCE_FILE_BYTES;

  for (let attempt = 1; attempt <= KEEP_ATTEMPTS; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, delay * (attempt - 1)));
    try {
      if (!fileDone) {
        const urlRes = await postJson('/api/pathway-sources/upload-url', {
          pathwayId: input.pathwayId,
          fileName: input.file.name,
          size: input.file.size,
        });
        if (urlRes.status === 413) {
          fileDone = true;
        } else {
          if (!urlRes.ok) throw failed(urlRes, 'upload-url');
          const upload = (await urlRes.json()) as { path: string; token: string };
          const { error } = await createClient()
            .storage.from(SOURCES_BUCKET)
            .uploadToSignedUrl(upload.path, upload.token, input.file, input.file.type ? { contentType: input.file.type } : undefined);
          if (error) {
            // The last try keeps the text without the file.
            if (attempt < KEEP_ATTEMPTS) throw error;
          } else {
            storagePath = upload.path;
          }
          fileDone = true;
        }
      }

      const res = await postJson('/api/pathway-sources', {
        pathwayId: input.pathwayId,
        designId: input.designId,
        fileName: input.file.name,
        mimeType: input.file.type || null,
        storagePath,
        text,
      });
      if (!res.ok) throw failed(res, 'pathway-sources');
      return true;
    } catch (err) {
      if (err instanceof Refused || attempt === KEEP_ATTEMPTS) {
        console.error('[pathway-sources] could not keep', input.file.name, err);
        return false;
      }
    }
  }
  return false;
}
