import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/roles';
import { revokeContributor } from '@/lib/contributor-registration-server';

// Rejecting also removes the pathway_contributor role (revokeContributor) —
// every contributor API gates on the role alone, so flipping access_status
// by itself left a rejected user able to keep contributing.
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

  const result = await revokeContributor({ registrationId: registration_id });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

  return Response.json({ ok: true });
}
