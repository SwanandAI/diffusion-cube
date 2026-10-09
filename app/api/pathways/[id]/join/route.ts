import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasRole } from '@/lib/roles'
import { ensureOrganisation } from '@/lib/organisations'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pathwayId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasRole(supabase, 'pathway_contributor'))) {
    return NextResponse.json({ error: 'Contributor role required' }, { status: 403 })
  }

  // Verify the pathway exists
  const { data: pathway } = await supabase
    .from('pathways')
    .select('id')
    .eq('id', pathwayId)
    .maybeSingle()
  if (!pathway) return NextResponse.json({ error: 'Pathway not found' }, { status: 404 })

  // Already joined — idempotent
  const { data: existing } = await supabase
    .from('pathway_contributors')
    .select('user_id')
    .eq('pathway_id', pathwayId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (existing) return NextResponse.json({ ok: true, alreadyJoined: true })

  // Read org name and role from the contributor's registration — they already
  // provided this at registration time, no need to ask again.
  const { data: registration } = await supabase
    .from('contributor_registrations')
    .select('organisation_name, pathway_role, public_links')
    .eq('user_id', user.id)
    .maybeSingle()

  const orgName = registration?.organisation_name?.trim() ?? ''
  const orgRole = registration?.pathway_role?.trim() ?? ''
  const orgUrl = registration?.public_links?.trim() ?? ''

  if (!orgName) {
    return NextResponse.json(
      { error: 'No contributor registration found. Please complete registration first.' },
      { status: 400 }
    )
  }

  // Find or create the org
  let orgId: string | null = null
  try {
    orgId = await ensureOrganisation(orgName, orgRole, orgUrl)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  // Insert the contributor row — user's own RLS allows this
  const { error } = await supabase.from('pathway_contributors').insert({
    pathway_id: pathwayId,
    user_id: user.id,
    org_id: orgId,
    role: orgRole,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// Leave a pathway — the Contribute grid's Delete, after it has deleted this
// person's own workspace(s) for it via /api/contributions/[designId]. Only
// removes their own membership row; the pathway and anything already
// published for it stay. Service-role because 0021 has no delete policy on
// pathway_contributors.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pathwayId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await createAdminClient()
    .from('pathway_contributors')
    .delete()
    .eq('pathway_id', pathwayId)
    .eq('user_id', user.id)
  if (error) {
    console.error('[pathways/leave]', error)
    return NextResponse.json({ error: 'Could not remove this contribution. Try again.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
