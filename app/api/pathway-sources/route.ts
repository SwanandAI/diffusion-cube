import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authorizePathwayContributor } from '@/lib/toolkit-assets-server'
import {
  MAX_SOURCE_TEXT_CHARS,
  SOURCES_BUCKET,
  isContributorSourcePath,
  saveContributorSource,
} from '@/lib/pathway-store'

import { withErrorHandling } from '@/lib/errors'
// Step 2 of keeping a contributor's document (migration 0043): records it in
// pathway_sources with the text the browser extracted, and — when step 1's
// upload worked — the stored file's path. Every document sent is kept, with
// no per-file choice; it is never embedded. Once the pathway is published,
// lib/retrieval.ts may read its text to answer an adopter's one-pathway
// question that the write-up doesn't cover. The same text sent twice is
// kept once (the duplicate's just-uploaded file is removed).
async function handlePOST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { pathwayId, designId, fileName, mimeType, storagePath, text } = body as Record<string, unknown>

  const supabase = await createClient()
  const auth = await authorizePathwayContributor(supabase, pathwayId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (typeof designId !== 'string' || !designId) {
    return NextResponse.json({ error: 'designId required' }, { status: 400 })
  }
  if (typeof fileName !== 'string' || !fileName.trim()) {
    return NextResponse.json({ error: 'fileName required' }, { status: 400 })
  }
  if (typeof text !== 'string') {
    return NextResponse.json({ error: 'text required' }, { status: 400 })
  }
  if (text.length > MAX_SOURCE_TEXT_CHARS) {
    return NextResponse.json({ error: 'This document is too long to keep.' }, { status: 413 })
  }
  if (storagePath !== undefined && storagePath !== null && !isContributorSourcePath(auth.pathwayId, storagePath)) {
    return NextResponse.json({ error: 'Invalid storagePath' }, { status: 400 })
  }

  // The design must be the caller's own workspace for this pathway — the
  // session client's RLS only returns the caller's own designs (the same
  // check /api/pathways/assemble makes).
  const { data: design } = await supabase.from('designs').select('id, pathway_id').eq('id', designId).maybeSingle()
  if (!design || design.pathway_id !== auth.pathwayId) {
    return NextResponse.json({ error: 'Not your workspace for this pathway' }, { status: 403 })
  }

  const admin = createAdminClient()
  const path = typeof storagePath === 'string' ? storagePath : null
  const saved = await saveContributorSource(
    {
      pathwayId: auth.pathwayId,
      designId,
      uploadedBy: auth.userId,
      fileName: fileName.trim(),
      mimeType: typeof mimeType === 'string' && mimeType ? mimeType.slice(0, 200) : null,
      storagePath: path,
      text,
    },
    admin
  )

  // A retry whose first attempt was saved (its response lost) re-sends the
  // same path: that file IS the kept row's, so it stays.
  if (saved.duplicate && path && path !== saved.storagePath) {
    const { error } = await admin.storage.from(SOURCES_BUCKET).remove([path])
    if (error) console.error('[pathway-sources] remove duplicate upload:', error)
  }

  return NextResponse.json({ id: saved.id, sourceKey: saved.sourceKey, duplicate: saved.duplicate })
}

// The documents this workspace has kept as originals, for the Files panel
// ("Saved" vs "Not stored"). File names only — never text or storage paths.
async function handleGET(req: NextRequest) {
  const pathwayId = req.nextUrl.searchParams.get('pathwayId')
  const designId = req.nextUrl.searchParams.get('designId')

  const supabase = await createClient()
  const auth = await authorizePathwayContributor(supabase, pathwayId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!designId) return NextResponse.json({ error: 'designId required' }, { status: 400 })

  const { data: design } = await supabase.from('designs').select('id, pathway_id').eq('id', designId).maybeSingle()
  if (!design || design.pathway_id !== auth.pathwayId) {
    return NextResponse.json({ error: 'Not your workspace for this pathway' }, { status: 403 })
  }

  const { data, error } = await createAdminClient()
    .from('pathway_sources')
    .select('file_name')
    .eq('pathway_id', auth.pathwayId)
    .eq('design_id', designId)
    .eq('origin', 'contributor')
  if (error) throw error
  const files = [...new Set(((data ?? []) as { file_name: string }[]).map((r) => r.file_name))]
  return NextResponse.json({ files })
}

export const POST = withErrorHandling('api/pathway-sources', handlePOST)
export const GET = withErrorHandling('api/pathway-sources', handleGET)
