import { createClient, createStatelessClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Self-serve permanent account deletion. Deleting the auth user cascades
// away everything personal — roles, contributor registration, every
// conversation (designs → design_documents/adoption_queries, and
// library_conversations), pathway_contributors links. Published content
// stays: published_pathways / pathways / published contribution_units keep
// their rows with the user reference nulled (migration 0033). Requires the
// account password, re-verified here. See specs/ACCOUNT_DELETION_SPEC.md.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!password) return Response.json({ error: 'Enter your password.' }, { status: 400 });

  // A live session alone isn't enough to destroy the account — re-verify the
  // password, on a throwaway client so the caller's session cookies are left
  // alone. Supabase's own sign-in rate limit applies to repeated guesses.
  const { error: passwordError } = await createStatelessClient().auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (passwordError) {
    if (passwordError.code === 'invalid_credentials') {
      return Response.json({ error: 'Incorrect password.' }, { status: 403 });
    }
    if (passwordError.code === 'over_request_rate_limit') {
      return Response.json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, { status: 429 });
    }
    console.error('[account/delete] password check', passwordError);
    return Response.json({ error: 'Could not verify your password. Please try again.' }, { status: 500 });
  }

  const admin = createAdminClient();

  // Detach published units explicitly rather than trusting the FK: without
  // migration 0033 user_id is still NOT NULL + ON DELETE CASCADE, and
  // deleteUser below would silently take published units with it. This
  // update fails loudly in that case instead — first, before anything is lost.
  const { error: unitsError } = await admin
    .from('contribution_units')
    .update({ user_id: null })
    .eq('user_id', user.id)
    .not('published_at', 'is', null);
  if (unitsError) {
    console.error('[account/delete] published units — is migration 0033 applied?', unitsError);
    return Response.json({ error: 'Could not delete your account.' }, { status: 500 });
  }

  // Unpublished drafts go with the account.
  const { error: draftsError } = await admin
    .from('contribution_units')
    .delete()
    .eq('user_id', user.id)
    .is('published_at', null);
  if (draftsError) {
    console.error('[account/delete] drafts', draftsError);
    return Response.json({ error: 'Could not delete your account.' }, { status: 500 });
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    // A concurrent request (double-click, two tabs) may have already deleted
    // this account — that's a successful end state, not a failure.
    if (error.code === 'user_not_found') return Response.json({ ok: true });
    console.error('[account/delete] deleteUser', error);
    return Response.json({ error: 'Could not delete your account.' }, { status: 500 });
  }

  return Response.json({ ok: true });
}
