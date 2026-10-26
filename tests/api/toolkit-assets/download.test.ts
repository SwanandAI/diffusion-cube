import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { NextRequest } from 'next/server';
import { createSupabaseMock, type SupabaseMock } from '../../helpers/supabase-mock';
import { getRequest, routeParams } from '../../helpers/request';
import { assetId, routeOps, sessionMock } from '../../helpers/routes-auth';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { GET } from '@/app/api/toolkit-assets/[id]/download/route';

const ID = assetId();
const SIGNED = 'https://storage.test/object/sign/toolkit-assets/p1/x/a.pdf?token=secret-token';

let admin: SupabaseMock;
let fetchSpy: MockInstance<typeof fetch>;

function download(id = ID, query = '') {
  const req = new NextRequest(getRequest(`http://localhost/api/toolkit-assets/${encodeURIComponent(id)}/download${query}`));
  return GET(req, routeParams({ id }));
}

function assetRow(overrides: Record<string, unknown> = {}) {
  return {
    unit_internal_id: ID,
    pathway_id: 'p1',
    user_id: 'uploader',
    asset_kind: 'file',
    asset_name: 'Call script',
    storage_path: 'p1/x/a.pdf',
    file_name: 'Call script.pdf',
    mime_type: 'application/pdf',
    size_bytes: 4,
    link_url: null,
    published_at: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

function useAsset(row: Record<string, unknown> | null) {
  admin = createSupabaseMock({ tables: { contribution_units: { data: row } } });
  admin.storageBucket.createSignedUrl.mockResolvedValue({ data: { signedUrl: SIGNED }, error: null } as never);
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

function signIn(user: { id: string; email: string } | null, roles: string[] = ['adopter']) {
  vi.mocked(createClient).mockResolvedValue(sessionMock(user, roles).client);
}

beforeEach(() => {
  useAsset(assetRow());
  signIn(null);
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response('%PDF', { status: 200, headers: { 'content-length': '4' } }));
});

function exposesStorage(res: Response) {
  const headers = JSON.stringify([...res.headers.entries()]);
  return headers.includes('storage.test') || headers.includes('secret-token');
}

describe('GET /api/toolkit-assets/[id]/download — who can download', () => {
  it.each([
    ['not an asset id', 'abc'],
    ['a traversal', '../../etc/passwd'],
    ['an injection attempt', `${ID}' or '1'='1`],
  ])('404s %s without a lookup', async (_label, id) => {
    const res = await download(id);
    expect(res.status).toBe(404);
    expect(routeOps(admin)).toHaveLength(0);
  });

  it('404s an unknown id', async () => {
    useAsset(null);
    const res = await download();
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('only looks up toolkit-asset rows', async () => {
    await download();
    const [op] = admin.ops('contribution_units', 'select');
    expect(op.filters).toEqual([
      ['eq', 'unit_type', 'toolkit-asset'],
      ['eq', 'unit_internal_id', ID],
    ]);
  });

  it('streams a published asset to an anonymous visitor', async () => {
    const res = await download();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('%PDF');
    expect(admin.storageBucket.createSignedUrl).toHaveBeenCalledWith('p1/x/a.pdf', 60);
    expect(fetchSpy).toHaveBeenCalledWith(SIGNED, { cache: 'no-store' });
  });

  it('404s an unpublished asset to an anonymous visitor (same as a missing id)', async () => {
    useAsset(assetRow({ published_at: null }));
    const res = await download();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('404s an unpublished asset to a signed-in non-owner, even a contributor', async () => {
    useAsset(assetRow({ published_at: null }));
    signIn({ id: 'someone', email: 's@example.com' }, ['adopter', 'pathway_contributor']);
    const res = await download();
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('serves an unpublished asset to its uploader (preview)', async () => {
    useAsset(assetRow({ published_at: null }));
    signIn({ id: 'uploader', email: 'up@example.com' }, ['adopter', 'pathway_contributor']);
    expect((await download()).status).toBe(200);
  });

  it('serves an unpublished asset to an ADMIN_EMAILS admin (review)', async () => {
    useAsset(assetRow({ published_at: null }));
    signIn({ id: 'a1', email: 'env-admin@example.com' }, ['adopter']);
    expect((await download()).status).toBe(200);
  });

  it('serves an unpublished asset to an admin role row (review)', async () => {
    useAsset(assetRow({ published_at: null }));
    signIn({ id: 'a2', email: 'db-admin@example.com' }, ['adopter', 'admin']);
    expect((await download()).status).toBe(200);
  });
});

describe('GET /api/toolkit-assets/[id]/download — response', () => {
  it('sends it as an attachment, never exposing the storage URL', async () => {
    const res = await download();
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="Call script.pdf"; filename*=UTF-8''Call%20script.pdf`
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-length')).toBe('4');
    expect(res.headers.get('location')).toBeNull();
    expect(exposesStorage(res)).toBe(false);
  });

  it('keeps a non-ASCII / quote-laden file name safe in Content-Disposition', async () => {
    useAsset(assetRow({ file_name: 'résumé "final".pdf' }));
    const res = await download();
    const cd = res.headers.get('content-disposition')!;
    expect(cd).toContain('filename="r_sum_ _final_.pdf"');
    expect(cd).toContain(`filename*=UTF-8''${encodeURIComponent('résumé "final".pdf')}`);
  });

  it('falls back to octet-stream and a generic name when the row lacks them', async () => {
    useAsset(assetRow({ file_name: null, mime_type: null }));
    const res = await download();
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toContain('filename="toolkit-asset"');
  });

  it('previews a PDF inline, without a sandbox CSP (it would block the PDF viewer)', async () => {
    const res = await download(ID, '?preview=1');
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it.each(['notes.md', 'data.csv', 'page.txt'])('previews %s as sandboxed plain text, never as a page', async (fileName) => {
    useAsset(assetRow({ file_name: fileName, mime_type: 'text/markdown' }));
    const res = await download(ID, '?preview=1');
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('content-security-policy')).toBe('sandbox');
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/);
  });

  it('previews an image inline under a sandbox CSP', async () => {
    useAsset(assetRow({ file_name: 'chart.png', mime_type: 'image/png' }));
    const res = await download(ID, '?preview=1');
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-security-policy')).toBe('sandbox');
  });

  it('still downloads an Office file when a preview is asked for', async () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    useAsset(assetRow({ file_name: 'plan.docx', mime_type: docx }));
    const res = await download(ID, '?preview=1');
    expect(res.headers.get('content-type')).toBe(docx);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
  });

  it('ignores preview values other than 1', async () => {
    const res = await download(ID, '?preview=true');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
  });

  it('redirects a link asset to its own https URL', async () => {
    useAsset(assetRow({ asset_kind: 'link', storage_path: null, file_name: null, link_url: 'https://example.org/dash' }));
    const res = await download();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.org/dash');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['http', 'http://example.org/dash'],
    ['javascript', 'javascript:alert(1)'],
    ['missing', null],
  ])('404s a link asset whose URL is %s', async (_label, link_url) => {
    useAsset(assetRow({ asset_kind: 'link', storage_path: null, link_url }));
    const res = await download();
    expect(res.status).toBe(404);
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('GET /api/toolkit-assets/[id]/download — storage failures', () => {
  it('404s with a clear message when the file row has no storage path', async () => {
    useAsset(assetRow({ storage_path: null }));
    const res = await download();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'This file is no longer available.' });
  });

  it('404s when the signed URL cannot be minted, leaking nothing', async () => {
    admin.storageBucket.createSignedUrl.mockResolvedValueOnce({
      data: null,
      error: { message: 'Object not found in bucket toolkit-assets' },
    } as never);
    const res = await download();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'This file is no longer available.' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('404s when the storage fetch fails', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('denied', { status: 403 }));
    const res = await download();
    expect(res.status).toBe(404);
    expect(exposesStorage(res)).toBe(false);
  });
});
