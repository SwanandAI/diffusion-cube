import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/roles';
import { removeAssetObjects } from '@/lib/toolkit-assets-server';

import { withErrorHandling } from '@/lib/errors';
// Deletes a pathway entirely — pathway_contributors and contribution_units
// both cascade on pathway_id (see migrations 0021, 0022); designs.pathway_id
// is set null rather than cascaded (migration 0024), so a contributor's own
// workspace survives, just unlinked. Does not remove anything already
// committed to GitHub (content/wiki/pathways/<slug>.md) — this only clears
// the pathway from the app's own pick list and DB-side data.
//
// Also unpublishes it: published_pathways has no FK to pathways (it's keyed
// by slug), so its row is deleted explicitly — otherwise the pathway would
// stay in the Explore library and Analyse corpus with no admin row left to
// manage it. Done before the pathway delete, so a failure here leaves the
// pathway in the admin panel to retry.
//
// Toolkit asset files (any status) are removed from storage first — their
// contribution_units rows cascade away with the pathway, and a file nobody
// can reach through a row anymore must not linger in the bucket. A storage
// failure is logged, never blocks the delete.
async function handlePOST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!(await isAdmin(supabase, user?.email))) {
    return Response.json({ error: 'Not authorized.' }, { status: 403 });
  }

  // Malformed JSON falls through to the 400 below rather than a 500.
  const { pathway_id } = (await req.json().catch(() => null)) ?? {};
  if (typeof pathway_id !== 'string') {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: pathway } = await admin.from('pathways').select('slug').eq('id', pathway_id).maybeSingle();
  if (pathway?.slug) {
    const { error: unpublishErr } = await admin.from('published_pathways').delete().eq('slug', pathway.slug);
    if (unpublishErr) return Response.json({ error: unpublishErr.message }, { status: 500 });
  }

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

export const POST = withErrorHandling('api/admin/pathways/delete', handlePOST);
