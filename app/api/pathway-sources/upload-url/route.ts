import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authorizePathwayContributor } from '@/lib/toolkit-assets-server'
import { MAX_SOURCE_FILE_BYTES, SOURCES_BUCKET, contributorSourcePath } from '@/lib/pathway-store'

import { withErrorHandling } from '@/lib/errors'
// Step 1 of keeping a document a contributor sent in their workspace
// (migration 0043): a one-time signed upload URL for a server-built path
// under this pathway in the private pathway-sources bucket. The browser
// uploads straight to it (bypassing the platform's request-size limit), then
// calls POST /api/pathway-sources with the document's extracted text.
// Same gate as the toolkit asset routes: contributor role + membership.
async function handlePOST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { pathwayId, fileName, size } = body as { pathwayId?: unknown; fileName?: unknown; size?: unknown }

  const supabase = await createClient()
  const auth = await authorizePathwayContributor(supabase, pathwayId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (typeof fileName !== 'string' || !fileName.trim()) {
    return NextResponse.json({ error: 'fileName required' }, { status: 400 })
  }
  if (typeof size !== 'number' || size <= 0) {
    return NextResponse.json({ error: 'size required' }, { status: 400 })
  }
  if (size > MAX_SOURCE_FILE_BYTES) {
    // The text is still kept (POST /api/pathway-sources without a file).
    return NextResponse.json({ error: 'Files over 50 MB are kept as text only.' }, { status: 413 })
  }

  const path = contributorSourcePath(auth.pathwayId, fileName)
  const { data, error } = await createAdminClient().storage.from(SOURCES_BUCKET).createSignedUploadUrl(path)
  if (error || !data) throw new Error(`signed upload url: ${error?.message ?? 'no data'}`)
  return NextResponse.json({ path: data.path, token: data.token })
}

export const POST = withErrorHandling('api/pathway-sources/upload-url', handlePOST)
