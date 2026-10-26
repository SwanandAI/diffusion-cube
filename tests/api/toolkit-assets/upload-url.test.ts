import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createSupabaseMock, type SupabaseMock } from '../../helpers/supabase-mock';
import { jsonRequest } from '../../helpers/request';
import { memberTable, sessionMock } from '../../helpers/routes-auth';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { MAX_ASSET_BYTES } from '@/lib/toolkit-assets';
import { GENERIC_ERROR_MESSAGE } from '@/lib/error-messages';
import { POST } from '@/app/api/toolkit-assets/upload-url/route';

const URL = 'http://localhost/api/toolkit-assets/upload-url';
const BODY = { pathwayId: 'p1', fileName: 'Call Script.pdf', size: 1024 };

let admin: SupabaseMock;

function post(body: unknown) {
  return POST(new NextRequest(jsonRequest(URL, body)));
}

function signIn(
  user: { id: string; email: string } | null = { id: 'u1', email: 'c@example.com' },
  roles: string[] = ['adopter', 'pathway_contributor'],
  memberOf: string[] = ['p1']
) {
  vi.mocked(createClient).mockResolvedValue(
    sessionMock(user, roles, { pathway_contributors: memberTable(memberOf) }).client
  );
}

beforeEach(() => {
  admin = createSupabaseMock();
  admin.storageBucket.createSignedUploadUrl.mockImplementation((async (path: string) => ({
    data: { signedUrl: `https://storage.test/upload/${path}?token=t`, token: 'upload-token', path },
    error: null,
  })) as never);
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
  signIn();
});

describe('POST /api/toolkit-assets/upload-url — access', () => {
  it('401s an anonymous caller', async () => {
    signIn(null);
    const res = await post(BODY);
    expect(res.status).toBe(401);
    expect(admin.storageBucket.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('403s a plain adopter', async () => {
    signIn(undefined, ['adopter']);
    const res = await post(BODY);
    expect(res.status).toBe(403);
    expect(admin.storageBucket.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('403s an admin who is not a contributor', async () => {
    signIn({ id: 'a1', email: 'env-admin@example.com' }, ['adopter', 'admin'], []);
    const res = await post(BODY);
    expect(res.status).toBe(403);
  });

  it('403s a contributor on another pathway', async () => {
    signIn(undefined, undefined, ['p2']);
    const res = await post(BODY);
    expect(res.status).toBe(403);
    expect(admin.storageBucket.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('400s a missing pathwayId', async () => {
    const res = await post({ ...BODY, pathwayId: undefined });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/toolkit-assets/upload-url — validation', () => {
  it.each([['missing', undefined], ['blank', '   '], ['numeric', 5]])('400s a %s fileName', async (_l, fileName) => {
    const res = await post({ ...BODY, fileName });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'fileName required' });
  });

  it.each(['setup.exe', 'bundle.zip', 'page.html', 'script.js', 'README', 'image.svg'])(
    '400s the file type of %s',
    async (fileName) => {
      const res = await post({ ...BODY, fileName });
      expect(res.status).toBe(400);
      expect(admin.storageBucket.createSignedUploadUrl).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['missing', undefined],
    ['zero', 0],
    ['negative', -1],
    ['a string', '1024'],
    ['one byte over the limit', MAX_ASSET_BYTES + 1],
    ['NaN-ish', null],
  ])('400s a size that is %s', async (_label, size) => {
    const res = await post({ ...BODY, size });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Toolkit asset files must be under 25 MB.' });
    expect(admin.storageBucket.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('accepts a file of exactly MAX_ASSET_BYTES', async () => {
    const res = await post({ ...BODY, size: MAX_ASSET_BYTES });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/toolkit-assets/upload-url — signed URL flow', () => {
  it('mints a one-time upload URL under a server-built path in this pathway\'s prefix', async () => {
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect(admin.client.storage.from).toHaveBeenCalledWith('toolkit-assets');
    const [path] = admin.storageBucket.createSignedUploadUrl.mock.calls[0] as unknown as [string];
    expect(path).toMatch(/^p1\/[0-9a-f-]{36}\/Call Script\.pdf$/);

    const body = await res.json();
    expect(body).toEqual({ path, token: 'upload-token', contentType: 'application/pdf' });
    // The full signed URL never leaves the server.
    expect(body).not.toHaveProperty('signedUrl');
  });

  it('gives each upload its own path', async () => {
    await post(BODY);
    await post(BODY);
    const [[a], [b]] = admin.storageBucket.createSignedUploadUrl.mock.calls as unknown as [string][];
    expect(a).not.toBe(b);
  });

  it.each([
    ['a traversal', '../../p2/evil.pdf'],
    ['a Windows path', 'C:\\Users\\me\\..\\p2\\deck.pdf'],
    ['dots', '...pdf.pdf'],
  ])('keeps a file name with %s inside the pathway prefix', async (_label, fileName) => {
    const res = await post({ ...BODY, fileName });
    expect(res.status).toBe(200);
    const [path] = admin.storageBucket.createSignedUploadUrl.mock.calls[0] as unknown as [string];
    expect(path.startsWith('p1/')).toBe(true);
    expect(path).not.toContain('..');
    expect(path.split('/')).toHaveLength(3);
  });

  it('picks the content type from the extension, not the client', async () => {
    const res = await post({ ...BODY, fileName: 'notes.MD', contentType: 'text/html' });
    expect((await res.json()).contentType).toBe('text/markdown');
  });

  it('answers a storage failure with the generic 500, no storage text leaked', async () => {
    admin.storageBucket.createSignedUploadUrl.mockResolvedValueOnce({
      data: null,
      error: { message: 'Bucket not found: toolkit-assets @ supabase.internal' },
    } as never);
    const res = await post(BODY);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: GENERIC_ERROR_MESSAGE });
  });
});
