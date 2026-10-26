import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/roles';

import { withErrorHandling } from '@/lib/errors';
// The assembled document (pathways.content_cache) for the admin review card
// (components/AdminPathwayRowCard.tsx). Read here with the service role rather
// than from the browser: the pathways RLS (migration 0040) admits an 'admin'
// role row but can't see ADMIN_EMAILS, and isAdmin() honours both.
async function handleGET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !(await isAdmin(supabase, user.email))) {
    return NextResponse.json({ error: 'Admin only.' }, { status: 403 });
  }

  const pathwayId = req.nextUrl.searchParams.get('pathway_id');
  if (!pathwayId) return NextResponse.json({ error: 'pathway_id required.' }, { status: 400 });

  const { data, error } = await createAdminClient()
    .from('pathways')
    .select('content_cache')
    .eq('id', pathwayId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return NextResponse.json({ error: 'Pathway not found.' }, { status: 404 });

  return NextResponse.json({ content: data.content_cache ?? '' });
}

export const GET = withErrorHandling('api/admin/pathways/document', handleGET);
