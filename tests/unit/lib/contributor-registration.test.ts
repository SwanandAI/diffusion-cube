import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type SupabaseMock } from '../../helpers/supabase-mock';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import {
  PATHWAY_ROLES,
  SHARING_LEVELS,
  SHARING_OPTIONS,
  isSharingLevel,
  sharingColumns,
  sharingLevelFromRow,
  submitContributorRegistration,
  type ContributorRegistrationInput,
} from '@/lib/contributor-registration';

describe('constants', () => {
  it('lists the eight pathway roles', () => {
    expect(PATHWAY_ROLES).toHaveLength(8);
    expect(new Set(PATHWAY_ROLES).size).toBe(8);
  });

  it('offers exactly one option per sharing level, in order', () => {
    expect(SHARING_OPTIONS.map((o) => o.value)).toEqual([...SHARING_LEVELS]);
    for (const o of SHARING_OPTIONS) {
      expect(o.label).not.toBe('');
      expect(o.description).not.toBe('');
    }
  });
});

describe('isSharingLevel', () => {
  it.each(['none', 'name', 'name_and_email'])('accepts %s', (value) => {
    expect(isSharingLevel(value)).toBe(true);
  });

  it.each([['NAME'], [''], ['email'], ['name and email'], [null], [undefined], [1], [['name']], ['constructor']])(
    'rejects %j',
    (value) => {
      expect(isSharingLevel(value)).toBe(false);
    }
  );
});

describe('sharingLevelFromRow / sharingColumns', () => {
  it.each([
    [{ share_name: false, share_contact: false }, 'none'],
    [{ share_name: true, share_contact: false }, 'name'],
    [{ share_name: true, share_contact: true }, 'name_and_email'],
    // Contact implies name, even if an old row has share_name off.
    [{ share_name: false, share_contact: true }, 'name_and_email'],
  ])('%j -> %s', (row, level) => {
    expect(sharingLevelFromRow(row)).toBe(level);
  });

  it.each([
    ['none', { share_name: false, share_contact: false, contact_info: '' }],
    ['name', { share_name: true, share_contact: false, contact_info: '' }],
    ['name_and_email', { share_name: true, share_contact: true, contact_info: 'poc@example.org' }],
  ] as const)('%s maps to its three columns (email stored only when shared)', (level, columns) => {
    expect(sharingColumns(level, 'poc@example.org')).toEqual(columns);
  });

  it('round-trips every level', () => {
    for (const level of SHARING_LEVELS) expect(sharingLevelFromRow(sharingColumns(level, 'x@y.z'))).toBe(level);
  });
});

describe('submitContributorRegistration', () => {
  let sb: SupabaseMock;
  const input: ContributorRegistrationInput = {
    organisationName: 'EkStep Foundation',
    organisationUrl: 'https://ekstep.org',
    pathwayRole: 'Program Owner',
    pocName: 'Asha',
    pocEmail: 'asha@example.org',
    pathwayDescription: 'Voice advisory for farmers',
    termsAccepted: true,
    sharingLevel: 'name',
  };

  beforeEach(() => {
    sb = createSupabaseMock({ tables: { contributor_registrations: {} } });
    vi.mocked(createClient).mockReturnValue(sb.client);
  });

  it('inserts one row mapped from the form', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
    try {
      await expect(submitContributorRegistration('user-1', input)).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
    const [op] = sb.ops('contributor_registrations', 'insert');
    expect(op.payload).toEqual({
      user_id: 'user-1',
      organisation_name: 'EkStep Foundation',
      public_links: 'https://ekstep.org',
      pathway_role: 'Program Owner',
      poc_name: 'Asha',
      poc_email: 'asha@example.org',
      pathway_description: 'Voice advisory for farmers',
      declaration_accepted: true,
      mou_accepted: true,
      terms_accepted_at: '2026-10-26T12:00:00.000Z',
      share_name: true,
      share_contact: false,
      contact_info: '',
    });
  });

  it('records no acceptance timestamp when terms were not accepted', async () => {
    await submitContributorRegistration('user-1', { ...input, termsAccepted: false });
    expect(sb.ops('contributor_registrations', 'insert')[0].payload).toMatchObject({
      declaration_accepted: false,
      mou_accepted: false,
      terms_accepted_at: null,
    });
  });

  it('returns the database error (e.g. a second registration for the same user)', async () => {
    sb = createSupabaseMock({
      tables: { contributor_registrations: { error: { message: 'duplicate key value', code: '23505' } } },
    });
    vi.mocked(createClient).mockReturnValue(sb.client);
    await expect(submitContributorRegistration('user-1', input)).resolves.toEqual({ ok: false, error: 'duplicate key value' });
  });
});
