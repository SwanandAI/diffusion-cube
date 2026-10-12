import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/roles';
import { approveContributor } from '@/lib/contributor-registration-server';

// Approving a registration flips access_status so /contribute stops showing
// the "under review" / "not approved" screen, grants the pathway_contributor
// role (the real gate — see lib/roles.ts), and backfills org_id. Works on a
// pending or a previously rejected registration. All of it lives in
// approveContributor() so a direct role grant from the Roles panel does the
// same thing.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!(await isAdmin(supabase, user?.email))) {
    return Response.json({ error: 'Not authorized.' }, { status: 403 });
  }

  const { registration_id } = await req.json();
  if (typeof registration_id !== 'string') {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const result = await approveContributor({ registrationId: registration_id });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

  return Response.json({ ok: true });
}
