import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasAnyRole, hasRole } from '@/lib/roles'
import { isValidSlug } from '@/lib/slug'
import { saveVersion } from '@/lib/pathway-store'
import { applyToolkitAssetFiles } from '@/lib/toolkit-assets'
import { loadPathwayToolkitAssets, toBlockEntry } from '@/lib/toolkit-assets-server'

import { withErrorHandling } from '@/lib/errors'
// "Send for review": saves a contributor's current pathway draft, verbatim,
// as the pathway's next version (pathway_versions, via lib/pathway-store.ts)
// and as pathways.content_cache — no GitHub commit since the pathway-storage
// feature (docs/features/pathway-storage/). This does NOT make it live: only
// an admin's publish (app/api/admin/pathways/publish) does. Whatever
// design_documents (doc_type='draft') holds for this design is saved
// exactly as-is. No app-level reformatting or
// unit extraction: when this pathway already has a published document, the
// contributor's draft was generated as a merge of it (see
// pathwayDraftSystemPrompt's merge rules and generatePathwayDraft in
// lib/adoption-conversation.ts) — the merging happens once, in that
// generation call, not again here.
//
// The one thing this route does add: the pathway's shared files, in a File
// column of Section 4's table (applyToolkitAssetFiles in
// lib/toolkit-assets.ts), regenerated from contribution_units and written
// into the saved version so the admin reviews the assets as
// part of the pathway. The draft itself never carries them.
async function handlePOST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await hasAnyRole(supabase))) {
    return NextResponse.json({ error: 'Account not approved' }, { status: 403 })
  }
  if (!(await hasRole(supabase, 'pathway_contributor'))) {
    return NextResponse.json({ error: 'Contributor role required' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { pathwayId, designId } = body as { pathwayId?: string; designId?: string }
  if (!pathwayId) return NextResponse.json({ error: 'pathwayId required' }, { status: 400 })
  if (!designId) return NextResponse.json({ error: 'designId required' }, { status: 400 })

  // Verify the caller is a contributor to this pathway
  const { data: membership } = await supabase
    .from('pathway_contributors')
    .select('user_id')
    .eq('pathway_id', pathwayId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) {
    return NextResponse.json({ error: 'Not a contributor to this pathway' }, { status: 403 })
  }

  // The design must be the caller's own workspace for this pathway — the
  // session client's RLS only returns the caller's own designs. Without this,
  // a member of any pathway could publish (and read back) another user's
  // private draft by passing their designId.
  const { data: design } = await supabase
    .from('designs')
    .select('id, pathway_id')
    .eq('id', designId)
    .maybeSingle()
  if (!design || design.pathway_id !== pathwayId) {
    return NextResponse.json({ error: 'Not your workspace for this pathway' }, { status: 403 })
  }

  const admin = createAdminClient()

  const { data: pathway, error: pwErr } = await admin
    .from('pathways')
    .select('id, slug')
    .eq('id', pathwayId)
    .single()
  if (pwErr || !pathway) return NextResponse.json({ error: 'Pathway not found' }, { status: 404 })
  // Unit ids and links are built from the slug — refuse a malformed one
  // (e.g. a row inserted with "../../x").
  if (!isValidSlug(pathway.slug)) {
    console.error('[assemble] refusing invalid pathway slug:', pathway.slug)
    return NextResponse.json({ error: 'This pathway has an invalid slug and cannot be published.' }, { status: 400 })
  }
  // Drafts are versioned (every generate/revise appends a row — see
  // insertDraftVersion in lib/design-documents.ts), so this must pick the
  // latest explicitly rather than an arbitrary row.
  const { data: draftRow } = await admin
    .from('design_documents')
    .select('id, content')
    .eq('design_id', designId)
    .eq('user_id', user.id)
    .eq('doc_type', 'draft')
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!draftRow?.content) {
    console.error('[assemble] no draft row for design_id:', designId)
    return NextResponse.json(
      { error: 'No draft found for this workspace. Generate a pathway document first.' },
      { status: 400 }
    )
  }

  // A storage or database failure throws to withErrorHandling, which records
  // the stack and answers with the generic message.
  const assets = await loadPathwayToolkitAssets(pathwayId)
  const assembled = applyToolkitAssetFiles(draftRow.content, assets.map(toBlockEntry))

  await saveVersion({
    pathwayId,
    content: assembled,
    source: 'contributor',
    designDocumentId: draftRow.id,
    createdBy: user.id,
  }, admin)

  // Best-effort — the version is already saved either way.
  await admin.from('pathways').update({
    content_cache: assembled,
    review_requested: true,
    assembled_design_doc_id: draftRow.id,
  }).eq('id', pathwayId)

  return NextResponse.json({ content: draftRow.content, slug: pathway.slug, assembled_design_doc_id: draftRow.id })
}

export const POST = withErrorHandling('api/pathways/assemble', handlePOST)
