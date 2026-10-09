import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { DEFAULT_ROLE_GRANTED_FLAG } from '@/lib/roles';

// Called by the client immediately after a successful sign-up so a brand-new
// account lands with the 'adopter' role already in place — no admin approval
// wait for the Analyse flow. user_roles has RLS with no client-side insert
// policy (migration 0006), so this has to go through the service-role client.
//
// One-shot per account: the grant is recorded in app_metadata
// (DEFAULT_ROLE_GRANTED_FLAG — users can't write app_metadata), and once it's
// set this never grants again. That's what keeps an admin's removal of
// 'adopter' durable — before, any signed-in user could POST here at any time
// and get the role straight back. app/api/admin/roles sets the same flag on
// any role removal, so accounts granted before the flag existed are covered.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  if (user.app_metadata?.[DEFAULT_ROLE_GRANTED_FLAG]) {
    return Response.json({ ok: true });
  }

  const admin = createAdminClient();

  // Already has some role (granted by an admin, or before the flag existed)
  // — nothing to grant, just record that the default grant is settled.
  const { data: existingRoles, error: rolesError } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .limit(1);
  if (rolesError) return Response.json({ error: rolesError.message }, { status: 500 });

  if (!existingRoles?.length) {
    const { error } = await admin.from('user_roles').insert({ user_id: user.id, role: 'adopter' });
    // 23505 = unique_violation — a concurrent call already inserted it,
    // which is the desired end state anyway.
    if (error && error.code !== '23505') {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // app_metadata updates merge into the existing object.
  const { error: flagError } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: { [DEFAULT_ROLE_GRANTED_FLAG]: true },
  });
  if (flagError) return Response.json({ error: flagError.message }, { status: 500 });

  return Response.json({ ok: true });
}
