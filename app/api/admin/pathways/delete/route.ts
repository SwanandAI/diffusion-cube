import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/roles';
import { removeAssetObjects } from '@/lib/toolkit-assets-server';
import { removeSourceObjects } from '@/lib/pathway-store';

import { withErrorHandling } from '@/lib/errors';
// Deletes a pathway entirely — and with it, unpublishes it. pathway_versions,
// pathway_units (its search index), pathway_sources / pathway_source_chunks,
// pathway_contributors and contribution_units all cascade on pathway_id;
// published_pathways is a view over pathways (migration 0042), so the
// pathway leaves the Explore library and every answer in the same statement.
// designs.pathway_id is set null rather than cascaded (migration 0024), so a
// contributor's own workspace survives, just unlinked.
//
// Files in storage — toolkit assets (any status) and a seeded pathway's
// original documents — are removed first: their rows cascade away with the
// pathway, and a file nobody can reach through a row must not linger in a
// bucket. A storage failure is logged, never blocks the delete.
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

  const { data: assetFiles } = await admin
    .from('contribution_units')
    .select('storage_path')
    .eq('pathway_id', pathway_id)
    .eq('unit_type', 'toolkit-asset')
    .not('storage_path', 'is', null);
  await removeAssetObjects((assetFiles ?? []).map((a) => a.storage_path as string));
  await removeSourceObjects(pathway_id, admin);

  const { error } = await admin.from('pathways').delete().eq('id', pathway_id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}

export const POST = withErrorHandling('api/admin/pathways/delete', handlePOST);
