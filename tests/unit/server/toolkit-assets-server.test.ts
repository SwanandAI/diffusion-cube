import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type MockResponse, type QueryOp, type SupabaseMock } from '../../helpers/supabase-mock';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { ASSET_BLOCK_END, ASSET_BLOCK_START, TOOLKIT_ASSET_BUCKET } from '@/lib/toolkit-assets';
import {
  assetObjectSize,
  authorizePathwayContributor,
  buildAssetStoragePath,
  createAssetUploadUrl,
  dropAssetsFromReviewCopy,
  loadPathwayToolkitAssets,
  loadPublishedToolkitAssets,
  loadToolkitAsset,
  openAssetFileStream,
  removeAssetObjects,
  toBlockEntry,
  toSummary,
  type ToolkitAssetRow,
} from '@/lib/toolkit-assets-server';

const ID_A = 'asset-11111111-1111-1111-1111-111111111111';
const ID_B = 'asset-22222222-2222-2222-2222-222222222222';

let admin: SupabaseMock;

function useAdmin(tables: Record<string, MockResponse | ((op: QueryOp) => MockResponse | undefined)> = {}) {
  admin = createSupabaseMock({ tables });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

function row(overrides: Partial<ToolkitAssetRow> = {}): ToolkitAssetRow {
  return {
    unit_internal_id: ID_A,
    pathway_id: 'pw-1',
    user_id: 'u1',
    asset_kind: 'file',
    asset_name: 'Vendor checklist',
    purpose: 'Evaluate vendors',
    reuse_condition: 'Adapt the criteria',
    storage_path: 'pw-1/x/checklist.pdf',
    file_name: 'checklist.pdf',
    mime_type: 'application/pdf',
    size_bytes: 1234,
    link_url: null,
    published_at: '2026-10-01T00:00:00Z',
    created_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => useAdmin());

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('authorizePathwayContributor', () => {
  function session(opts: { user?: { id: string } | null; contributor?: boolean; member?: boolean }) {
    return createSupabaseMock({
      user: opts.user === undefined ? { id: 'u1' } : opts.user,
      tables: {
        user_roles: (op) => {
          const role = op.filters.find((f) => f[0] === 'eq' && f[1] === 'role')?.[2];
          return { data: role === 'pathway_contributor' && opts.contributor ? { role } : null };
        },
        pathway_contributors: { data: opts.member ? { user_id: 'u1' } : null },
      },
    });
  }

  it('401s with no session', async () => {
    const sb = session({ user: null });
    expect(await authorizePathwayContributor(sb.client, 'pw-1')).toEqual({ ok: false, status: 401, error: 'Unauthorized' });
    expect(sb.queryOps).toHaveLength(0);
  });

  it('403s a signed-in user without the pathway_contributor role', async () => {
    const sb = session({ contributor: false, member: true });
    expect(await authorizePathwayContributor(sb.client, 'pw-1')).toEqual({
      ok: false,
      status: 403,
      error: 'Contributor role required',
    });
    expect(sb.ops('pathway_contributors')).toHaveLength(0);
  });

  it.each([undefined, null, '', 42, { id: 'pw-1' }, ['pw-1']])('400s a pathwayId of %j', async (pathwayId) => {
    const sb = session({ contributor: true, member: true });
    expect(await authorizePathwayContributor(sb.client, pathwayId)).toEqual({
      ok: false,
      status: 400,
      error: 'pathwayId required',
    });
  });

  it('403s a contributor who is not a member of this pathway', async () => {
    const sb = session({ contributor: true, member: false });
    expect(await authorizePathwayContributor(sb.client, 'someone-elses')).toEqual({
      ok: false,
      status: 403,
      error: 'Not a contributor to this pathway',
    });
  });

  it('allows a member contributor and checks membership against the session user', async () => {
    const sb = session({ contributor: true, member: true });
    expect(await authorizePathwayContributor(sb.client, 'pw-1')).toEqual({ ok: true, userId: 'u1', pathwayId: 'pw-1' });
    const [membership] = sb.ops('pathway_contributors', 'select');
    expect(membership.filters).toEqual([
      ['eq', 'pathway_id', 'pw-1'],
      ['eq', 'user_id', 'u1'],
    ]);
  });

  it('uses only the caller’s session client, never the admin client', async () => {
    const sb = session({ contributor: true, member: true });
    await authorizePathwayContributor(sb.client, 'pw-1');
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe('loadPublishedToolkitAssets', () => {
  it('returns [] for an empty id list without querying', async () => {
    expect(await loadPublishedToolkitAssets({ ids: [] })).toEqual([]);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('only ever selects published toolkit assets', async () => {
    useAdmin({ contribution_units: { data: [] } });
    await loadPublishedToolkitAssets();
    const [op] = admin.ops('contribution_units', 'select');
    expect(op.columns).toContain('pathways!inner(slug, title)');
    expect(op.filters).toEqual([
      ['eq', 'unit_type', 'toolkit-asset'],
      ['not', 'published_at', 'is', null],
      ['order', 'created_at', { ascending: true }],
    ]);
  });

  it('narrows by ids and pathway slug when given', async () => {
    useAdmin({ contribution_units: { data: [] } });
    await loadPublishedToolkitAssets({ ids: [ID_A], pathwaySlug: 'blue-dots' });
    const [op] = admin.ops('contribution_units', 'select');
    expect(op.filters).toContainEqual(['in', 'unit_internal_id', [ID_A]]);
    expect(op.filters).toContainEqual(['eq', 'pathways.slug', 'blue-dots']);
    expect(op.filters).toContainEqual(['not', 'published_at', 'is', null]);
  });

  it('maps file and link rows to the public shape (no storage path or link URL)', async () => {
    useAdmin({
      contribution_units: {
        data: [
          { ...row(), pathways: { slug: 'blue-dots', title: 'Blue Dots' } },
          {
            ...row({
              unit_internal_id: ID_B,
              asset_kind: 'link',
              asset_name: 'Repo',
              purpose: null,
              reuse_condition: null,
              storage_path: null,
              file_name: 'ignored.pdf',
              size_bytes: 99,
              link_url: 'https://www.github.com/org/repo',
            }),
            pathways: null,
          },
        ],
      },
    });
    const assets = await loadPublishedToolkitAssets();
    expect(assets).toEqual([
      {
        id: ID_A,
        name: 'Vendor checklist',
        purpose: 'Evaluate vendors',
        reuseCondition: 'Adapt the criteria',
        kind: 'file',
        fileName: 'checklist.pdf',
        sizeBytes: 1234,
        linkDomain: null,
        pathwaySlug: 'blue-dots',
        pathwayTitle: 'Blue Dots',
        publishedAt: '2026-10-01T00:00:00Z',
      },
      {
        id: ID_B,
        name: 'Repo',
        purpose: '',
        reuseCondition: '',
        kind: 'link',
        fileName: null,
        sizeBytes: null,
        linkDomain: 'github.com',
        pathwaySlug: '',
        pathwayTitle: '',
        publishedAt: '2026-10-01T00:00:00Z',
      },
    ]);
    expect(JSON.stringify(assets)).not.toContain('pw-1/x/checklist.pdf');
  });

  it('returns [] when the query errors', async () => {
    useAdmin({ contribution_units: { error: { message: 'down' } } });
    expect(await loadPublishedToolkitAssets()).toEqual([]);
  });

  it('returns [] for null data', async () => {
    useAdmin({ contribution_units: { data: null } });
    expect(await loadPublishedToolkitAssets()).toEqual([]);
  });
});

describe('loadPathwayToolkitAssets', () => {
  it('loads every consented asset on the pathway, published or not', async () => {
    useAdmin({ contribution_units: { data: [row({ published_at: null })] } });
    const rows = await loadPathwayToolkitAssets('pw-1');
    expect(rows).toHaveLength(1);
    const [op] = admin.ops('contribution_units', 'select');
    expect(op.filters).toEqual([
      ['eq', 'unit_type', 'toolkit-asset'],
      ['eq', 'pathway_id', 'pw-1'],
      ['eq', 'share_consent', true],
      ['order', 'created_at', { ascending: true }],
    ]);
  });

  it('returns [] for null data', async () => {
    useAdmin({ contribution_units: { data: null } });
    expect(await loadPathwayToolkitAssets('pw-1')).toEqual([]);
  });

  it('throws when the query errors', async () => {
    useAdmin({ contribution_units: { error: { message: 'down' } } });
    await expect(loadPathwayToolkitAssets('pw-1')).rejects.toThrow('toolkit assets for pathway pw-1: down');
  });
});

describe('loadToolkitAsset', () => {
  it('returns the row for a toolkit-asset id', async () => {
    useAdmin({ contribution_units: { data: row() } });
    expect(await loadToolkitAsset(ID_A)).toEqual(row());
    const [op] = admin.ops('contribution_units', 'select');
    expect(op.filters).toEqual([
      ['eq', 'unit_type', 'toolkit-asset'],
      ['eq', 'unit_internal_id', ID_A],
    ]);
    expect(op.single).toBe('maybeSingle');
  });

  it('returns null when missing or on error', async () => {
    useAdmin({ contribution_units: { data: null } });
    expect(await loadToolkitAsset('nope')).toBeNull();
    useAdmin({ contribution_units: { error: { message: 'x' } } });
    expect(await loadToolkitAsset(ID_A)).toBeNull();
  });
});

describe('toSummary / toBlockEntry', () => {
  it('toSummary drops reuseCondition', () => {
    const summary = toSummary({
      id: ID_A,
      name: 'n',
      purpose: 'p',
      reuseCondition: 'secret-ish',
      kind: 'file',
      fileName: 'f.pdf',
      sizeBytes: 1,
      linkDomain: null,
      pathwaySlug: 's',
      pathwayTitle: 't',
      publishedAt: null,
    });
    expect(summary).not.toHaveProperty('reuseCondition');
    expect(summary).toMatchObject({ id: ID_A, name: 'n', kind: 'file', pathwaySlug: 's' });
  });

  it('toBlockEntry maps a file row', () => {
    expect(toBlockEntry(row())).toEqual({
      id: ID_A,
      name: 'Vendor checklist',
      kind: 'file',
      fileName: 'checklist.pdf',
      linkDomain: null,
      linkUrl: null,
      purpose: 'Evaluate vendors',
      reuseCondition: 'Adapt the criteria',
    });
  });

  it('toBlockEntry maps a link row and defaults null text to ""', () => {
    const entry = toBlockEntry(
      row({ asset_kind: 'link', link_url: 'https://www.example.org/x', purpose: null, reuse_condition: null })
    );
    expect(entry).toMatchObject({ kind: 'link', linkDomain: 'example.org', linkUrl: 'https://www.example.org/x', purpose: '', reuseCondition: '' });
  });

  it('toBlockEntry tolerates an unparseable link URL', () => {
    expect(toBlockEntry(row({ asset_kind: 'link', link_url: 'not a url' })).linkDomain).toBeNull();
  });
});

describe('buildAssetStoragePath', () => {
  it('is <pathwayId>/<uuid>/<sanitised name>', () => {
    const path = buildAssetStoragePath('pw-1', 'My Checklist.pdf');
    expect(path).toMatch(/^pw-1\/[0-9a-f-]{36}\/My Checklist\.pdf$/);
  });

  it('is unique per call', () => {
    expect(buildAssetStoragePath('pw-1', 'a.pdf')).not.toBe(buildAssetStoragePath('pw-1', 'a.pdf'));
  });

  it.each(['../../etc/passwd', '..\\..\\secret.pdf', '/abs/evil.pdf', '....pdf'])(
    'never lets a traversal file name %j escape its folder',
    (name) => {
      const path = buildAssetStoragePath('pw-1', name);
      const segments = path.split('/');
      expect(segments).toHaveLength(3);
      expect(segments[0]).toBe('pw-1');
      expect(segments[2]).not.toContain('..');
      expect(segments[2]).not.toBe('');
    }
  );

  it('falls back to "asset" for a name that sanitises to nothing', () => {
    expect(buildAssetStoragePath('pw-1', '...').split('/')[2]).toBe('asset');
  });
});

describe('storage helpers', () => {
  it('createAssetUploadUrl returns the signed path + token from the toolkit-assets bucket', async () => {
    expect(await createAssetUploadUrl('pw-1/x/a.pdf')).toEqual({ path: 'p', token: 'upload-token' });
    expect(admin.client.storage.from).toHaveBeenCalledWith(TOOLKIT_ASSET_BUCKET);
    expect(admin.storageBucket.createSignedUploadUrl).toHaveBeenCalledWith('pw-1/x/a.pdf');
  });

  it('createAssetUploadUrl throws on a storage error or no data', async () => {
    admin.storageBucket.createSignedUploadUrl.mockResolvedValueOnce({ data: null, error: { message: 'exists' } } as never);
    await expect(createAssetUploadUrl('p')).rejects.toThrow('signed upload url: exists');
    admin.storageBucket.createSignedUploadUrl.mockResolvedValueOnce({ data: null, error: null } as never);
    await expect(createAssetUploadUrl('p')).rejects.toThrow('signed upload url: no data');
  });

  it('assetObjectSize returns the stored size', async () => {
    expect(await assetObjectSize('p')).toBe(4);
    expect(admin.storageBucket.info).toHaveBeenCalledWith('p');
  });

  it('assetObjectSize is null for a missing object or a non-numeric size', async () => {
    admin.storageBucket.info.mockResolvedValueOnce({ data: null, error: { message: 'not found' } } as never);
    expect(await assetObjectSize('p')).toBeNull();
    admin.storageBucket.info.mockResolvedValueOnce({ data: { size: '4' }, error: null } as never);
    expect(await assetObjectSize('p')).toBeNull();
  });

  it('removeAssetObjects does nothing for an empty list', async () => {
    await removeAssetObjects([]);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('removeAssetObjects removes the given paths and only logs a storage error', async () => {
    await removeAssetObjects(['a', 'b']);
    expect(admin.storageBucket.remove).toHaveBeenCalledWith(['a', 'b']);
    admin.storageBucket.remove.mockResolvedValueOnce({ data: null, error: { message: 'denied' } } as never);
    await expect(removeAssetObjects(['c'])).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('openAssetFileStream', () => {
  it('streams the object through a 60-second signed URL fetched server-side', async () => {
    const fetchMock = vi.fn(async () => new Response('file-bytes', { headers: { 'content-length': '10' } }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await openAssetFileStream('pw-1/x/a.pdf');
    expect(admin.storageBucket.createSignedUrl).toHaveBeenCalledWith('pw-1/x/a.pdf', 60);
    expect(fetchMock).toHaveBeenCalledWith('https://storage.test/signed', { cache: 'no-store' });
    expect(out?.size).toBe('10');
    expect(await new Response(out!.body).text()).toBe('file-bytes');
  });

  it('is null when the signed URL cannot be minted', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    admin.storageBucket.createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'missing' } } as never);
    expect(await openAssetFileStream('p')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is null when storage answers non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    expect(await openAssetFileStream('p')).toBeNull();
  });

  it('propagates a network failure from the storage fetch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));
    await expect(openAssetFileStream('p')).rejects.toThrow('fetch failed');
  });
});

describe('dropAssetsFromReviewCopy', () => {
  const doc = [
    '# Pathway',
    '',
    ASSET_BLOCK_START,
    `- Checklist <!-- asset-id: ${ID_A} -->`,
    `- Repo <!-- asset-id: ${ID_B} -->`,
    ASSET_BLOCK_END,
    '',
  ].join('\n');

  it('does nothing for an empty id list', async () => {
    await dropAssetsFromReviewCopy('pw-1', []);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('does nothing when the pathway has no review copy', async () => {
    useAdmin({ pathways: { data: { content_cache: null } } });
    await dropAssetsFromReviewCopy('pw-1', [ID_A]);
    expect(admin.ops('pathways', 'update')).toHaveLength(0);
  });

  it('does nothing when none of the removed ids are in the document', async () => {
    useAdmin({ pathways: { data: { content_cache: '# Pathway\n\nNo assets here.' } } });
    await dropAssetsFromReviewCopy('pw-1', [ID_A]);
    expect(admin.ops('pathways', 'update')).toHaveLength(0);
    expect(admin.ops('contribution_units')).toHaveLength(0);
  });

  it('rewrites the review copy without the removed asset', async () => {
    useAdmin({
      pathways: (op) => (op.action === 'select' ? { data: { content_cache: doc } } : {}),
      contribution_units: {
        data: [row({ unit_internal_id: ID_A }), row({ unit_internal_id: ID_B, asset_name: 'Repo', asset_kind: 'link', link_url: 'https://github.com/x' })],
      },
    });
    await dropAssetsFromReviewCopy('pw-1', [ID_A]);
    const [update] = admin.ops('pathways', 'update');
    expect(update.filters).toEqual([['eq', 'id', 'pw-1']]);
    const content = (update.payload as { content_cache: string }).content_cache;
    expect(content).not.toContain(ID_A);
    expect(content).toContain(ID_B);
  });

  it('never throws, even when loading the remaining assets fails', async () => {
    useAdmin({
      pathways: { data: { content_cache: doc } },
      contribution_units: { error: { message: 'down' } },
    });
    await expect(dropAssetsFromReviewCopy('pw-1', [ID_A])).resolves.toBeUndefined();
    expect(admin.ops('pathways', 'update')).toHaveLength(0);
    expect(console.error).toHaveBeenCalled();
  });

  it('never throws when the admin client cannot be created', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('no key');
    });
    await expect(dropAssetsFromReviewCopy('pw-1', [ID_A])).resolves.toBeUndefined();
  });
});
