import { listWikiPathways } from '@/lib/wiki-content';

import { withErrorHandling } from '@/lib/errors';
// Lightweight index of all pathways — slug, title, contributor — used by the
// authenticated client to render source attribution chips on chat messages
// that cite pathway content (pathwaysReferenced from <grid_update>), and by
// the public /explore Library page to render its card grid. Deliberately
// public: this is the same non-sensitive metadata published_pathways' own
// RLS ("Anyone can view published pathways") already treats as public.
async function handleGET() {
  const pathways = await listWikiPathways();
  const index = pathways.map(({ slug, title, description, sector, stage, timestamp, contributor }) => ({
    slug, title, description, sector, stage, timestamp, contributor,
  }));
  return Response.json(index);
}

export const GET = withErrorHandling('api/wiki-pathways', handleGET);
