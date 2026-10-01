import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin, type Role } from '@/lib/roles';
import AdminDashboard, { AdminUserRow } from '@/components/AdminDashboard';
import AdminPathwaysPanel, { AdminPathwayRow, type AdminToolkitAsset } from '@/components/AdminPathwaysPanel';
import { linkDomain } from '@/lib/toolkit-assets';
import AdminContributorRegistrationsPanel, {
  AdminContributorRegistrationRow,
} from '@/components/AdminContributorRegistrationsPanel';

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!(await isAdmin(supabase, user?.email))) {
    redirect('/');
  }

  const admin = createAdminClient();
  const [
    { data: usersData },
    { data: rolesData },
    { data: publishedSlugsData },
    { data: pathwaysData },
    { data: registrationsData },
    { data: toolkitAssetsData },
  ] = await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      admin.from('user_roles').select('user_id, role'),
      admin.from('published_pathways').select('slug'),
      admin
        .from('pathways')
        .select('id, slug, title, sector, created_at, review_requested')
        .order('created_at', { ascending: false }),
      admin
        .from('contributor_registrations')
        .select('id, poc_name, poc_email, organisation_name, pathway_role, pathway_description, access_status, created_at')
        .order('created_at', { ascending: false }),
      admin
        .from('contribution_units')
        .select('unit_internal_id, pathway_id, asset_name, purpose, asset_kind, file_name, size_bytes, link_url, published_at')
        .eq('unit_type', 'toolkit-asset')
        .order('created_at', { ascending: true }),
    ]);

  const toolkitAssetsByPathway = new Map<string, AdminToolkitAsset[]>();
  for (const a of toolkitAssetsData ?? []) {
    const list = toolkitAssetsByPathway.get(a.pathway_id) ?? [];
    list.push({
      id: a.unit_internal_id,
      name: a.asset_name,
      purpose: a.purpose ?? '',
      kind: a.asset_kind,
      fileName: a.file_name,
      sizeBytes: a.size_bytes,
      linkDomain: a.link_url ? linkDomain(a.link_url) : null,
      published: a.published_at !== null,
    });
    toolkitAssetsByPathway.set(a.pathway_id, list);
  }

  const publishedSlugSet = new Set((publishedSlugsData ?? []).map((p) => p.slug));

  const registrationRows: AdminContributorRegistrationRow[] = (registrationsData ?? []).map((r) => ({
    id: r.id,
    pocName: r.poc_name ?? '',
    pocEmail: r.poc_email ?? '',
    organisationName: r.organisation_name ?? '',
    pathwayRole: r.pathway_role ?? '',
    pathwayDescription: r.pathway_description ?? '',
    accessStatus: r.access_status,
    createdAt: r.created_at,
  }));

  const pathwayRows: AdminPathwayRow[] = (pathwaysData ?? []).map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    sector: p.sector ?? '',
    created_at: p.created_at,
    reviewRequested: p.review_requested ?? false,
    isPublished: publishedSlugSet.has(p.slug),
    toolkitAssets: toolkitAssetsByPathway.get(p.id) ?? [],
  }));

  const rolesByUser = new Map<string, Role[]>();
  for (const row of rolesData ?? []) {
    const list = rolesByUser.get(row.user_id) ?? [];
    list.push(row.role);
    rolesByUser.set(row.user_id, list);
  }

  const rows: AdminUserRow[] = (usersData?.users ?? [])
    .map((u) => ({
      id: u.id,
      email: u.email ?? '',
      name: (u.user_metadata?.name as string) ?? '',
      organization: (u.user_metadata?.organization as string) ?? '',
      roles: rolesByUser.get(u.id) ?? [],
    }))
    .sort((a, b) => a.roles.length - b.roles.length);

  return (
    <div className="min-h-screen bg-paper text-ink p-4 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/" className="text-xs text-ink-soft hover:text-coral transition-colors">
          ← Back
        </Link>
        <h1 className="font-display text-2xl font-medium text-navy mt-2 mb-1">Admin</h1>
        <p className="text-sm text-ink-soft mb-6">Approve signups and manage roles.</p>
        <AdminDashboard initialRows={rows} />

        <h2 className="font-display text-lg font-medium text-navy mt-10 mb-1">Contributor Registrations</h2>
        <p className="text-sm text-ink-soft mb-4">
          Approve to grant the Contributor role and let them start joining/creating pathways. Reject to turn them away.
        </p>
        <AdminContributorRegistrationsPanel initialRows={registrationRows} />

        <h2 className="font-display text-lg font-medium text-navy mt-10 mb-1">Pathways</h2>
        <p className="text-sm text-ink-soft mb-4">
          Review assembled pathway documents and publish them to the Explore library and Analyse corpus.
        </p>
        <AdminPathwaysPanel initialRows={pathwayRows} />
      </div>
    </div>
  );
}
