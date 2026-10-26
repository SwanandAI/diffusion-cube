import { describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type SupabaseMock, type TableHandler } from '../../helpers/supabase-mock';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { ensureOrganisation, searchOrganisations } from '@/lib/organisations';

function useOrganisations(handler: TableHandler): SupabaseMock {
  const sb = createSupabaseMock({ tables: { organisations: handler } });
  vi.mocked(createAdminClient).mockReturnValue(sb.client);
  return sb;
}

describe('searchOrganisations', () => {
  it('searches by substring, ordered by name, capped at 10', async () => {
    const orgs = [{ id: 'o1', name: 'EkStep Foundation', canonical_role: null, url: null }];
    const sb = useOrganisations({ data: orgs });
    await expect(searchOrganisations('ekstep')).resolves.toEqual(orgs);
    const [op] = sb.ops('organisations', 'select');
    expect(op.columns).toBe('id, name, canonical_role, url');
    expect(op.filters).toEqual([
      ['ilike', 'name', '%ekstep%'],
      ['order', 'name', { ascending: true }],
      ['limit', 10],
    ]);
  });

  it('returns [] when the query returns nothing', async () => {
    useOrganisations({ data: null });
    await expect(searchOrganisations('zzz')).resolves.toEqual([]);
  });
});

describe('ensureOrganisation', () => {
  it('returns the existing org id on a case-insensitive name match', async () => {
    const sb = useOrganisations((op) => (op.action === 'select' ? { data: { id: 'existing' } } : {}));
    await expect(ensureOrganisation('  EkStep Foundation  ', 'Funder', 'https://x.org')).resolves.toBe('existing');
    expect(sb.ops('organisations', 'select')[0].filters[0]).toEqual(['ilike', 'name', 'EkStep Foundation']);
    expect(sb.ops('organisations', 'insert')).toHaveLength(0);
  });

  it('creates the org (trimmed name, url only on create) when none exists', async () => {
    const sb = useOrganisations((op) => (op.action === 'insert' ? { data: { id: 'new-org' } } : { data: null }));
    await expect(ensureOrganisation(' New Org ', 'Funder', '  https://new.org  ')).resolves.toBe('new-org');
    expect(sb.ops('organisations', 'insert')[0].payload).toEqual({ name: 'New Org', canonical_role: 'Funder', url: 'https://new.org' });
  });

  it('defaults canonical_role to null and url to "" when not given', async () => {
    const sb = useOrganisations((op) => (op.action === 'insert' ? { data: { id: 'n' } } : { data: null }));
    await ensureOrganisation('Solo');
    expect(sb.ops('organisations', 'insert')[0].payload).toEqual({ name: 'Solo', canonical_role: null, url: '' });
  });

  it('throws with the org name when the insert fails', async () => {
    useOrganisations((op) => (op.action === 'insert' ? { error: { message: 'rls denied' } } : { data: null }));
    await expect(ensureOrganisation('Bad Org')).rejects.toThrow('Could not create organisation "Bad Org": rls denied');
  });

  // Regression: "_" and "%" in a name match literally, never as LIKE wildcards.
  it('escapes LIKE wildcards in an organisation name in the exact-match lookup', async () => {
    const sb = useOrganisations((op) => (op.action === 'select' ? { data: null } : { data: { id: 'n' } }));
    await ensureOrganisation('A_B 100% Labs');
    expect(sb.ops('organisations', 'select')[0].filters[0]).toEqual(['ilike', 'name', 'A\\_B 100\\% Labs']);
  });
});
