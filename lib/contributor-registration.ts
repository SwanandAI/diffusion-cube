import { createClient } from '@/lib/supabase/client';

export const PATHWAY_ROLES = [
  'Sponsoring Organization',
  'Program Owner',
  'Program Management',
  'Program Execution Partner',
  'Technology/Implementation Partner',
  'Funder',
  'Research Partner',
  'Content Partner',
] as const;

export type PathwayRole = typeof PATHWAY_ROLES[number];

// How much of the contributor's own identity gets surfaced to Explorers when
// the companion cites their pathway (see groundingRules()'s "Contributed by"
// attribution in lib/system-prompts.ts) — three mutually exclusive levels,
// nothing shared by default. Maps to contributor_registrations' share_name /
// share_contact / contact_info columns (migration 0023).
export const SHARING_LEVELS = ['none', 'name', 'name_and_email'] as const;
export type SharingLevel = (typeof SHARING_LEVELS)[number];

// Shared by the Register to Contribute form and the Manage Account page, so
// both always offer the same choices.
export const SHARING_OPTIONS: { value: SharingLevel; label: string; description: string }[] = [
  { value: 'none', label: "Don't share my contact details", description: 'Nothing about you personally is shown to Explorers.' },
  { value: 'name', label: 'Share my name only', description: 'Your name is shown alongside citations of your pathway.' },
  { value: 'name_and_email', label: 'Share my name and email', description: 'Explorers can also see your email to follow up directly.' },
];

export function isSharingLevel(value: unknown): value is SharingLevel {
  return typeof value === 'string' && (SHARING_LEVELS as readonly string[]).includes(value);
}

export function sharingLevelFromRow(row: { share_name: boolean; share_contact: boolean }): SharingLevel {
  if (row.share_contact) return 'name_and_email';
  if (row.share_name) return 'name';
  return 'none';
}

// The three columns one sharing level maps to — used for both the initial
// insert and later changes from /account (app/api/account/contact-sharing).
export function sharingColumns(level: SharingLevel, email: string) {
  return {
    share_name: level !== 'none',
    share_contact: level === 'name_and_email',
    contact_info: level === 'name_and_email' ? email : '',
  };
}

export interface ContributorRegistrationInput {
  organisationName: string;
  // Set only when the org was picked from the existing-org autocomplete —
  // informational at registration time; the actual org registry row is
  // found-or-created at join time (see app/api/pathways/[id]/join/route.ts),
  // which is when contributor_registrations.org_id gets backfilled.
  organisationUrl: string;
  pathwayRole: PathwayRole | string;
  pocName: string;
  pocEmail: string;
  pathwayDescription: string;
  // The single "I've read and agree to the Terms of Use" checkbox under
  // "Declaration and Terms" — it covers both the declaration and the terms
  // of submission (T&C doc, Tab 4).
  termsAccepted: boolean;
  sharingLevel: SharingLevel;
}

// One row per contributor, ever — see migration 0016. Insert fails on a
// second attempt for the same user (unique on user_id), which is fine since
// the gate only ever renders once per user in the first place.
export async function submitContributorRegistration(
  userId: string,
  input: ContributorRegistrationInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createClient();
  const { error } = await supabase.from('contributor_registrations').insert({
    user_id: userId,
    organisation_name: input.organisationName,
    // public_links predates the multi-contributor rework (originally a
    // generic "website/LinkedIn/coverage" field) — reused here specifically
    // for the organisation's website, since it's the one place that data
    // still needs to travel through before ensureOrganisation can set it on
    // the org registry row at join time.
    public_links: input.organisationUrl,
    pathway_role: input.pathwayRole,
    poc_name: input.pocName,
    poc_email: input.pocEmail,
    pathway_description: input.pathwayDescription,
    // One checkbox now covers what used to be two (declaration + MoU), so
    // both legacy columns record the same acceptance. terms_accepted_at is
    // the timestamp of agreeing to the Terms of Use version live at the time.
    declaration_accepted: input.termsAccepted,
    mou_accepted: input.termsAccepted,
    terms_accepted_at: input.termsAccepted ? new Date().toISOString() : null,
    // consent_name/logo/quote/blog are left at their default (false): the
    // opt-in attribution step was removed because organisation attribution
    // is no longer optional (Terms of Use §5.6).
    ...sharingColumns(input.sharingLevel, input.pocEmail),
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
