import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/roles';
import AppShell from '@/components/AppShell';
import ExploreLibrary from './ExploreLibrary';
import { slugToAccent, toLibraryStage, type LibraryPathway } from '@/lib/library-types';
import { listPublished } from '@/lib/pathway-store';

// Every published pathway, as a card (lib/pathway-store.ts reads the
// published_pathways view with the service-role client, so this works for
// anonymous visitors too). Nothing is hard-coded: a newly published pathway
// gets its card on the next request.
async function getPublishedPathways(): Promise<LibraryPathway[]> {
  return (await listPublished()).map((p) => ({
    id: p.slug,
    title: p.title,
    hook: p.description,
    location: p.location,
    category: p.category ?? '',
    stage: toLibraryStage(p.stage),
    accent: slugToAccent(p.slug),
    sector: p.sector || undefined,
    tags: p.tags,
  }));
}

// The Library — deliberately public, no login or registration required (see
// proxy.ts's PUBLIC_PATHS). Lives outside the (app) route group because that
// group's layout gates on account approval, which doesn't apply here. A
// signed-in visitor still gets the normal Sidebar shell (AppShell, shared
// with (app)/layout.tsx) so the app doesn't visually change out from under
// them; a genuinely anonymous visitor gets the same shell with everything
// role-gated hidden, since Sidebar already degrades gracefully with no user.
//
// ?open=<id> reopens a saved conversation — Sidebar's "Recent Explorations"
// links here the same way it links to /strengthen?open=<id>. Resolved
// server-side (RLS already scopes it to the caller's own rows) rather than a
// client fetch, so there's no flash of the library grid before it loads.
export default async function PublicExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const { open } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const dbPathways = await getPublishedPathways();

  if (!user) {
    return (
      <AppShell email={null} adoptions={[]} isAdmin={false}>
        <ExploreLibrary dbPathways={dbPathways} />
      </AppShell>
    );
  }

  // proxy.ts only sets this header once a session is confirmed — true here.
  const email = (await headers()).get('x-user-email');

  const [{ data: adoptions }, adminAccess, initialConversation] = await Promise.all([
    supabase.from('designs').select('id, meta, updated_at').order('updated_at', { ascending: false }),
    isAdmin(supabase, email),
    open
      ? supabase
          .from('library_conversations')
          .select('id, pathway_slug, pathway_title, messages')
          .eq('id', open)
          .maybeSingle()
          .then((r) => r.data)
      : Promise.resolve(null),
  ]);

  return (
    <AppShell email={email} adoptions={adoptions ?? []} isAdmin={adminAccess}>
      <ExploreLibrary signedIn dbPathways={dbPathways} initialConversation={initialConversation} />
    </AppShell>
  );
}
