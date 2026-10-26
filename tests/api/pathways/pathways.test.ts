import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type MockUser, type SupabaseMock, type TableHandler } from '../../helpers/supabase-mock';
import { getRequest, jsonRequest } from '../../helpers/request';
import { eqValue, rolesTable } from '../../helpers/chat-session';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { GENERIC_ERROR_MESSAGE } from '@/lib/error-messages';
import { isValidSlug } from '@/lib/slug';
import { GET, POST } from '@/app/api/pathways/route';

const URL = 'http://localhost/api/pathways';
const USER: MockUser = { id: 'u1', email: 'user@example.com' };

let session: SupabaseMock;
let admin: SupabaseMock;
let takenSlugs: Set<string>;

function signIn(user: MockUser | null, roles: string[], tables: Record<string, TableHandler> = {}) {
  session = createSupabaseMock({ user, tables: { user_roles: rolesTable(roles), ...tables } });
  vi.mocked(createClient).mockResolvedValue(session.client);
}

function adminWith(insert: TableHandler = { data: { id: 'p-new', slug: 'ignored' } }) {
  admin = createSupabaseMock({
    tables: {
      pathways: (op) => {
        if (op.action === 'insert') {
          const res = typeof insert === 'function' ? insert(op) : insert;
          return res;
        }
        return { data: takenSlugs.has(eqValue(op.filters, 'slug') as string) ? { id: 'existing' } : null };
      },
      sys_errors: {},
    },
  });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

const get = () => GET(new NextRequest(getRequest(URL)));
const post = (body: unknown) => POST(new NextRequest(jsonRequest(URL, body)));
const validBody = { title: 'Rural Health Triage', sector: 'Health', description: 'Triage by voice.' };

function insertedSlug() {
  const [op] = admin.ops('pathways', 'insert');
  return (op?.payload as { slug: string } | undefined)?.slug;
}

beforeEach(() => {
  takenSlugs = new Set();
  adminWith();
  signIn(USER, ['adopter', 'pathway_contributor']);
});

describe('GET /api/pathways', () => {
  // The list itself comes from the service role (the pathways RLS, migration
  // 0040, shows a session only its own pathways); membership, orgs and live
  // slugs still come from the caller's session.
  function signInForList(
    pathways: TableHandler,
    tables: Record<string, TableHandler> = {},
    roles: string[] = ['adopter', 'pathway_contributor'],
    user: MockUser = USER
  ) {
    signIn(user, roles, tables);
    admin = createSupabaseMock({ tables: { pathways, sys_errors: {} } });
    vi.mocked(createAdminClient).mockReturnValue(admin.client);
  }

  it('401s an anonymous caller', async () => {
    signIn(null, []);
    const res = await get();
    expect(res.status).toBe(401);
    expect(admin.ops('pathways')).toHaveLength(0);
  });

  // Unpublished pathways' titles and descriptions are only for the people
  // who pick from this list: contributors (and admins).
  it.each([
    ['an adopter', ['adopter']],
    ['an account with no roles', []],
  ])('403s %s without the contributor role', async (_label, roles) => {
    signIn(USER, roles);
    const res = await get();
    expect(res.status).toBe(403);
    expect(admin.ops('pathways')).toHaveLength(0);
    expect(session.ops('pathways')).toHaveLength(0);
  });

  it('lets an admin by role list pathways without the contributor role', async () => {
    signInForList({ data: [] }, {}, ['adopter', 'admin']);
    const res = await get();
    expect(res.status).toBe(200);
  });

  it('lets an ADMIN_EMAILS admin list pathways without any role row', async () => {
    signInForList({ data: [] }, {}, [], { id: 'a1', email: 'env-admin@example.com' });
    const res = await get();
    expect(res.status).toBe(200);
  });

  it('reads the list with the service role and never selects content_cache', async () => {
    signInForList({ data: [] });
    await get();
    expect(session.ops('pathways')).toHaveLength(0);
    const [op] = admin.ops('pathways', 'select');
    expect(op.columns).not.toContain('content_cache');
  });

  it('lists pathways with publish, review, membership and org flags for a contributor', async () => {
    signInForList(
      {
        data: [
          { id: 'p1', slug: 'alpha', title: 'Alpha', sector: 'Agri', description: 'd', created_at: '2026-01-01', review_requested: true },
          { id: 'p2', slug: 'beta', title: 'Beta', sector: 'Health', description: 'd', created_at: '2026-01-02', review_requested: null },
        ],
      },
      {
        pathway_contributors: (op) =>
          eqValue(op.filters, 'user_id') === 'u1'
            ? { data: [{ pathway_id: 'p2' }] }
            : {
                data: [
                  { pathway_id: 'p1', organisations: { name: 'Org A' } },
                  { pathway_id: 'p1', organisations: [{ name: 'Org B' }] },
                  { pathway_id: 'p1', organisations: { name: 'Org A' } },
                  { pathway_id: 'p2', organisations: null },
                ],
              },
        published_pathways: { data: [{ slug: 'alpha' }] },
      }
    );
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        id: 'p1', slug: 'alpha', title: 'Alpha', sector: 'Agri', description: 'd', created_at: '2026-01-01',
        isPublished: true, reviewRequested: true, isContributor: false, orgs: ['Org A', 'Org B'],
      },
      {
        id: 'p2', slug: 'beta', title: 'Beta', sector: 'Health', description: 'd', created_at: '2026-01-02',
        isPublished: false, reviewRequested: false, isContributor: true, orgs: [],
      },
    ]);
  });

  it('returns an empty list when there are no pathways', async () => {
    signInForList({ data: [] });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('hides a database error behind the generic 500', async () => {
    signInForList({ error: { message: 'permission denied for table pathways' } });
    const res = await get();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: GENERIC_ERROR_MESSAGE });
  });
});

