import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock } from '../../helpers/supabase-mock';
import { currentRoles, hasAnyRole, hasRole, isAdmin, isAdminEmail } from '@/lib/roles';

// A session client whose user_roles answers like the "select own rows" RLS
// policy would: only the caller's own grants, filtered by any eq('role').
function sessionWithRoles(roles: string[], error: { message: string } | null = null) {
  return createSupabaseMock({
    user: { id: 'u1', email: 'u1@example.com' },
    tables: {
      user_roles: (op) => {
        if (error) return { error };
        const wanted = op.filters.find((f) => f[0] === 'eq' && f[1] === 'role')?.[2] as string | undefined;
        const rows = roles.filter((r) => !wanted || r === wanted).map((role) => ({ role }));
        if (op.single) return { data: rows[0] ?? null };
        return { data: rows };
      },
    },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('hasRole', () => {
  it('is true when the caller holds the role', async () => {
    const sb = sessionWithRoles(['adopter', 'pathway_contributor']);
    expect(await hasRole(sb.client, 'pathway_contributor')).toBe(true);
  });

  it('is false when the caller does not hold the role', async () => {
    const sb = sessionWithRoles(['adopter']);
    expect(await hasRole(sb.client, 'admin')).toBe(false);
  });

  it('queries user_roles by role with maybeSingle (never the service-role client)', async () => {
    const sb = sessionWithRoles(['admin']);
    await hasRole(sb.client, 'admin');
    const [op] = sb.ops('user_roles', 'select');
    expect(op.columns).toBe('role');
    expect(op.filters).toEqual([['eq', 'role', 'admin']]);
    expect(op.single).toBe('maybeSingle');
  });

  it('fails closed when the query errors', async () => {
    const sb = sessionWithRoles(['admin'], { message: 'boom' });
    expect(await hasRole(sb.client, 'admin')).toBe(false);
  });
});

describe('currentRoles', () => {
  it('returns every role the caller holds as a Set', async () => {
    const sb = sessionWithRoles(['adopter', 'admin']);
    const roles = await currentRoles(sb.client);
    expect(roles).toEqual(new Set(['adopter', 'admin']));
  });

  it('returns an empty set for a zero-role account', async () => {
    const sb = sessionWithRoles([]);
    expect((await currentRoles(sb.client)).size).toBe(0);
  });

  // Throwing (→ 500) rather than returning an empty set, which callers would
  // read as "no roles" and answer with a misleading 403.
  it('throws when the query errors', async () => {
    const sb = sessionWithRoles(['admin'], { message: 'boom' });
    await expect(currentRoles(sb.client)).rejects.toMatchObject({ message: 'boom' });
  });

  it('makes a single query', async () => {
    const sb = sessionWithRoles(['adopter']);
    await currentRoles(sb.client);
    expect(sb.queryOps).toHaveLength(1);
  });
});

describe('hasAnyRole', () => {
  it('is true when the caller holds at least one role', async () => {
    const sb = sessionWithRoles(['adopter']);
    expect(await hasAnyRole(sb.client)).toBe(true);
    const [op] = sb.ops('user_roles');
    expect(op.filters).toEqual([['limit', 1]]);
    expect(op.single).toBe('maybeSingle');
  });

  it('is false for a zero-role account', async () => {
    expect(await hasAnyRole(sessionWithRoles([]).client)).toBe(false);
  });

  it('is false when the query errors', async () => {
    expect(await hasAnyRole(sessionWithRoles(['adopter'], { message: 'x' }).client)).toBe(false);
  });
});

describe('isAdminEmail', () => {
  it('matches an address listed in ADMIN_EMAILS', () => {
    expect(isAdminEmail('env-admin@example.com')).toBe(true);
  });

  it('is case-insensitive on both sides', () => {
    vi.stubEnv('ADMIN_EMAILS', 'Boss@Example.COM');
    expect(isAdminEmail('boss@example.com')).toBe(true);
    expect(isAdminEmail('BOSS@EXAMPLE.COM')).toBe(true);
  });

  it('trims whitespace around list entries and ignores empty entries', () => {
    vi.stubEnv('ADMIN_EMAILS', ' a@example.com ,, b@example.com ,');
    expect(isAdminEmail('a@example.com')).toBe(true);
    expect(isAdminEmail('b@example.com')).toBe(true);
    expect(isAdminEmail('')).toBe(false);
  });

  it('does not match a non-listed address', () => {
    expect(isAdminEmail('someone@example.com')).toBe(false);
  });

  it('does not do substring or suffix matching', () => {
    expect(isAdminEmail('admin@example.com')).toBe(false);
    expect(isAdminEmail('xenv-admin@example.com')).toBe(false);
    expect(isAdminEmail('env-admin@example.com.evil.test')).toBe(false);
  });

  it.each([null, undefined, ''])('is false for %s', (email) => {
    expect(isAdminEmail(email)).toBe(false);
  });

  it('is false for everyone when ADMIN_EMAILS is empty', () => {
    vi.stubEnv('ADMIN_EMAILS', '');
    expect(isAdminEmail('env-admin@example.com')).toBe(false);
  });

  it('is false for everyone when ADMIN_EMAILS is unset', () => {
    vi.stubEnv('ADMIN_EMAILS', undefined as unknown as string);
    delete process.env.ADMIN_EMAILS;
    expect(isAdminEmail('env-admin@example.com')).toBe(false);
  });

  it('is false for everyone when ADMIN_EMAILS is only commas/whitespace', () => {
    vi.stubEnv('ADMIN_EMAILS', ' , ,  ');
    expect(isAdminEmail(' ')).toBe(false);
  });
});

describe('isAdmin', () => {
  it('lets an ADMIN_EMAILS address in without querying user_roles', async () => {
    const sb = sessionWithRoles([]);
    expect(await isAdmin(sb.client, 'env-admin@example.com')).toBe(true);
    expect(sb.queryOps).toHaveLength(0);
  });

  it('lets a database admin grant in', async () => {
    const sb = sessionWithRoles(['admin']);
    expect(await isAdmin(sb.client, 'db-admin@example.com')).toBe(true);
  });

  it('refuses a non-admin', async () => {
    const sb = sessionWithRoles(['adopter', 'pathway_contributor']);
    expect(await isAdmin(sb.client, 'someone@example.com')).toBe(false);
  });

  it('refuses an anonymous caller with no email and no grant', async () => {
    const sb = sessionWithRoles([]);
    expect(await isAdmin(sb.client, null)).toBe(false);
  });

  it('still checks the database when the email is missing', async () => {
    const sb = sessionWithRoles(['admin']);
    expect(await isAdmin(sb.client, undefined)).toBe(true);
  });

  it('fails closed when the role query errors for a non-listed address', async () => {
    const sb = sessionWithRoles(['admin'], { message: 'down' });
    expect(await isAdmin(sb.client, 'someone@example.com')).toBe(false);
  });
});
