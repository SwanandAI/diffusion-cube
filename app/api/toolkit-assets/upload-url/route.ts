import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ASSET_MIME_BY_EXTENSION, MAX_ASSET_BYTES, assetExtension } from '@/lib/toolkit-assets'
import {
  authorizePathwayContributor,
  buildAssetStoragePath,
  createAssetUploadUrl,
} from '@/lib/toolkit-assets-server'

// Step 1 of attaching a toolkit asset file, called only after the contributor
// said Yes to "OK to share this publicly?". Returns a one-time signed upload
// URL for a server-built path under this pathway; the browser then uploads
// straight to the private 'toolkit-assets' bucket (bypassing Vercel's request
// size limit) and calls POST /api/toolkit-assets to register it. The bucket
// itself enforces the 25 MB / MIME limits (migration 0034) — the checks here
// just refuse early with a clear message.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { pathwayId, fileName, size } = body as { pathwayId?: unknown; fileName?: unknown; size?: unknown }

  const supabase = await createClient()
  const auth = await authorizePathwayContributor(supabase, pathwayId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (typeof fileName !== 'string' || !fileName.trim()) {
    return NextResponse.json({ error: 'fileName required' }, { status: 400 })
  }
  const ext = assetExtension(fileName)
  if (!ext) {
    return NextResponse.json(
      { error: 'This file type can\'t be shared as a toolkit asset (ZIP isn\'t supported yet).' },
      { status: 400 }
    )
  }
  if (typeof size !== 'number' || size <= 0 || size > MAX_ASSET_BYTES) {
    return NextResponse.json({ error: 'Toolkit asset files must be under 25 MB.' }, { status: 400 })
  }

  try {
    const upload = await createAssetUploadUrl(buildAssetStoragePath(auth.pathwayId, fileName))
    return NextResponse.json({ ...upload, contentType: ASSET_MIME_BY_EXTENSION[ext] })
  } catch (err) {
    console.error('[toolkit-assets/upload-url]', err)
    return NextResponse.json({ error: 'Could not prepare the upload. Try again.' }, { status: 500 })
  }
}
