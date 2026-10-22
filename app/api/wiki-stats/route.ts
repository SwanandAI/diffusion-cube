import { createClient } from '@/lib/supabase/server';
import { hasAnyRole } from '@/lib/roles';
import { getWikiStats } from '@/lib/wiki-content';

import { withErrorHandling } from '@/lib/errors';
// Backs the "Explore the Pathways Library" intent's opening line — the
// number of pathways and the sectors they span, read live rather than
// hardcoded so it stays accurate as the corpus grows via community
// publishing (see lib/wiki-content.ts).
async function handleGET() {
  const supabase = await createClient();
  const approved = await hasAnyRole(supabase);
  if (!approved) {
    return Response.json({ error: 'Your account is awaiting approval.' }, { status: 403 });
  }

  const stats = await getWikiStats();
  return Response.json(stats);
}

export const GET = withErrorHandling('api/wiki-stats', handleGET);
