import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createSupabaseMock, type MockResponse, type SupabaseMock } from '../../helpers/supabase-mock';
import { getRequest, jsonRequest } from '../../helpers/request';
import { assetId, memberTable, routeOps, sessionMock } from '../../helpers/routes-auth';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { MAX_ASSET_BYTES } from '@/lib/toolkit-assets';
import { GENERIC_ERROR_MESSAGE } from '@/lib/error-messages';
import { GET, POST } from '@/app/api/toolkit-assets/route';

const URL = 'http://localhost/api/toolkit-assets';

let admin: SupabaseMock;
let session: SupabaseMock;

function useAdmin(units: MockResponse = {}) {
  admin = createSupabaseMock({ tables: { contribution_units: units } });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

function signIn(
  user: { id: string; email: string } | null = { id: 'u1', email: 'c@example.com' },
  roles: string[] = ['adopter', 'pathway_contributor'],
  memberOf: string[] = ['p1'],
  design: MockResponse = { data: { id: 'd1', pathway_id: 'p1' } }
) {
  session = sessionMock(user, roles, { pathway_contributors: memberTable(memberOf), designs: design });
  vi.mocked(createClient).mockResolvedValue(session.client);
}

beforeEach(() => {
  useAdmin();
  signIn();
});

// ---------------------------------------------------------------------------
// GET — public card metadata
// ---------------------------------------------------------------------------

describe('GET /api/toolkit-assets', () => {
  const id1 = assetId();
  const id2 = assetId();
  const row = {
    unit_internal_id: id1,
    pathway_id: 'p1',
    user_id: 'u1',
    asset_kind: 'file',
    asset_name: 'Call script',
    purpose: 'Used by agents',
    reuse_condition: 'Credit us',
    storage_path: 'p1/secret/a.pdf',
    file_name: 'a.pdf',
    mime_type: 'application/pdf',
    size_bytes: 1234,
    link_url: null,
    published_at: '2026-03-01T00:00:00Z',
    created_at: '2026-02-01T00:00:00Z',
    pathways: { slug: 'farmer-bot', title: 'Farmer Bot' },
  };

  function get(ids?: string) {
    const qs = ids === undefined ? '' : `?ids=${encodeURIComponent(ids)}`;
    return GET(new NextRequest(getRequest(`${URL}${qs}`)));
  }

  it('is public — no session needed — and never returns a storage path or URL', async () => {
    useAdmin({ data: [row] });
    vi.mocked(createClient).mockClear();
    const res = await get(id1);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      assets: [
        {
          id: id1,
          name: 'Call script',
          purpose: 'Used by agents',
          kind: 'file',
          fileName: 'a.pdf',
          sizeBytes: 1234,
          linkDomain: null,
          pathwaySlug: 'farmer-bot',
          pathwayTitle: 'Farmer Bot',
          publishedAt: '2026-03-01T00:00:00Z',
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain('p1/secret');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('only ever asks for published toolkit assets', async () => {
    await get(id1);
    const [op] = admin.ops('contribution_units', 'select');
    expect(op.filters).toContainEqual(['eq', 'unit_type', 'toolkit-asset']);
    expect(op.filters).toContainEqual(['not', 'published_at', 'is', null]);
    expect(op.filters).toContainEqual(['in', 'unit_internal_id', [id1]]);
  });

  it('drops malformed ids, de-duplicates, and caps at 20', async () => {
    const many = Array.from({ length: 25 }, () => assetId());
    await get([id1, id1, 'asset-../../etc', "x');drop table", id2, ...many].join(','));
    const [op] = admin.ops('contribution_units', 'select');
    const inFilter = op.filters.find((f) => f[0] === 'in')!;
    const ids = inFilter[2] as string[];
    expect(ids).toHaveLength(20);
    expect(ids.slice(0, 2)).toEqual([id1, id2]);
    expect(new Set(ids).size).toBe(20);
  });

  it.each([undefined, '', 'nonsense,asset-1'])('answers an empty list without querying for ids=%j', async (ids) => {
    const res = await get(ids);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ assets: [] });
    expect(routeOps(admin)).toHaveLength(0);
  });

  it('answers an empty list when the lookup fails', async () => {
    useAdmin({ error: { message: 'relation does not exist' } });
    const res = await get(id1);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ assets: [] });
  });
});

// ---------------------------------------------------------------------------
// POST — register a shared asset
// ---------------------------------------------------------------------------

const FILE_BODY = {
  pathwayId: 'p1',
  shareConsent: true,
  name: '  Call   script  ',
  kind: 'file',
  storagePath: 'p1/uuid-1/call-script.pdf',
  fileName: 'call-script.pdf',
  purpose: 'Used by agents',
  reuseCondition: 'Credit the state',
  dimension: 'Solution',
  stage: 'PILOT',
  designId: 'd1',
};

const LINK_BODY = {
  pathwayId: 'p1',
  shareConsent: true,
  name: 'Dashboard',
  kind: 'link',
  linkUrl: 'https://example.org/dashboard',
};

function post(body: unknown) {
  return POST(new NextRequest(jsonRequest(URL, body)));
}

describe('POST /api/toolkit-assets — access', () => {
  it('401s an anonymous caller', async () => {
    signIn(null);
    const res = await post(FILE_BODY);
    expect(res.status).toBe(401);
    expect(routeOps(admin)).toHaveLength(0);
  });

  it('403s a plain adopter (no contributor role)', async () => {
    signIn(undefined, ['adopter']);
    const res = await post(FILE_BODY);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Contributor role required' });
    expect(routeOps(admin)).toHaveLength(0);
  });

  it('403s an admin who is not a contributor (writes are contributor-only)', async () => {
    signIn({ id: 'a1', email: 'env-admin@example.com' }, ['adopter', 'admin'], []);
    const res = await post(FILE_BODY);
    expect(res.status).toBe(403);
  });

  it('403s a contributor who is not a member of this pathway', async () => {
    signIn(undefined, undefined, ['other-pathway']);
    const res = await post(FILE_BODY);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Not a contributor to this pathway' });
    expect(routeOps(admin)).toHaveLength(0);
  });

  it.each([
    ['missing', undefined],
    ['numeric', 7],
    ['empty', ''],
  ])('400s a %s pathwayId', async (_label, pathwayId) => {
    const res = await post({ ...FILE_BODY, pathwayId });
    expect(res.status).toBe(400);
  });

  it('checks membership for the caller and the requested pathway', async () => {
    await post(FILE_BODY);
    const [op] = session.ops('pathway_contributors', 'select');
    expect(op.filters).toEqual([
      ['eq', 'pathway_id', 'p1'],
      ['eq', 'user_id', 'u1'],
    ]);
  });
});

describe('POST /api/toolkit-assets — validation', () => {
  it.each([
    ['missing', undefined],
    ['false', false],
    ['the string "true"', 'true'],
  ])('400s when shareConsent is %s', async (_label, shareConsent) => {
    const res = await post({ ...FILE_BODY, shareConsent });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Public-sharing consent is required.' });
    expect(routeOps(admin)).toHaveLength(0);
  });

  it.each([['missing', undefined], ['blank', '   '], ['non-string', 42]])('400s a %s name', async (_label, name) => {
    const res = await post({ ...FILE_BODY, name });
    expect(res.status).toBe(400);
  });

  it.each([['missing', undefined], ['unknown', 'zip']])('400s a %s kind', async (_label, kind) => {
    const res = await post({ ...FILE_BODY, kind });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'kind must be file or link' });
  });

  it.each([
    ['another pathway\'s prefix', { storagePath: 'p2/uuid/a.pdf' }],
    ['a prefix-lookalike pathway', { storagePath: 'p10/uuid/a.pdf' }],
    ['a traversal', { storagePath: 'p1/../p2/uuid/a.pdf' }],
    ['no storage path', { storagePath: undefined }],
    ['a disallowed extension', { fileName: 'payload.exe' }],
    ['a zip', { fileName: 'bundle.zip' }],
    ['no extension', { fileName: 'README' }],
  ])('400s a file with %s', async (_label, patch) => {
    const res = await post({ ...FILE_BODY, ...patch });
    expect(res.status).toBe(400);
    expect(admin.ops('contribution_units', 'insert')).toHaveLength(0);
    expect(admin.storageBucket.info).not.toHaveBeenCalled();
  });

  it('400s when the uploaded object is not in storage', async () => {
    admin.storageBucket.info.mockResolvedValueOnce({ data: null, error: { message: 'Object not found' } } as never);
    const res = await post(FILE_BODY);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Uploaded file not found.' });
  });

  it('400s a stored object over MAX_ASSET_BYTES (the real size, not the client\'s claim)', async () => {
    admin.storageBucket.info.mockResolvedValueOnce({ data: { size: MAX_ASSET_BYTES + 1 }, error: null } as never);
    const res = await post({ ...FILE_BODY, size: 10 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'File is over 25 MB.' });
    expect(admin.ops('contribution_units', 'insert')).toHaveLength(0);
  });

  it('accepts a stored object of exactly MAX_ASSET_BYTES', async () => {
    admin.storageBucket.info.mockResolvedValueOnce({ data: { size: MAX_ASSET_BYTES }, error: null } as never);
    const res = await post(FILE_BODY);
    expect(res.status).toBe(201);
  });

  it.each([
    ['plain http', 'http://example.org/x'],
    ['javascript:', 'javascript:alert(1)'],
    ['not a URL', 'example.org/x'],
    ['over 2000 chars', `https://example.org/${'a'.repeat(2000)}`],
    ['missing', undefined],
  ])('400s a link that is %s', async (_label, linkUrl) => {
    const res = await post({ ...LINK_BODY, linkUrl });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Links must be valid https:// URLs.' });
  });
});

