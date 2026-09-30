import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/roles'
import { isAssetId } from '@/lib/toolkit-assets'
import { loadToolkitAsset, openAssetFileStream } from '@/lib/toolkit-assets-server'

function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

// Content-Disposition that survives non-ASCII file names: an ASCII fallback
// plus the RFC 5987 UTF-8 form.
function attachmentHeader(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

// Public (listed in proxy.ts PUBLIC_PATHS): a published toolkit asset is
// downloadable by anyone, signed in or not — the contributor consented to
// public sharing and the admin approved it with its pathway. The file is
// streamed through this route as a download, never redirected to storage, so
// the storage URL (project host, bucket path, signed token) is never exposed
// to the browser. An unpublished asset is only served to its uploader
// (preview) or an admin (review); everyone else gets the same 404 as a
// nonexistent id. A link asset redirects to its own (public) https URL.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isAssetId(id)) return notFound()

  const asset = await loadToolkitAsset(id)
  if (!asset) return notFound()

  if (!asset.published_at) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const allowed = !!user && (user.id === asset.user_id || (await isAdmin(supabase, user.email)))
    if (!allowed) return notFound()
  }

  if (asset.asset_kind === 'link') {
    if (!asset.link_url || !asset.link_url.startsWith('https://')) return notFound()
    const response = NextResponse.redirect(asset.link_url, 302)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const file = asset.storage_path ? await openAssetFileStream(asset.storage_path) : null
  if (!file) return NextResponse.json({ error: 'This file is no longer available.' }, { status: 404 })

  const headers = new Headers({
    'Content-Type': asset.mime_type ?? 'application/octet-stream',
    'Content-Disposition': attachmentHeader(asset.file_name ?? 'toolkit-asset'),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  if (file.size) headers.set('Content-Length', file.size)
  return new NextResponse(file.body, { status: 200, headers })
}
