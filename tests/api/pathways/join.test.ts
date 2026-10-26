import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type MockResponse, type MockUser, type SupabaseMock } from '../../helpers/supabase-mock';
import { jsonRequest, routeParams } from '../../helpers/request';
import { eqValue, rolesTable } from '../../helpers/chat-session';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { GENERIC_ERROR_MESSAGE } from '@/lib/error-messages';
import { DELETE, POST } from '@/app/api/pathways/[id]/join/route';

const URL = 'http://localhost/api/pathways/p1/join';
const USER: MockUser = { id: 'u1', email: 'contrib@example.com' };
const REGISTRATION = { organisation_name: '  Acme Foundation ', pathway_role: ' Implementer ', public_links: ' https://acme.org ' };

let session: SupabaseMock;
let admin: SupabaseMock;

interface World {
  user?: MockUser | null;
  roles?: string[];
  pathway?: unknown;
  existing?: unknown;
  registration?: unknown;
  contributorInsert?: MockResponse;
  existingOrg?: unknown;
  orgInsert?: MockResponse;
  deleteResult?: MockResponse;
}

function setup(world: World = {}) {
  const {
    user = USER,
    roles = ['adopter', 'pathway_contributor'],
    pathway = { id: 'p1' },
    existing = null,
    registration = REGISTRATION,
    contributorInsert = {},
    existingOrg = null,
    orgInsert = { data: { id: 'org-new' } },
    deleteResult = {},
  } = world;
  session = createSupabaseMock({
    user,
    tables: {
      user_roles: rolesTable(roles),
      pathway_contributors: (op) => (op.action === 'insert' ? contributorInsert : { data: existing }),
      contributor_registrations: { data: registration },
    },
  });
  admin = createSupabaseMock({
    tables: {
      // The existence check runs with the service role — the caller isn't a
      // member yet, and the pathways RLS (migration 0040) shows only members.
      pathways: { data: pathway },
      organisations: (op) => (op.action === 'insert' ? orgInsert : { data: existingOrg }),
      pathway_contributors: deleteResult,
      sys_errors: {},
    },
  });
  vi.mocked(createClient).mockResolvedValue(session.client);
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

const join = (id = 'p1') => POST(new NextRequest(jsonRequest(URL, {})), routeParams({ id }));
const leave = (id = 'p1') => DELETE(new NextRequest(URL, { method: 'DELETE' }), routeParams({ id }));

beforeEach(() => setup());

describe('POST /api/pathways/[id]/join', () => {
  it('401s an anonymous caller', async () => {
    setup({ user: null, roles: [] });
    const res = await join();
    expect(res.status).toBe(401);
    expect(session.ops('pathway_contributors', 'insert')).toHaveLength(0);
  });

  it('403s an adopter without the contributor role', async () => {
    setup({ roles: ['adopter'] });
    const res = await join();
    expect(res.status).toBe(403);
    expect(session.ops('pathway_contributors', 'insert')).toHaveLength(0);
  });

  it.each(['missing', '../../admin', "p1' OR '1'='1"])('404s a pathway id that does not resolve (%s)', async (id) => {
    setup({ pathway: null });
    const res = await join(id);
    expect(res.status).toBe(404);
    expect(eqValue(admin.ops('pathways')[0].filters, 'id')).toBe(id);
    expect(session.ops('pathways')).toHaveLength(0);
    expect(session.ops('pathway_contributors', 'insert')).toHaveLength(0);
  });

  it('is idempotent for an existing member', async () => {
    setup({ existing: { user_id: 'u1' } });
    const res = await join();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, alreadyJoined: true });
    expect(session.ops('pathway_contributors', 'insert')).toHaveLength(0);
    expect(admin.ops('organisations')).toHaveLength(0);
  });

  it.each([
    ['no registration', null],
    ['a blank organisation name', { organisation_name: '   ', pathway_role: 'x', public_links: '' }],
    ['a null organisation name', { organisation_name: null, pathway_role: 'x', public_links: null }],
  ])('400s with %s', async (_label, registration) => {
    setup({ registration });
    const res = await join();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/complete registration/);
    expect(session.ops('pathway_contributors', 'insert')).toHaveLength(0);
  });

  it('joins under a newly created organisation from the registration', async () => {
    const res = await join();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const [orgInsert] = admin.ops('organisations', 'insert');
    expect(orgInsert.payload).toEqual({ name: 'Acme Foundation', canonical_role: 'Implementer', url: 'https://acme.org' });
    const [insert] = session.ops('pathway_contributors', 'insert');
    expect(insert.payload).toEqual({ pathway_id: 'p1', user_id: 'u1', org_id: 'org-new', role: 'Implementer' });
  });

  it('reuses an existing organisation without creating one', async () => {
    setup({ existingOrg: { id: 'org-1' } });
    const res = await join();
    expect(res.status).toBe(200);
    expect(admin.ops('organisations', 'insert')).toHaveLength(0);
    expect((session.ops('pathway_contributors', 'insert')[0].payload as { org_id: string }).org_id).toBe('org-1');
  });

  it('defaults a missing role to an empty string', async () => {
    setup({ registration: { organisation_name: 'Acme', pathway_role: null, public_links: null } });
    await join();
    expect((session.ops('pathway_contributors', 'insert')[0].payload as { role: string }).role).toBe('');
  });

  it('hides an organisation-create failure behind the generic 500', async () => {
    setup({ orgInsert: { error: { message: 'new row violates row-level security policy for table "organisations"' } } });
    const res = await join();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: GENERIC_ERROR_MESSAGE });
    expect(session.ops('pathway_contributors', 'insert')).toHaveLength(0);
  });

  it('hides a membership insert error behind the generic 500', async () => {
    setup({ contributorInsert: { error: { message: 'duplicate key value violates unique constraint' } } });
    const res = await join();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: GENERIC_ERROR_MESSAGE });
  });
});

describe('DELETE /api/pathways/[id]/join', () => {
  it('401s an anonymous caller', async () => {
    setup({ user: null, roles: [] });
    const res = await leave();
    expect(res.status).toBe(401);
    expect(admin.ops('pathway_contributors')).toHaveLength(0);
  });

  it("removes only the caller's own membership row", async () => {
    const res = await leave('p9');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [op] = admin.ops('pathway_contributors', 'delete');
    expect(op.filters).toEqual([
      ['eq', 'pathway_id', 'p9'],
      ['eq', 'user_id', 'u1'],
    ]);
  });

  it('answers a delete failure with the generic 500', async () => {
    setup({ deleteResult: { error: { message: 'deadlock detected' } } });
    const res = await leave();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: GENERIC_ERROR_MESSAGE });
  });
});