describe('POST /api/toolkit-assets — happy path', () => {
  it('registers a file as an unpublished, consented contribution_units row', async () => {
    const res = await post(FILE_BODY);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ id: expect.stringMatching(/^asset-[0-9a-f-]{36}$/), status: 'awaiting_pathway_review' });

    expect(admin.storageBucket.info).toHaveBeenCalledWith('p1/uuid-1/call-script.pdf');
    const [insert] = admin.ops('contribution_units', 'insert');
    expect(insert.payload).toEqual({
      unit_internal_id: body.id,
      pathway_id: 'p1',
      design_id: 'd1',
      user_id: 'u1',
      section: 'micro-innovation',
      unit_type: 'toolkit-asset',
      dimension: 'solution',
      stage: 'pilot',
      asset_name: 'Call script',
      purpose: 'Used by agents',
      reuse_condition: 'Credit the state',
      share_consent: true,
      share_consented_at: expect.any(String),
      asset_kind: 'file',
      storage_path: 'p1/uuid-1/call-script.pdf',
      file_name: 'call-script.pdf',
      mime_type: 'application/pdf',
      size_bytes: 4,
      source_doc: 'call-script.pdf',
    });
    expect(insert.payload).not.toHaveProperty('published_at');
  });

  it('registers a link asset', async () => {
    const res = await post(LINK_BODY);
    expect(res.status).toBe(201);
    const [insert] = admin.ops('contribution_units', 'insert');
    expect(insert.payload).toMatchObject({
      asset_kind: 'link',
      link_url: 'https://example.org/dashboard',
      source_doc: 'https://example.org/dashboard',
      design_id: null,
      dimension: null,
      stage: null,
      purpose: null,
      reuse_condition: null,
    });
    expect(admin.storageBucket.info).not.toHaveBeenCalled();
  });

  it('ignores client-supplied identity, publication and MIME fields', async () => {
    await post({ ...FILE_BODY, user_id: 'victim', userId: 'victim', published_at: '2026-01-01', mimeType: 'text/html' });
    const [insert] = admin.ops('contribution_units', 'insert');
    expect(insert.payload).toMatchObject({ user_id: 'u1', mime_type: 'application/pdf' });
    expect(insert.payload).not.toHaveProperty('published_at');
  });

  it('drops a designId from another pathway', async () => {
    signIn(undefined, undefined, undefined, { data: { id: 'd9', pathway_id: 'p2' } });
    await post({ ...FILE_BODY, designId: 'd9' });
    expect(admin.ops('contribution_units', 'insert')[0].payload).toMatchObject({ design_id: null });
  });

  it('drops a designId the caller cannot see (someone else\'s workspace)', async () => {
    signIn(undefined, undefined, undefined, { data: null });
    await post({ ...FILE_BODY, designId: 'theirs' });
    expect(admin.ops('contribution_units', 'insert')[0].payload).toMatchObject({ design_id: null });
  });

  it('nulls an unknown dimension or stage and caps long text', async () => {
    await post({ ...FILE_BODY, dimension: 'galaxy', stage: 'launch', name: 'n'.repeat(500), purpose: 'p'.repeat(5000) });
    const payload = admin.ops('contribution_units', 'insert')[0].payload as Record<string, string | null>;
    expect(payload.dimension).toBeNull();
    expect(payload.stage).toBeNull();
    expect(payload.asset_name).toHaveLength(200);
    expect(payload.purpose).toHaveLength(1000);
  });

  it('strips path components from the display file name', async () => {
    await post({ ...FILE_BODY, fileName: 'C:\\Users\\me\\..\\deck.pdf' });
    expect(admin.ops('contribution_units', 'insert')[0].payload).toMatchObject({ file_name: 'deck.pdf' });
  });

  it('answers an insert failure with the generic 500', async () => {
    useAdmin({ error: { message: 'duplicate key value violates unique constraint "contribution_units_pkey"' } });
    const res = await post(FILE_BODY);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: GENERIC_ERROR_MESSAGE });
  });

  it('treats a malformed JSON body as empty (401/403/400, never 500)', async () => {
    const res = await post('{not json');
    expect(res.status).toBe(400);
  });
});
