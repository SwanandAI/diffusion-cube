import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type MockResponse, type MockUser, type SupabaseMock } from '../../helpers/supabase-mock';
import { jsonRequest } from '../../helpers/request';
import { rolesTable } from '../../helpers/chat-session';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/github', () => ({ ghReadFile: vi.fn(), ghWriteFile: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ghReadFile, ghWriteFile } from '@/lib/github';
import { GENERIC_ERROR_MESSAGE } from '@/lib/error-messages';
import { applyToolkitAssetFiles } from '@/lib/toolkit-assets';
import { POST } from '@/app/api/pathways/assemble/route';

const URL = 'http://localhost/api/pathways/assemble';
const USER: MockUser = { id: 'u1', email: 'contrib@example.com' };
const DRAFT = '---\ntitle: New Path\n---\n\n# New Path\n\nSection 1 body.';

let session: SupabaseMock;
let admin: SupabaseMock;

interface World {
  roles?: string[];
  user?: MockUser | null;
  membership?: unknown;
  design?: unknown;
  pathway?: MockResponse;
  draft?: unknown;
  assets?: MockResponse;
}

function setup(world: World = {}) {
  const {
    roles = ['adopter', 'pathway_contributor'],
    user = USER,
    membership = { user_id: 'u1' },
    design = { id: 'd1', pathway_id: 'p1' },
    pathway = { data: { id: 'p1', slug: 'new-path' } },
    draft = { id: 'doc-3', content: DRAFT },
    assets = { data: [] },
  } = world;
  session = createSupabaseMock({
    user,
    tables: {
      user_roles: rolesTable(roles),
      pathway_contributors: { data: membership },
      designs: { data: design },
    },
  });
  admin = createSupabaseMock({
    tables: {
      pathways: (op) => (op.action === 'select' ? pathway : {}),
      design_documents: { data: draft },
      contribution_units: assets,
      sys_errors: {},
    },
  });
  vi.mocked(createClient).mockResolvedValue(session.client);
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

const post = (body: unknown) => POST(new NextRequest(jsonRequest(URL, body)));
const valid = { pathwayId: 'p1', designId: 'd1' };

beforeEach(() => {
  vi.mocked(ghReadFile).mockResolvedValue({ content: 'old', sha: 'sha-old' });
  vi.mocked(ghWriteFile).mockResolvedValue({ commitSha: 'c1' });
  setup();
});

function expectNoPublish() {
  expect(ghWriteFile).not.toHaveBeenCalled();
  expect(admin.ops('pathways', 'update')).toHaveLength(0);
}

describe('POST /api/pathways/assemble — access', () => {
  it('401s an anonymous caller', async () => {
    setup({ user: null, roles: [] });
    const res = await post(valid);
    expect(res.status).toBe(401);
    expectNoPublish();
  });

  it('403s an account with no roles', async () => {
    setup({ roles: [] });
    const res = await post(valid);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Account not approved' });
  });

  it('403s an adopter without the contributor role', async () => {
    setup({ roles: ['adopter'] });
    const res = await post(valid);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Contributor role required' });
    expectNoPublish();
  });

  it('403s a contributor who is not a member of this pathway', async () => {
    setup({ membership: null });
    const res = await post(valid);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Not a contributor to this pathway' });
    const [op] = session.ops('pathway_contributors');
    expect(op.filters).toEqual([
      ['eq', 'pathway_id', 'p1'],
      ['eq', 'user_id', 'u1'],
    ]);
    expectNoPublish();
  });

  it("403s a design the caller can't see (another user's workspace)", async () => {
    setup({ design: null });
    const res = await post(valid);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Not your workspace for this pathway' });
    expectNoPublish();
  });

  it("403s the caller's own design when it belongs to a different pathway", async () => {
    setup({ design: { id: 'd1', pathway_id: 'p-other' } });
    const res = await post(valid);
    expect(res.status).toBe(403);
    expectNoPublish();
  });
});

describe('POST /api/pathways/assemble — validation', () => {
  it.each([
    ['missing pathwayId', { designId: 'd1' }, 'pathwayId required'],
    ['empty pathwayId', { pathwayId: '', designId: 'd1' }, 'pathwayId required'],
    ['missing designId', { pathwayId: 'p1' }, 'designId required'],
    ['a non-JSON body', 'not json', 'pathwayId required'],
  ])('400s %s', async (_label, body, error) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expectNoPublish();
  });

  it('404s a pathway that does not exist', async () => {
    setup({ pathway: { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } } });
    const res = await post(valid);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Pathway not found' });
    expectNoPublish();
  });

  it.each(['../../lib/github', '../x', 'New Path', 'a/b', 'slug.md', '', '-x'])(
    '400s a stored pathway slug of %j without touching GitHub',
    async (slug) => {
      setup({ pathway: { data: { id: 'p1', slug } } });
      const res = await post(valid);
      expect(res.status).toBe(400);
      expect(ghReadFile).not.toHaveBeenCalled();
      expectNoPublish();
    }
  );

  it.each(['mahavistaar', 'blue-dots', 'index'])('409s the reserved curated slug %s', async (slug) => {
    setup({ pathway: { data: { id: 'p1', slug } } });
    const res = await post(valid);
    expect(res.status).toBe(409);
    expect(ghReadFile).not.toHaveBeenCalled();
    expectNoPublish();
  });

  it('400s when the workspace has no draft yet', async () => {
    setup({ draft: null });
    const res = await post(valid);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/No draft found/);
    expectNoPublish();
  });

  it('400s a draft row with empty content', async () => {
    setup({ draft: { id: 'doc-3', content: '' } });
    const res = await post(valid);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/pathways/assemble — publish', () => {
  it("commits the caller's latest draft to content/wiki/pathways/<slug>.md over the existing file", async () => {
    const res = await post(valid);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ content: DRAFT, slug: 'new-path', assembled_design_doc_id: 'doc-3' });

    const expected = applyToolkitAssetFiles(DRAFT, []);
    expect(ghReadFile).toHaveBeenCalledWith('content/wiki/pathways/new-path.md');
    expect(ghWriteFile).toHaveBeenCalledWith(
      'content/wiki/pathways/new-path.md',
      expected,
      'publish pathway: new-path',
      'sha-old'
    );

    const [draftQuery] = admin.ops('design_documents', 'select');
    expect(draftQuery.filters).toEqual([
      ['eq', 'design_id', 'd1'],
      ['eq', 'user_id', 'u1'],
      ['eq', 'doc_type', 'draft'],
      ['order', 'version_number', { ascending: false }],
      ['limit', 1],
    ]);

    const [update] = admin.ops('pathways', 'update');
    expect(update.payload).toEqual({ content_cache: expected, review_requested: true, assembled_design_doc_id: 'doc-3' });
    expect(update.filters).toEqual([['eq', 'id', 'p1']]);
  });

  it('creates the file (no sha) when it does not exist yet', async () => {
    vi.mocked(ghReadFile).mockResolvedValue(null);
    const res = await post(valid);
    expect(res.status).toBe(200);
    expect(vi.mocked(ghWriteFile).mock.calls[0][3]).toBeUndefined();
  });

  it('only lists consented toolkit assets for this pathway', async () => {
    await post(valid);
    const [op] = admin.ops('contribution_units', 'select');
    expect(op.filters).toContainEqual(['eq', 'pathway_id', 'p1']);
    expect(op.filters).toContainEqual(['eq', 'share_consent', true]);
  });

  it('answers a GitHub failure with the generic 500 and does not flag the pathway for review', async () => {
    vi.mocked(ghWriteFile).mockRejectedValue(
      new Error('GitHub writeFile "content/wiki/pathways/new-path.md": 401 Bad credentials Bearer ghp_secret123')
    );
    const res = await post(valid);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: GENERIC_ERROR_MESSAGE });
    expect(admin.ops('pathways', 'update')).toHaveLength(0);
    await vi.waitFor(() => expect(admin.ops('sys_errors', 'insert')).toHaveLength(1));
    expect((admin.ops('sys_errors', 'insert')[0].payload as { message: string }).message).not.toContain('ghp_secret123');
  });

  it('answers a GitHub read failure with the generic 500', async () => {
    vi.mocked(ghReadFile).mockRejectedValue(new Error('GitHub readFile: 500 upstream'));
    const res = await post(valid);
    expect(res.status).toBe(500);
    expect(ghWriteFile).not.toHaveBeenCalled();
  });

  it('answers a toolkit-asset load failure with the generic 500 before any commit', async () => {
    setup({ assets: { error: { message: 'relation "contribution_units" does not exist' } } });
    const res = await post(valid);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('contribution_units');
    expect(ghWriteFile).not.toHaveBeenCalled();
  });
});
