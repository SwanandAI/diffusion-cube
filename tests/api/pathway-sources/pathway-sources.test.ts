import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createSupabaseMock, type SupabaseMock, type TableHandler } from '../../helpers/supabase-mock';
import { jsonRequest } from '../../helpers/request';
import { memberTable, sessionMock } from '../../helpers/routes-auth';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { MAX_SOURCE_FILE_BYTES, MAX_SOURCE_TEXT_CHARS } from '@/lib/pathway-sources';
import { POST as uploadUrl } from '@/app/api/pathway-sources/upload-url/route';
import { GET as listKept, POST as register } from '@/app/api/pathway-sources/route';

let admin: SupabaseMock;
let sourcesTable: TableHandler;

function signIn(
  user: { id: string; email: string } | null = { id: 'u1', email: 'c@example.com' },
  roles: string[] = ['adopter', 'pathway_contributor'],
  memberOf: string[] = ['p1'],
  designPathway: string | null = 'p1'
) {
  vi.mocked(createClient).mockResolvedValue(
    sessionMock(user, roles, {
      pathway_contributors: memberTable(memberOf),
      designs: { data: designPathway ? { id: 'd1', pathway_id: designPathway } : null },
    }).client
  );
}

beforeEach(() => {
  sourcesTable = (op) =>
    op.action === 'insert' ? { data: { id: 'src-row' } } : op.columns === 'source_key' ? { data: [] } : { data: null };
  admin = createSupabaseMock({ tables: { pathway_sources: (op) => (typeof sourcesTable === 'function' ? sourcesTable(op) : sourcesTable) } });
  admin.storageBucket.createSignedUploadUrl.mockImplementation((async (path: string) => ({
    data: { signedUrl: `https://storage.test/upload/${path}`, token: 'upload-token', path },
    error: null,
  })) as never);
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
  signIn();
});

