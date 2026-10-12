// Server-only counterpart to lib/contributor-registration.ts (which is
// client-side). Client components must not import this — it uses the
// service-role client.

import { createAdminClient } from '@/lib/supabase/admin';
import { ensureOrganisation } from '@/lib/organisations';

type RegistrationResult = { ok: true } | { ok: false; error: string; status: number };

/**
 * Approves a contributor: backfills contributor_registrations.org_id if it's
 * still null, sets access_status to 'approved', and grants the
 * pathway_contributor role. The registration status and the role must move
 * together — app/contribute/page.tsx checks access_status === 'rejected'
 * before it checks the role, so a role grant alone leaves a previously
 * rejected user stuck on "Registration not approved".
 *
 * Shared by the registration Approve button and a direct role grant from the
 * Roles panel. Looked up by registration id or by user id; a user with no
 * registration at all just gets the role.
 */
export async function approveContributor(
  by: { registrationId: string } | { userId: string }
): Promise<RegistrationResult> {
  const admin = createAdminClient();

  const query = admin
    .from('contributor_registrations')
    .select('id, user_id, organisation_name, pathway_role, public_links, org_id');
  const { data: registration, error: fetchError } = await ('registrationId' in by
    ? query.eq('id', by.registrationId)
    : query.eq('user_id', by.userId)
  ).maybeSingle();

  if (fetchError) return { ok: false, error: fetchError.message, status: 500 };
  if (!registration && 'registrationId' in by) {
    return { ok: false, error: 'Registration not found.', status: 404 };
  }

  const userId = registration?.user_id ?? ('userId' in by ? by.userId : '');

  if (registration) {
    // The "admin confirms the org into the registry on approval" step
    // migration 0023's own comment describes. Same ensureOrganisation() the
    // join route uses, so an org typed here and one picked from the
    // autocomplete both resolve to the same row rather than a duplicate.
    let orgId = registration.org_id;
    if (!orgId) {
      try {
        orgId = await ensureOrganisation(
          registration.organisation_name,
          registration.pathway_role,
          registration.public_links ?? ''
        );
      } catch (err) {
        return { ok: false, error: String(err), status: 500 };
      }
    }

    // Role first, status second: if the status update then fails, the row
    // still isn't 'approved', so the panel keeps its Approve button for a
    // retry — rather than an 'approved' row with no role and no button.
    const roleResult = await grantContributorRole(userId);
    if (!roleResult.ok) return roleResult;

    const { error: statusError } = await admin
      .from('contributor_registrations')
      .update({ access_status: 'approved', org_id: orgId })
      .eq('id', registration.id);
    if (statusError) return { ok: false, error: statusError.message, status: 500 };
    return { ok: true };
  }

  return grantContributorRole(userId);
}

async function grantContributorRole(userId: string): Promise<RegistrationResult> {
  const { error } = await createAdminClient()
    .from('user_roles')
    .upsert({ user_id: userId, role: 'pathway_contributor' }, { onConflict: 'user_id,role' });
  if (error) return { ok: false, error: error.message, status: 500 };
  return { ok: true };
}

/**
 * The inverse of approveContributor(): removes the pathway_contributor role
 * and marks the registration 'rejected'. Used by the registration Reject
 * button and by removing the role from the Roles panel, so neither leaves
 * the two out of step — a rejected registration that still had the role kept
 * every contributor API working (they only check the role), and a removed
 * role with an 'approved' registration showed /contribute's "under review"
 * screen as if the user had just applied. 'rejected' also brings back the
 * Approve button in the admin panel, so access can be restored later.
 *
 * Role first, status second, so a partial failure never leaves the role in
 * place behind a rejected registration.
 */
export async function revokeContributor(
  by: { registrationId: string } | { userId: string }
): Promise<RegistrationResult> {
  const admin = createAdminClient();

  let userId: string;
  if ('registrationId' in by) {
    const { data: registration, error } = await admin
      .from('contributor_registrations')
      .select('user_id')
      .eq('id', by.registrationId)
      .maybeSingle();
    if (error) return { ok: false, error: error.message, status: 500 };
    if (!registration) return { ok: false, error: 'Registration not found.', status: 404 };
    userId = registration.user_id;
  } else {
    userId = by.userId;
  }

  const { error: roleError } = await admin
    .from('user_roles')
    .delete()
    .eq('user_id', userId)
    .eq('role', 'pathway_contributor');
  if (roleError) return { ok: false, error: roleError.message, status: 500 };

  // A user with no registration at all just loses the role — nothing to update.
  const { error: statusError } = await admin
    .from('contributor_registrations')
    .update({ access_status: 'rejected' })
    .eq('user_id', userId);
  if (statusError) return { ok: false, error: statusError.message, status: 500 };

  return { ok: true };
}
