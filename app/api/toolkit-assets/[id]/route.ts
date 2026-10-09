import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAssetId } from '@/lib/toolkit-assets'
import {
  authorizePathwayContributor,
  dropAssetsFromReviewCopy,
  loadToolkitAsset,
  removeAssetObjects,
} from '@/lib/toolkit-assets-server'

function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

// A contributor removes one of their own toolkit assets before it goes live.
// This is how an admin's "drop this asset" review note gets acted on:
// assemble re-lists every consented asset on each Send for Review, so the
// asset has to be gone from contribution_units before the next send.
// Uploader only, unpublished only (withdrawing a live asset is out of scope);
// someone else's asset gets the same 404 as a missing one. The row is deleted
// first, guarded on published_at, so a publish racing this never leaves a
// live asset without its file; the storage object goes after, and a storage
// failure is only logged.
//
// If the asset was already sent for review, it's also taken out of the
// document the admin reviews and publishes (pathways.content_cache), so the
// admin never approves an asset that no longer exists. The copy committed to
// GitHub catches up on the next Send for Review.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isAssetId(id)) return notFound()

  const asset = await loadToolkitAsset(id)
  if (!asset) return notFound()

  const supabase = await createClient()
  const auth = await authorizePathwayContributor(supabase, asset.pathway_id)
  if (!auth.ok) {
    return auth.status === 401 ? NextResponse.json({ error: auth.error }, { status: 401 }) : notFound()
  }
  if (asset.user_id !== auth.userId) return notFound()
  if (asset.published_at) {
    return NextResponse.json({ error: 'This asset is already live and can\'t be removed.' }, { status: 409 })
  }

  const { data: deleted, error } = await createAdminClient()
    .from('contribution_units')
    .delete()
    .eq('unit_internal_id', id)
    .eq('unit_type', 'toolkit-asset')
    .is('published_at', null)
    .select('storage_path')
  if (error) {
    console.error('[toolkit-assets] remove failed:', error)
    return NextResponse.json({ error: 'Could not remove the asset. Try again.' }, { status: 500 })
  }
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: 'This asset is already live and can\'t be removed.' }, { status: 409 })
  }

  await removeAssetObjects(deleted.flatMap((d) => (d.storage_path ? [d.storage_path as string] : [])))
  await dropAssetsFromReviewCopy(asset.pathway_id, [id])
  return NextResponse.json({ ok: true })
}