describe('POST /api/pathway-sources/upload-url', () => {
  const post = (body: unknown) => uploadUrl(new NextRequest(jsonRequest('http://localhost/api/pathway-sources/upload-url', body)));
  const BODY = { pathwayId: 'p1', fileName: 'Vendor Eval.pdf', size: 2048 };

  it('returns a signed upload URL under contrib/<pathway>/ in the pathway-sources bucket', async () => {
    const res = await post(BODY);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toMatch(/^contrib\/p1\/[0-9a-f-]{36}-Vendor Eval\.pdf$/);
    expect(body.token).toBe('upload-token');
    expect(admin.client.storage.from).toHaveBeenCalledWith('pathway-sources');
  });

  it.each([
    ['anonymous', () => signIn(null), 401],
    ['a plain adopter', () => signIn(undefined, ['adopter']), 403],
    ['a contributor on another pathway', () => signIn(undefined, undefined, ['p2']), 403],
  ])('refuses %s', async (_l, as, status) => {
    as();
    expect((await post(BODY)).status).toBe(status);
    expect(admin.storageBucket.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('400s a missing file name or size', async () => {
    expect((await post({ ...BODY, fileName: ' ' })).status).toBe(400);
    expect((await post({ ...BODY, size: 0 })).status).toBe(400);
  });

  it('413s a file over the bucket limit (the browser then keeps its text only)', async () => {
    expect((await post({ ...BODY, size: MAX_SOURCE_FILE_BYTES + 1 })).status).toBe(413);
    expect(admin.storageBucket.createSignedUploadUrl).not.toHaveBeenCalled();
  });
});

describe('POST /api/pathway-sources', () => {
  const post = (body: unknown) => register(new NextRequest(jsonRequest('http://localhost/api/pathway-sources', body)));
  const BODY = {
    pathwayId: 'p1', designId: 'd1', fileName: 'Vendor Eval.pdf', mimeType: 'application/pdf',
    storagePath: 'contrib/p1/abc-Vendor Eval.pdf', text: 'We chose Vendor X.',
  };

  it('keeps the document, public and unembedded, credited to the contributor and workspace', async () => {
    const res = await post(BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'src-row', sourceKey: 'src-01', duplicate: false });
    expect(admin.ops('pathway_sources', 'insert')[0].payload).toMatchObject({
      pathway_id: 'p1', design_id: 'd1', uploaded_by: 'u1', origin: 'contributor', is_public: true,
      file_name: 'Vendor Eval.pdf', storage_path: 'contrib/p1/abc-Vendor Eval.pdf', extracted_text: 'We chose Vendor X.',
    });
    expect(admin.ops('pathway_source_chunks')).toHaveLength(0);
  });

  it('keeps a document whose file could not be stored, as text only', async () => {
    const res = await post({ ...BODY, storagePath: null });
    expect(res.status).toBe(200);
    expect(admin.ops('pathway_sources', 'insert')[0].payload).toMatchObject({ storage_path: null });
  });

  it('removes the just-uploaded file of a document already kept', async () => {
    sourcesTable = (op) => (op.columns === 'id, source_key' ? { data: { id: 'old', source_key: 'src-03' } } : {});
    const res = await post(BODY);
    expect(await res.json()).toEqual({ id: 'old', sourceKey: 'src-03', duplicate: true });
    expect(admin.storageBucket.remove).toHaveBeenCalledWith(['contrib/p1/abc-Vendor Eval.pdf']);
  });

  it("403s another user's workspace, or one on a different pathway", async () => {
    signIn(undefined, undefined, ['p1'], null);
    expect((await post(BODY)).status).toBe(403);
    signIn(undefined, undefined, ['p1'], 'p2');
    expect((await post(BODY)).status).toBe(403);
    expect(admin.ops('pathway_sources', 'insert')).toHaveLength(0);
  });

  it('400s a storage path outside this pathway', async () => {
    for (const storagePath of ['contrib/p2/x.pdf', 'p1/x.pdf', 'contrib/p1/../p2/x.pdf']) {
      expect((await post({ ...BODY, storagePath })).status).toBe(400);
    }
    expect(admin.ops('pathway_sources', 'insert')).toHaveLength(0);
  });

  it('400s missing fields and 413s text over the limit', async () => {
    expect((await post({ ...BODY, designId: '' })).status).toBe(400);
    expect((await post({ ...BODY, fileName: '' })).status).toBe(400);
    expect((await post({ ...BODY, text: undefined })).status).toBe(400);
    expect((await post({ ...BODY, text: 'x'.repeat(MAX_SOURCE_TEXT_CHARS + 1) })).status).toBe(413);
  });

  it('refuses a caller who is not a contributor on the pathway', async () => {
    signIn(undefined, ['adopter']);
    expect((await post(BODY)).status).toBe(403);
    signIn(undefined, undefined, ['p2']);
    expect((await post(BODY)).status).toBe(403);
  });
});

describe('GET /api/pathway-sources', () => {
  const get = (q: string) => listKept(new NextRequest(`http://localhost/api/pathway-sources?${q}`));

  it("lists the file names this workspace kept, once each, and nothing else", async () => {
    sourcesTable = { data: [{ file_name: 'a.pdf' }, { file_name: 'b.docx' }, { file_name: 'a.pdf' }] };
    const res = await get('pathwayId=p1&designId=d1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ files: ['a.pdf', 'b.docx'] });
    const [select] = admin.ops('pathway_sources', 'select');
    expect(select.columns).toBe('file_name');
    expect(select.filters).toEqual([['eq', 'pathway_id', 'p1'], ['eq', 'design_id', 'd1'], ['eq', 'origin', 'contributor']]);
  });

  it("refuses another user's workspace, a non-member, or a missing designId", async () => {
    signIn(undefined, undefined, ['p1'], null);
    expect((await get('pathwayId=p1&designId=d1')).status).toBe(403);
    signIn(undefined, undefined, ['p2']);
    expect((await get('pathwayId=p1&designId=d1')).status).toBe(403);
    signIn();
    expect((await get('pathwayId=p1')).status).toBe(400);
    expect(admin.ops('pathway_sources')).toHaveLength(0);
  });
});
