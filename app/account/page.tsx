import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/roles';
import { sharingLevelFromRow } from '@/lib/contributor-registration';
import AppShell from '@/components/AppShell';
import ManageAccount from './ManageAccount';

// Manage Account — reached from the "Account" link in the sidebar footer.
// Lives outside the (app) route group so any signed-in user can reach it,
// including one with no role yet (who can still edit or delete their
// account); proxy.ts sends anonymous visitors to /login first.
export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/account');

  const email = (await headers()).get('x-user-email') ?? user.email ?? null;

  const [{ data: adoptions }, adminAccess, { data: registration }] = await Promise.all([
    supabase.from('designs').select('id, meta, updated_at').order('updated_at', { ascending: false }),
    isAdmin(supabase, email),
    supabase
      .from('contributor_registrations')
      .select('access_status, share_name, share_contact')
      .eq('user_id', user.id)
      .maybeSingle(),
  ]);

  const meta = user.user_metadata ?? {};

  // Contact sharing is for approved contributors only — hidden otherwise
  // (app/api/account/contact-sharing enforces the same rule).
  const sharingLevel = registration?.access_status === 'approved' ? sharingLevelFromRow(registration) : null;

  return (
    <AppShell email={email} adoptions={adoptions ?? []} isAdmin={adminAccess}>
      <ManageAccount
        email={user.email ?? ''}
        name={meta.name ?? ''}
        organisation={meta.organization ?? ''}
        sharingLevel={sharingLevel}
      />
    </AppShell>
  );
}
