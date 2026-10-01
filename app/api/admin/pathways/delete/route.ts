import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/roles';
import { removeAssetObjects } from '@/lib/toolkit-assets-server';

// Deletes a pathway entirely — pathway_contributors and contribution_units
// both cascade on pathway_id (see migrations 0021, 0022); designs.pathway_id
// is set null rather than cascaded (migration 0024), so a contributor's own
// workspace survives, just unlinked. Does not remove anything already
// committed to GitHub (content/wiki/pathways/<slug>.md) — this only clears
// the pathway from the app's own pick list and DB-side data.
//
// Toolkit asset files (any status) are removed from storage first — their
// contribution_units rows cascade away with the pathway, and a file nobody
// can reach through a row anymore must not linger in the bucket. A storage
// failure is logged, never blocks the delete.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!(await isAdmin(supabase, user?.email))) {
    return Response.json({ error: 'Not authorized.' }, { status: 403 });
  }

  const { pathway_id } = await req.json();
  if (typeof pathway_id !== 'string') {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: assetFiles } = await admin
    .from('contribution_units')
    .select('storage_path')
    .eq('pathway_id', pathway_id)
    .eq('unit_type', 'toolkit-asset')
    .not('storage_path', 'is', null);
  await removeAssetObjects((assetFiles ?? []).map((a) => a.storage_path as string));

  const { error } = await admin.from('pathways').delete().eq('id', pathway_id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
