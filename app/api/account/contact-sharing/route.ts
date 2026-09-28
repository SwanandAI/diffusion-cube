import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSharingLevel, sharingColumns } from '@/lib/contributor-registration';

// Change an approved contributor's personal contact-sharing choice from the
// Manage Account page (/account). Applies going forward only — nothing
// already shown for a published pathway is rewritten.
//
// Written with the service-role client, scoped to the caller's own row and to
// the three sharing columns only. contributor_registrations deliberately has
// no user UPDATE policy: RLS is row-level, so one would also let a user set
// their own access_status to 'approved'.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const level = body?.sharingLevel;
  if (!isSharingLevel(level)) return Response.json({ error: 'Invalid sharing option.' }, { status: 400 });

  // Read through the caller's own session (RLS: own row only).
  const { data: registration } = await supabase
    .from('contributor_registrations')
    .select('id, access_status')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!registration || registration.access_status !== 'approved') {
    return Response.json({ error: 'Only approved contributors can change this.' }, { status: 403 });
  }

  const { error } = await createAdminClient()
    .from('contributor_registrations')
    .update(sharingColumns(level, user.email))
    .eq('id', registration.id);
  if (error) {
    console.error('[account/contact-sharing]', error);
    return Response.json({ error: 'Could not save your choice. Please try again.' }, { status: 500 });
  }

  return Response.json({ ok: true });
}
