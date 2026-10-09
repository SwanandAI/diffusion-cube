import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin, isAdminEmail } from '@/lib/roles';
import { deleteAccount } from '@/lib/account-deletion-server';

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !(await isAdmin(supabase, user.email))) {
    return Response.json({ error: 'Not authorized.' }, { status: 403 });
  }

  const { user_id } = await req.json();
  if (typeof user_id !== 'string') {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (user_id === user.id) {
    return Response.json({ error: "You can't reject your own account." }, { status: 400 });
  }

  // Reject is for a pending signup only — the admin panel shows the button
  // just on zero-role rows, but that page can be stale (another admin may
  // have approved them since), and the UI isn't the enforcement boundary.
  const admin = createAdminClient();
  const [{ data: roles, error: rolesError }, { data: target, error: targetError }] = await Promise.all([
    admin.from('user_roles').select('role').eq('user_id', user_id).limit(1),
    admin.auth.admin.getUserById(user_id),
  ]);
  if (rolesError) return Response.json({ error: rolesError.message }, { status: 500 });
  if (targetError || !target.user) return Response.json({ error: 'User not found.' }, { status: 404 });
  if (roles?.length) {
    return Response.json({ error: 'This account already has access — it is no longer a pending signup.' }, { status: 409 });
  }
  if (isAdminEmail(target.user.email)) {
    return Response.json({ error: "Admin accounts can't be rejected." }, { status: 409 });
  }

  // Deletes the account entirely rather than leaving a dangling zero-role
  // row — if rejected by mistake, the person can just sign up again with the
  // same email. Same cleanup as self-serve deletion.
  if (!(await deleteAccount(user_id, 'admin/reject'))) {
    return Response.json({ error: 'Could not delete this account.' }, { status: 500 });
  }

  return Response.json({ ok: true });
}
