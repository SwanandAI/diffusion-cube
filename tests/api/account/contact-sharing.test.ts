import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type MockResponse, type SupabaseMock } from '../../helpers/supabase-mock';
import { jsonRequest } from '../../helpers/request';
import { routeOps, sessionMock } from '../../helpers/routes-auth';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { GENERIC_ERROR_MESSAGE } from '@/lib/error-messages';
import { POST } from '@/app/api/account/contact-sharing/route';

const URL = 'http://localhost/api/account/contact-sharing';

let session: SupabaseMock;
let admin: SupabaseMock;

function signIn(registration: MockResponse = { data: { id: 'reg-1', access_status: 'approved' } }, email: string | null = 'me@example.com') {
  session = sessionMock({ id: 'u1', email }, ['adopter', 'pathway_contributor'], {
    contributor_registrations: registration,
  });
  vi.mocked(createClient).mockResolvedValue(session.client);
}

function useAdmin(update: MockResponse = {}) {
  admin = createSupabaseMock({ tables: { contributor_registrations: update } });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

beforeEach(() => {
  useAdmin();
  signIn();
});

describe('POST /api/account/contact-sharing', () => {
  it('401s an anonymous caller', async () => {
    session = sessionMock(null);
    vi.mocked(createClient).mockResolvedValue(session.client);
    const res = await POST(jsonRequest(URL, { sharingLevel: 'name' }));
    expect(res.status).toBe(401);
    expect(routeOps(admin)).toHaveLength(0);
  });

  it('401s a session with no email', async () => {
    signIn(undefined, null);
    const res = await POST(jsonRequest(URL, { sharingLevel: 'name' }));
    expect(res.status).toBe(401);
  });

  it.each([
    ['missing level', {}],
    ['unknown level', { sharingLevel: 'everything' }],
    ['numeric level', { sharingLevel: 1 }],
    ['null level', { sharingLevel: null }],
    ['case-mangled level', { sharingLevel: 'NAME' }],
  ])('400s %s', async (_label, body) => {
    const res = await POST(jsonRequest(URL, body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid sharing option.' });
    expect(routeOps(admin)).toHaveLength(0);
  });

  it('400s a malformed JSON body', async () => {
    const res = await POST(jsonRequest(URL, '{oops'));
    expect(res.status).toBe(400);
  });

  it('reads the caller\'s own registration through the session client', async () => {
    await POST(jsonRequest(URL, { sharingLevel: 'none' }));
    const [read] = session.ops('contributor_registrations', 'select');
    expect(read.filters).toEqual([['eq', 'user_id', 'u1']]);
    expect(read.single).toBe('maybeSingle');
  });

  it.each([
    ['no registration', { data: null }],
    ['pending registration', { data: { id: 'reg-1', access_status: 'pending' } }],
    ['rejected registration', { data: { id: 'reg-1', access_status: 'rejected' } }],
  ])('403s a caller with %s', async (_label, registration) => {
    signIn(registration);
    const res = await POST(jsonRequest(URL, { sharingLevel: 'name' }));
    expect(res.status).toBe(403);
    expect(routeOps(admin)).toHaveLength(0);
  });

  it.each([
    ['none', { share_name: false, share_contact: false, contact_info: '' }],
    ['name', { share_name: true, share_contact: false, contact_info: '' }],
    ['name_and_email', { share_name: true, share_contact: true, contact_info: 'me@example.com' }],
  ])('writes exactly the three sharing columns for %s, scoped to the caller\'s row', async (level, columns) => {
    const res = await POST(jsonRequest(URL, { sharingLevel: level }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [update] = admin.ops('contributor_registrations', 'update');
    expect(update.payload).toEqual(columns);
    expect(update.filters).toEqual([['eq', 'id', 'reg-1']]);
  });

  it('ignores extra body fields — no access_status or foreign email can ride along', async () => {
    const res = await POST(
      jsonRequest(URL, {
        sharingLevel: 'name_and_email',
        access_status: 'approved',
        contact_info: 'attacker@example.com',
        id: 'someone-elses-reg',
      })
    );
    expect(res.status).toBe(200);
    const [update] = admin.ops('contributor_registrations', 'update');
    expect(update.payload).toEqual({ share_name: true, share_contact: true, contact_info: 'me@example.com' });
    expect(update.filters).toEqual([['eq', 'id', 'reg-1']]);
  });

  it('is idempotent — saving the same choice twice writes the same row', async () => {
    await POST(jsonRequest(URL, { sharingLevel: 'name' }));
    await POST(jsonRequest(URL, { sharingLevel: 'name' }));
    const updates = admin.ops('contributor_registrations', 'update');
    expect(updates).toHaveLength(2);
    expect(updates[1].payload).toEqual(updates[0].payload);
  });

  it('answers a database failure with the generic 500, no raw error text', async () => {
    useAdmin({ error: { message: 'new row violates row-level security policy' } });
    const res = await POST(jsonRequest(URL, { sharingLevel: 'name' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: GENERIC_ERROR_MESSAGE });
  });
});
