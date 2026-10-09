import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasAnyRole, hasRole } from '@/lib/roles'

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
}

async function uniqueSlug(base: string): Promise<string> {
  const admin = createAdminClient()
  let candidate = base
  let suffix = 0
  while (true) {
    const { data } = await admin
      .from('pathways')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle()
    if (!data) return candidate
    suffix++
    candidate = `${base}-${suffix}`
  }
}

/** List all pathways. Any approved user can browse them for the selector. */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await hasAnyRole(supabase))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: pathways, error } = await supabase
    .from('pathways')
    .select('id, slug, title, sector, description, created_at, review_requested')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Also fetch which pathways this user contributes to so the grid can mark
  // them as "already joined" without a second client-side query, and every
  // contributing org per pathway so the grid can offer an org filter.
  // Live slugs drive each card's Published badge — published_pathways is
  // readable by any approved user (0012).
  const [{ data: myContribs }, { data: orgContribs }, { data: live }] = await Promise.all([
    supabase.from('pathway_contributors').select('pathway_id').eq('user_id', user.id),
    supabase.from('pathway_contributors').select('pathway_id, organisations(name)'),
    supabase.from('published_pathways').select('slug'),
  ])
  const liveSlugs = new Set((live ?? []).map((r) => r.slug as string))

  const mySet = new Set((myContribs ?? []).map((r) => r.pathway_id as string))
  const orgsByPathway = new Map<string, Set<string>>()
  for (const row of orgContribs ?? []) {
    const org = row.organisations as unknown as { name: string } | { name: string }[] | null
    const orgName = Array.isArray(org) ? org[0]?.name : org?.name
    if (!orgName) continue
    const pathwayId = row.pathway_id as string
    if (!orgsByPathway.has(pathwayId)) orgsByPathway.set(pathwayId, new Set())
    orgsByPathway.get(pathwayId)!.add(orgName)
  }

  const result = (pathways ?? []).map(({ review_requested, ...p }) => ({
    ...p,
    isPublished: liveSlugs.has(p.slug),
    reviewRequested: review_requested ?? false,
    isContributor: mySet.has(p.id),
    orgs: Array.from(orgsByPathway.get(p.id) ?? []),
  }))

  return NextResponse.json(result)
}

/** Create a new pathway. Requires pathway_contributor role. */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasRole(supabase, 'pathway_contributor'))) {
    return NextResponse.json({ error: 'Contributor role required' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { title, sector, description } = body as { title?: string; sector?: string; description?: string }
  if (!title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 })
  if (!sector?.trim()) return NextResponse.json({ error: 'sector required' }, { status: 400 })
  if (!description?.trim()) return NextResponse.json({ error: 'description required' }, { status: 400 })

  const slug = await uniqueSlug(slugify(title.trim()))
  const admin = createAdminClient()

  const { data: pathway, error } = await admin
    .from('pathways')
    .insert({
      slug,
      title: title.trim(),
      sector: sector.trim(),
      description: description.trim(),
      created_by: user.id,
    })
    .select('id, slug')
    .single()

  if (error || !pathway) {
    return NextResponse.json({ error: error?.message ?? 'Could not create pathway' }, { status: 500 })
  }

  return NextResponse.json(pathway, { status: 201 })
}
