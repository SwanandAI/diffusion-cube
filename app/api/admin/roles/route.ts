import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { DEFAULT_ROLE_GRANTED_FLAG, isAdmin, type Role } from '@/lib/roles';
import { approveContributor, revokeContributor } from '@/lib/contributor-registration-server';

const VALID_ROLES: Role[] = ['general_user', 'adopter', 'pathway_contributor', 'admin'];

export async function POST(req: Request) {
  // Never trust the client on this — re-check against the caller's own
  // session, same as the real enforcement boundary in app/api/chat/route.ts.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!(await isAdmin(supabase, user?.email))) {
    return Response.json({ error: 'Not authorized.' }, { status: 403 });
  }

  const { user_id, role, action } = await req.json();

  if (typeof user_id !== 'string' || !VALID_ROLES.includes(role) || (action !== 'add' && action !== 'remove')) {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const admin = createAdminClient();

  if (action === 'add' && role === 'pathway_contributor') {
    // Goes through the same path as the registration Approve button so the
    // registration's access_status (and org_id) move with the role — a bare
    // role insert left previously rejected users stuck on "Registration not
    // approved" in /contribute.
    const result = await approveContributor({ userId: user_id });
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  } else if (action === 'add') {
    // Upsert so re-granting a role the user already has is a no-op, not a 500.
    const { error } = await admin.from('user_roles').upsert({ user_id, role }, { onConflict: 'user_id,role' });
    if (error) return Response.json({ error: error.message }, { status: 500 });
  } else if (role === 'pathway_contributor') {
    // Mirror of the add branch: removing the role also marks the
    // registration 'rejected', so /contribute doesn't show "under review".
    const result = await revokeContributor({ userId: user_id });
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  } else {
    const { error } = await admin.from('user_roles').delete().eq('user_id', user_id).eq('role', role);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  // Any removal settles the one-time default grant, so the user can't get
  // 'adopter' back by calling /api/auth/grant-default-role (which it would
  // otherwise do for an account granted before that flag existed).
  if (action === 'remove') {
    const { error } = await admin.auth.admin.updateUserById(user_id, {
      app_metadata: { [DEFAULT_ROLE_GRANTED_FLAG]: true },
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
