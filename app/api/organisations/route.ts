import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasAnyRole } from '@/lib/roles'
import { searchOrganisations } from '@/lib/organisations'

import { withErrorHandling } from '@/lib/errors'
async function handleGET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await hasAnyRole(supabase))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const q = req.nextUrl.searchParams.get('q') ?? ''
  const results = await searchOrganisations(q)
  return NextResponse.json(results)
}

export const GET = withErrorHandling('api/organisations', handleGET)
