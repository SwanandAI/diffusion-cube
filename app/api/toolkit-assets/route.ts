import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  ASSET_MIME_BY_EXTENSION,
  MAX_ASSET_BYTES,
  assetExtension,
  displayAssetFileName,
  isAssetId,
} from '@/lib/toolkit-assets'
import {
  assetObjectSize,
  authorizePathwayContributor,
  loadPublishedToolkitAssets,
  toSummary,
} from '@/lib/toolkit-assets-server'

const DIMENSIONS = ['persona', 'solution', 'institution', 'ecosystem']
const STAGES = ['explore', 'define', 'pilot', 'scale']

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

// Public (listed in proxy.ts PUBLIC_PATHS): card metadata for published
// toolkit assets, for the download cards under /analyse and /explore
// replies. Unknown or unpublished ids are silently left out, so the client
// can pass whatever ids the model referenced and render only real ones.
// Never returns a storage path or URL.
export async function GET(req: NextRequest) {
  const ids = [...new Set((req.nextUrl.searchParams.get('ids') ?? '').split(','))].filter(isAssetId).slice(0, 20)
  const assets = await loadPublishedToolkitAssets({ ids })
  return NextResponse.json({ assets: assets.map(toSummary) })
}

// Step 2 of attaching a toolkit asset (after the contributor's explicit
// public-sharing Yes, and — for a file — after the browser uploaded it to the
// signed URL from /api/toolkit-assets/upload-url). Records it as an
// unpublished contribution_units row; it goes live only when an admin
// publishes the pathway whose reviewed document lists it
// (app/api/admin/pathways/publish). Written with the service-role client
// because migration 0034 removed every client write policy on this table.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const supabase = await createClient()
  const auth = await authorizePathwayContributor(supabase, body.pathwayId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (body.shareConsent !== true) {
    return NextResponse.json({ error: 'Public-sharing consent is required.' }, { status: 400 })
  }
  const name = text(body.name, 200)
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const kind = body.kind
  const asset: Record<string, unknown> = {}
  if (kind === 'file') {
    const storagePath = typeof body.storagePath === 'string' ? body.storagePath : ''
    const rawFileName = typeof body.fileName === 'string' ? body.fileName : ''
    const ext = assetExtension(rawFileName)
    // The path was built server-side by upload-url; still refuse anything
    // outside this pathway's own prefix.
    if (!storagePath.startsWith(`${auth.pathwayId}/`) || storagePath.includes('..') || !ext) {
      return NextResponse.json({ error: 'Invalid file.' }, { status: 400 })
    }
    const size = await assetObjectSize(storagePath)
    if (size === null) return NextResponse.json({ error: 'Uploaded file not found.' }, { status: 400 })
    if (size > MAX_ASSET_BYTES) return NextResponse.json({ error: 'File is over 25 MB.' }, { status: 400 })
    Object.assign(asset, {
      asset_kind: 'file',
      storage_path: storagePath,
      file_name: displayAssetFileName(rawFileName),
      mime_type: ASSET_MIME_BY_EXTENSION[ext],
      size_bytes: size,
      source_doc: displayAssetFileName(rawFileName),
    })
  } else if (kind === 'link') {
    const url = typeof body.linkUrl === 'string' ? body.linkUrl.trim() : ''
    let parsed: URL | null = null
    try {
      parsed = new URL(url)
    } catch {
      parsed = null
    }
    if (!parsed || parsed.protocol !== 'https:' || url.length > 2000) {
      return NextResponse.json({ error: 'Links must be valid https:// URLs.' }, { status: 400 })
    }
    Object.assign(asset, { asset_kind: 'link', link_url: url, source_doc: url })
  } else {
    return NextResponse.json({ error: 'kind must be file or link' }, { status: 400 })
  }

  // Optional link back to the contributor's own workspace — only if it really
  // is theirs (the session client's RLS returns only the caller's designs)
  // and belongs to this pathway.
  let designId: string | null = null
  if (typeof body.designId === 'string' && body.designId) {
    const { data: design } = await supabase
      .from('designs')
      .select('id, pathway_id')
      .eq('id', body.designId)
      .maybeSingle()
    if (design && design.pathway_id === auth.pathwayId) designId = design.id
  }

  const dimension = text(body.dimension, 20).toLowerCase()
  const stage = text(body.stage, 20).toLowerCase()
  const id = `asset-${randomUUID()}`
  const admin = createAdminClient()
  const { error } = await admin.from('contribution_units').insert({
    unit_internal_id: id,
    pathway_id: auth.pathwayId,
    design_id: designId,
    user_id: auth.userId,
    section: 'micro-innovation',
    unit_type: 'toolkit-asset',
    dimension: DIMENSIONS.includes(dimension) ? dimension : null,
    stage: STAGES.includes(stage) ? stage : null,
    asset_name: name,
    purpose: text(body.purpose, 1000) || null,
    reuse_condition: text(body.reuseCondition, 1000) || null,
    share_consent: true,
    share_consented_at: new Date().toISOString(),
    ...asset,
  })
  if (error) {
    console.error('[toolkit-assets] register failed:', error)
    return NextResponse.json({ error: 'Could not save the asset. Try again.' }, { status: 500 })
  }

  return NextResponse.json({ id, status: 'awaiting_pathway_review' }, { status: 201 })
}
