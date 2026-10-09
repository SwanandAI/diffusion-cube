// Server-only — uses the service-role client. Shared by self-serve deletion
// (app/api/account/delete) and an admin rejecting a pending signup
// (app/api/admin/reject), so both take the same cleanup path rather than the
// admin route calling deleteUser bare (skipping the published-unit detach).

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Deleting the auth user cascades away everything personal — roles,
 * contributor registration, every conversation (designs →
 * design_documents/adoption_queries, and library_conversations),
 * pathway_contributors links. Published content stays: published_pathways /
 * pathways / published contribution_units keep their rows with the user
 * reference nulled (migration 0033). See specs/ACCOUNT_DELETION_SPEC.md.
 *
 * Returns false (after logging under `logTag`) on any failure.
 */
export async function deleteAccount(userId: string, logTag: string): Promise<boolean> {
  const admin = createAdminClient();

  // Detach published units explicitly rather than trusting the FK: without
  // migration 0033 user_id is still NOT NULL + ON DELETE CASCADE, and
  // deleteUser below would silently take published units with it. This
  // update fails loudly in that case instead — first, before anything is lost.
  const { error: unitsError } = await admin
    .from('contribution_units')
    .update({ user_id: null })
    .eq('user_id', userId)
    .not('published_at', 'is', null);
  if (unitsError) {
    console.error(`[${logTag}] published units — is migration 0033 applied?`, unitsError);
    return false;
  }

  // Unpublished drafts go with the account.
  const { error: draftsError } = await admin
    .from('contribution_units')
    .delete()
    .eq('user_id', userId)
    .is('published_at', null);
  if (draftsError) {
    console.error(`[${logTag}] drafts`, draftsError);
    return false;
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    // A concurrent request (double-click, two tabs) may have already deleted
    // this account — that's a successful end state, not a failure.
    if (error.code === 'user_not_found') return true;
    console.error(`[${logTag}] deleteUser`, error);
    return false;
  }

  return true;
}
