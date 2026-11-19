import { beforeEach, describe, expect, it, vi } from 'vitest';

const upload = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn(() => ({ uploadToSignedUrl: upload })));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ storage: { from } }) }));

import { keepOriginalDocument, KEEP_ATTEMPTS } from '@/lib/keep-original-document';

const fetchMock = vi.fn();
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
const file = (size = 10) => new File(['x'.repeat(size)], 'Vendor Eval.pdf', { type: 'application/pdf' });
const INPUT = { pathwayId: 'p1', designId: 'd1', text: 'We chose Vendor X.' };
const FAST = { retryDelayMs: 0 };

function bodies(url: string) {
  return fetchMock.mock.calls.filter((c) => c[0] === url).map((c) => JSON.parse(c[1].body));
}

beforeEach(() => {
  fetchMock.mockReset();
  upload.mockReset();
  from.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('keepOriginalDocument', () => {
  it('uploads the file to its signed URL, then records it with its text', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/upload-url') ? json(200, { path: 'contrib/p1/a-Vendor Eval.pdf', token: 't' }) : json(200, { id: 's1' })
    );
    upload.mockResolvedValue({ error: null });
    expect(await keepOriginalDocument({ ...INPUT, file: file() }, FAST)).toBe(true);
    expect(from).toHaveBeenCalledWith('pathway-sources');
    expect(upload).toHaveBeenCalledWith('contrib/p1/a-Vendor Eval.pdf', 't', expect.any(File), { contentType: 'application/pdf' });
    expect(bodies('/api/pathway-sources')).toEqual([{
      pathwayId: 'p1', designId: 'd1', fileName: 'Vendor Eval.pdf', mimeType: 'application/pdf',
      storagePath: 'contrib/p1/a-Vendor Eval.pdf', text: 'We chose Vendor X.',
    }]);
  });

  it('retries twice on a server error, without uploading the file again', async () => {
    let records = 0;
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/upload-url') ? json(200, { path: 'p', token: 't' }) : ++records < 3 ? json(503) : json(200)
    );
    upload.mockResolvedValue({ error: null });
    expect(await keepOriginalDocument({ ...INPUT, file: file() }, FAST)).toBe(true);
    expect(records).toBe(3);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('gives up after the first try and 2 retries', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/upload-url') ? json(200, { path: 'p', token: 't' }) : json(500)));
    upload.mockResolvedValue({ error: null });
    expect(KEEP_ATTEMPTS).toBe(3);
    expect(await keepOriginalDocument({ ...INPUT, file: file() }, FAST)).toBe(false);
    expect(bodies('/api/pathway-sources')).toHaveLength(3);
  });

  it('does not retry a refusal', async () => {
    fetchMock.mockResolvedValue(json(403, { error: 'Not a contributor to this pathway' }));
    expect(await keepOriginalDocument({ ...INPUT, file: file() }, FAST)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the text without the file when the upload keeps failing', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/upload-url') ? json(200, { path: 'p', token: 't' }) : json(200)));
    upload.mockResolvedValue({ error: { message: 'storage down' } });
    expect(await keepOriginalDocument({ ...INPUT, file: file() }, FAST)).toBe(true);
    expect(upload).toHaveBeenCalledTimes(KEEP_ATTEMPTS);
    expect(bodies('/api/pathway-sources')[0].storagePath).toBeNull();
  });

  it('keeps a file over 50 MB as text only, without asking for an upload URL', async () => {
    fetchMock.mockResolvedValue(json(200));
    const big = file(1);
    Object.defineProperty(big, 'size', { value: 60 * 1024 * 1024 });
    expect(await keepOriginalDocument({ ...INPUT, file: big }, FAST)).toBe(true);
    expect(bodies('/api/pathway-sources/upload-url')).toHaveLength(0);
    expect(bodies('/api/pathway-sources')[0].storagePath).toBeNull();
  });
});
