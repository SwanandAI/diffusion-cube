import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dropAssetsFromReviewCopy, removeAssetObjects } from '@/lib/toolkit-assets-server'

// The contributor's "No — delete this contribution" answer to "May this
// pathway be published?": deletes their workspace, its drafts, and every
// toolkit asset they shared from it that isn't live yet (files included).
// Assets already published with an earlier approval stay — withdrawing a
// live asset is out of scope.
//
// Only the owner can do this: the design is read with the caller's own
// session (RLS returns only their own designs) and deleted the same way
// (0001's owner-only delete policy). The service-role client is used only
// for the parts RLS doesn't let a contributor write: their asset rows (0034
// removed client writes on contribution_units) and the pathway's pointers to
// this workspace's draft rows, which would otherwise block the delete
// (0032's foreign keys have no ON DELETE action). If this workspace's draft
// was waiting for review, that review request is withdrawn too.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ designId: string }> }) {
  const { designId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: design } = await supabase
    .from('designs')
    .select('id, pathway_id')
    .eq('id', designId)
    .maybeSingle()
  if (!design) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const admin = createAdminClient()

  if (design.pathway_id) {
    const { data: removed, error: assetsErr } = await admin
      .from('contribution_units')
      .delete()
      .eq('design_id', designId)
      .eq('user_id', user.id)
      .eq('unit_type', 'toolkit-asset')
      .is('published_at', null)
      .select('unit_internal_id, storage_path')
    if (assetsErr) {
      console.error('[contributions/delete] assets:', assetsErr)
      return NextResponse.json({ error: 'Could not delete this contribution. Try again.' }, { status: 500 })
    }
    await removeAssetObjects((removed ?? []).flatMap((a) => (a.storage_path ? [a.storage_path as string] : [])))
    await dropAssetsFromReviewCopy(design.pathway_id, (removed ?? []).map((a) => a.unit_internal_id as string))

    const { data: docs } = await admin.from('design_documents').select('id').eq('design_id', designId)
    const docIds = new Set((docs ?? []).map((d) => d.id as string))
    const { data: pathway } = await admin
      .from('pathways')
      .select('assembled_design_doc_id, published_design_doc_id, review_requested')
      .eq('id', design.pathway_id)
      .maybeSingle()
    if (pathway) {
      const patch: Record<string, unknown> = {}
      if (pathway.assembled_design_doc_id && docIds.has(pathway.assembled_design_doc_id)) {
        patch.assembled_design_doc_id = null
        if (pathway.review_requested) patch.review_requested = false
      }
      if (pathway.published_design_doc_id && docIds.has(pathway.published_design_doc_id)) {
        patch.published_design_doc_id = null
      }
      if (Object.keys(patch).length > 0) {
        const { error } = await admin.from('pathways').update(patch).eq('id', design.pathway_id)
        if (error) {
          console.error('[contributions/delete] pathway pointers:', error)
          return NextResponse.json({ error: 'Could not delete this contribution. Try again.' }, { status: 500 })
        }
      }
    }
  }

  const { error } = await supabase.from('designs').delete().eq('id', designId)
  if (error) {
    console.error('[contributions/delete] design:', error)
    return NextResponse.json({ error: 'Could not delete this contribution. Try again.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
