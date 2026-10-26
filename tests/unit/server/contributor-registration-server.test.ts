import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type MockResponse, type QueryOp, type SupabaseMock } from '../../helpers/supabase-mock';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/organisations', () => ({ ensureOrganisation: vi.fn(async () => 'org-new') }));

import { createAdminClient } from '@/lib/supabase/admin';
import { ensureOrganisation } from '@/lib/organisations';
import { approveContributor, revokeContributor } from '@/lib/contributor-registration-server';

let admin: SupabaseMock;

interface Config {
  registration?: MockResponse;
  statusUpdate?: MockResponse;
  roleUpsert?: MockResponse;
  roleDelete?: MockResponse;
}

function setup(config: Config = {}) {
  admin = createSupabaseMock({
    tables: {
      contributor_registrations: (op: QueryOp) =>
        op.action === 'select' ? config.registration ?? { data: null } : config.statusUpdate ?? {},
      user_roles: (op: QueryOp) => (op.action === 'upsert' ? config.roleUpsert : config.roleDelete) ?? {},
    },
  });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

const REG = {
  id: 'reg-1',
  user_id: 'u1',
  organisation_name: 'Acme Foundation',
  pathway_role: 'implementer',
  public_links: 'https://acme.test',
  org_id: null as string | null,
};

beforeEach(() => setup());

describe('approveContributor', () => {
  it('approves by registration id: ensures the org, grants the role, then marks approved', async () => {
    setup({ registration: { data: { ...REG } } });
    expect(await approveContributor({ registrationId: 'reg-1' })).toEqual({ ok: true });

    const [lookup] = admin.ops('contributor_registrations', 'select');
    expect(lookup.filters).toEqual([['eq', 'id', 'reg-1']]);
    expect(lookup.single).toBe('maybeSingle');

    expect(ensureOrganisation).toHaveBeenCalledWith('Acme Foundation', 'implementer', 'https://acme.test');

    const [upsert] = admin.ops('user_roles', 'upsert');
    expect(upsert.payload).toEqual({ user_id: 'u1', role: 'pathway_contributor' });
    expect(upsert.options).toEqual({ onConflict: 'user_id,role' });

    const [update] = admin.ops('contributor_registrations', 'update');
    expect(update.payload).toEqual({ access_status: 'approved', org_id: 'org-new' });
    expect(update.filters).toEqual([['eq', 'id', 'reg-1']]);
  });

  it('grants the role before updating the status', async () => {
    setup({ registration: { data: { ...REG } } });
    await approveContributor({ registrationId: 'reg-1' });
    const order = admin.queryOps.map((o) => `${o.table}:${o.action}`);
    expect(order).toEqual([
      'contributor_registrations:select',
      'user_roles:upsert',
      'contributor_registrations:update',
    ]);
  });

  it('keeps an existing org_id and does not touch the organisations registry', async () => {
    setup({ registration: { data: { ...REG, org_id: 'org-existing' } } });
    expect(await approveContributor({ userId: 'u1' })).toEqual({ ok: true });
    expect(ensureOrganisation).not.toHaveBeenCalled();
    expect(admin.ops('contributor_registrations', 'update')[0].payload).toEqual({
      access_status: 'approved',
      org_id: 'org-existing',
    });
  });

  it('passes an empty string for missing public_links', async () => {
    setup({ registration: { data: { ...REG, public_links: null } } });
    await approveContributor({ registrationId: 'reg-1' });
    expect(ensureOrganisation).toHaveBeenCalledWith('Acme Foundation', 'implementer', '');
  });

  it('looks up by user id when given one', async () => {
    setup({ registration: { data: { ...REG, org_id: 'o' } } });
    await approveContributor({ userId: 'u1' });
    expect(admin.ops('contributor_registrations', 'select')[0].filters).toEqual([['eq', 'user_id', 'u1']]);
  });

  it('uses the registration’s own user_id for the grant, not anything else', async () => {
    setup({ registration: { data: { ...REG, user_id: 'owner', org_id: 'o' } } });
    await approveContributor({ registrationId: 'reg-1' });
    expect(admin.ops('user_roles', 'upsert')[0].payload).toEqual({ user_id: 'owner', role: 'pathway_contributor' });
  });

  it('a user with no registration just gets the role', async () => {
    setup({ registration: { data: null } });
    expect(await approveContributor({ userId: 'u9' })).toEqual({ ok: true });
    expect(admin.ops('user_roles', 'upsert')[0].payload).toEqual({ user_id: 'u9', role: 'pathway_contributor' });
    expect(admin.ops('contributor_registrations', 'update')).toHaveLength(0);
    expect(ensureOrganisation).not.toHaveBeenCalled();
  });

  it('404s an unknown registration id without granting anything', async () => {
    setup({ registration: { data: null } });
    expect(await approveContributor({ registrationId: 'missing' })).toEqual({
      ok: false,
      error: 'Registration not found.',
      status: 404,
    });
    expect(admin.ops('user_roles')).toHaveLength(0);
  });

  it('500s when the registration lookup fails', async () => {
    setup({ registration: { error: { message: 'db down' } } });
    expect(await approveContributor({ userId: 'u1' })).toEqual({ ok: false, error: 'db down', status: 500 });
    expect(admin.ops('user_roles')).toHaveLength(0);
  });

  it('500s without granting the role when ensureOrganisation throws', async () => {
    setup({ registration: { data: { ...REG } } });
    vi.mocked(ensureOrganisation).mockRejectedValueOnce(new Error('Could not create organisation'));
    const result = await approveContributor({ registrationId: 'reg-1' });
    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(result.ok === false && result.error).toContain('Could not create organisation');
    expect(admin.ops('user_roles')).toHaveLength(0);
    expect(admin.ops('contributor_registrations', 'update')).toHaveLength(0);
  });

  it('stops before the status update when the role grant fails', async () => {
    setup({ registration: { data: { ...REG, org_id: 'o' } }, roleUpsert: { error: { message: 'fk violation' } } });
    expect(await approveContributor({ registrationId: 'reg-1' })).toEqual({ ok: false, error: 'fk violation', status: 500 });
    expect(admin.ops('contributor_registrations', 'update')).toHaveLength(0);
  });

  it('500s when the role grant fails for a user with no registration', async () => {
    setup({ registration: { data: null }, roleUpsert: { error: { message: 'x' } } });
    expect(await approveContributor({ userId: 'u1' })).toEqual({ ok: false, error: 'x', status: 500 });
  });

  it('500s when the status update fails (role already granted, Approve stays available)', async () => {
    setup({ registration: { data: { ...REG, org_id: 'o' } }, statusUpdate: { error: { message: 'update failed' } } });
    expect(await approveContributor({ registrationId: 'reg-1' })).toEqual({
      ok: false,
      error: 'update failed',
      status: 500,
    });
    expect(admin.ops('user_roles', 'upsert')).toHaveLength(1);
  });
});

describe('revokeContributor', () => {
  it('by registration id: removes the role of the registration’s user, then marks rejected', async () => {
    setup({ registration: { data: { user_id: 'u1' } } });
    expect(await revokeContributor({ registrationId: 'reg-1' })).toEqual({ ok: true });

    expect(admin.ops('contributor_registrations', 'select')[0].filters).toEqual([['eq', 'id', 'reg-1']]);
    const [del] = admin.ops('user_roles', 'delete');
    expect(del.filters).toEqual([
      ['eq', 'user_id', 'u1'],
      ['eq', 'role', 'pathway_contributor'],
    ]);
    const [update] = admin.ops('contributor_registrations', 'update');
    expect(update.payload).toEqual({ access_status: 'rejected' });
    expect(update.filters).toEqual([['eq', 'user_id', 'u1']]);

    const order = admin.queryOps.map((o) => `${o.table}:${o.action}`);
    expect(order).toEqual(['contributor_registrations:select', 'user_roles:delete', 'contributor_registrations:update']);
  });

  it('by user id: no lookup, only the pathway_contributor role is removed', async () => {
    expect(await revokeContributor({ userId: 'u2' })).toEqual({ ok: true });
    expect(admin.ops('contributor_registrations', 'select')).toHaveLength(0);
    expect(admin.ops('user_roles', 'delete')[0].filters).toEqual([
      ['eq', 'user_id', 'u2'],
      ['eq', 'role', 'pathway_contributor'],
    ]);
  });

  it('404s an unknown registration id without touching roles', async () => {
    setup({ registration: { data: null } });
    expect(await revokeContributor({ registrationId: 'nope' })).toEqual({
      ok: false,
      error: 'Registration not found.',
      status: 404,
    });
    expect(admin.ops('user_roles')).toHaveLength(0);
  });

  it('500s when the registration lookup fails', async () => {
    setup({ registration: { error: { message: 'db down' } } });
    expect(await revokeContributor({ registrationId: 'reg-1' })).toEqual({ ok: false, error: 'db down', status: 500 });
    expect(admin.ops('user_roles')).toHaveLength(0);
  });

  it('500s and leaves the registration alone when the role delete fails', async () => {
    setup({ roleDelete: { error: { message: 'rls' } } });
    expect(await revokeContributor({ userId: 'u1' })).toEqual({ ok: false, error: 'rls', status: 500 });
    expect(admin.ops('contributor_registrations', 'update')).toHaveLength(0);
  });

  it('500s when the status update fails', async () => {
    setup({ statusUpdate: { error: { message: 'update failed' } } });
    expect(await revokeContributor({ userId: 'u1' })).toEqual({ ok: false, error: 'update failed', status: 500 });
  });
});