describe('POST /api/pathways', () => {
  it('401s an anonymous caller', async () => {
    signIn(null, []);
    const res = await post(validBody);
    expect(res.status).toBe(401);
    expect(admin.ops('pathways', 'insert')).toHaveLength(0);
  });

  it('403s an adopter without the contributor role', async () => {
    signIn(USER, ['adopter']);
    const res = await post(validBody);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Contributor role required' });
    expect(admin.ops('pathways', 'insert')).toHaveLength(0);
  });

  it('403s an admin without the contributor role', async () => {
    signIn({ id: 'a1', email: 'env-admin@example.com' }, ['admin']);
    const res = await post(validBody);
    expect(res.status).toBe(403);
  });

  it('creates the pathway with trimmed fields and returns 201 { id, slug }', async () => {
    adminWith({ data: { id: 'p-new', slug: 'rural-health-triage' } });
    const res = await post({ title: '  Rural Health Triage ', sector: ' Health ', description: ' Triage by voice. ' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'p-new', slug: 'rural-health-triage' });
    const [op] = admin.ops('pathways', 'insert');
    expect(op.payload).toEqual({
      slug: 'rural-health-triage',
      title: 'Rural Health Triage',
      sector: 'Health',
      description: 'Triage by voice.',
      created_by: 'u1',
    });
    expect(op.columns).toBe('id, slug');
  });

  it.each([
    ['missing title', { sector: 'S', description: 'D' }, 'title required'],
    ['blank title', { title: '   ', sector: 'S', description: 'D' }, 'title required'],
    ['missing sector', { title: 'T', description: 'D' }, 'sector required'],
    ['blank sector', { title: 'T', sector: '\n\t', description: 'D' }, 'sector required'],
    ['missing description', { title: 'T', sector: 'S' }, 'description required'],
    ['blank description', { title: 'T', sector: 'S', description: ' ' }, 'description required'],
    ['a non-JSON body', 'title=T&sector=S', 'title required'],
  ])('400s %s', async (_label, body, error) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(admin.ops('pathways', 'insert')).toHaveLength(0);
  });

  // Regression: a non-string title is a 400, not a TypeError 500.
  it('400s (not 500s) a non-string title', async () => {
    const res = await post({ title: 42, sector: 'S', description: 'D' });
    expect(res.status).toBe(400);
  });

  it.each([
    ['Blue Dots', 'blue-dots-1'],
    ['MahaVISTAAR', 'mahavistaar-1'],
    ['Index', 'index-1'],
  ])('never takes a reserved curated slug: %s → %s', async (title, slug) => {
    const res = await post({ ...validBody, title });
    expect(res.status).toBe(201);
    expect(insertedSlug()).toBe(slug);
  });

  it('suffixes a slug another pathway already has, skipping taken suffixes', async () => {
    takenSlugs = new Set(['rural-health-triage', 'rural-health-triage-1']);
    const res = await post(validBody);
    expect(res.status).toBe(201);
    expect(insertedSlug()).toBe('rural-health-triage-2');
  });

  it('strips path-traversal characters from the slug', async () => {
    await post({ ...validBody, title: '../../etc/passwd' });
    const slug = insertedSlug();
    expect(slug).toBe('etcpasswd');
    expect(isValidSlug(slug)).toBe(true);
  });

  it('caps the slug at 80 characters', async () => {
    await post({ ...validBody, title: 'word '.repeat(40) });
    const slug = insertedSlug()!;
    expect(slug.length).toBeLessThanOrEqual(80);
  });

  // Regression: slugify always yields a valid slug, or assemble could never publish the pathway.
  it('never creates a pathway with an empty slug (non-ASCII title)', async () => {
    await post({ ...validBody, title: 'मराठी कृषी सहायक' });
    expect(isValidSlug(insertedSlug())).toBe(true);
    expect(insertedSlug()).toBe('pathway');
  });

  it('never creates a pathway whose slug starts with a hyphen', async () => {
    await post({ ...validBody, title: '- Voice for farmers' });
    expect(isValidSlug(insertedSlug())).toBe(true);
  });

  it('never creates a pathway whose slug ends with a hyphen after the 80-char cut', async () => {
    await post({ ...validBody, title: `${'a'.repeat(79)} b` });
    expect(isValidSlug(insertedSlug())).toBe(true);
  });

  it('hides an insert error behind the generic 500', async () => {
    adminWith({ error: { message: 'duplicate key value violates unique constraint "pathways_slug_key"' } });
    const res = await post(validBody);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: GENERIC_ERROR_MESSAGE });
  });
});
