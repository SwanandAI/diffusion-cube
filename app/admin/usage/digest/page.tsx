import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/roles';
import { toPeriod, viewDigest, type DigestStats } from '@/lib/feedback-digest';
import DigestScreen from '@/components/digest/DigestScreen';

// The admin Feedback Digest (docs/features/feedback-digest/, FD-06): the
// period's numbers, computed on load with no AI involved, and the last saved
// digest for the period, checked against the conversations and votes that
// still exist. Opening this page never calls Claude — only the Generate
// button does (POST /api/admin/digest). Read with the service role through
// migration 0045's functions; isAdmin here is UX, the API route re-checks.
export default async function AdminDigestPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!(await isAdmin(supabase, user?.email))) {
    redirect('/');
  }

  const period = toPeriod((await searchParams).days);
  const admin = createAdminClient();

  const savedRes = await admin
    .from('feedback_digests')
    .select('payload, generated_at')
    .eq('period_days', period)
    .maybeSingle();
  // Fails into app/error.tsx (generic message), as /admin/usage does.
  if (savedRes.error) throw savedRes.error;
  const saved = savedRes.data as { payload: unknown; generated_at: string } | null;

  const { data: statsData, error: statsError } = await admin.rpc('admin_digest_stats', {
    p_days: period,
    p_since: saved?.generated_at ?? null,
  });
  if (statsError) throw statsError;
  const stats = statsData as DigestStats;

  const view = saved ? viewDigest(saved.payload, new Set(stats.live_keys ?? [])) : null;

  // Titles for the pathways the digest's topics mention (slugs are stored).
  const slugs = [...new Set((view?.topics ?? []).flatMap((t) => t.item.pathways))];
  const titles: Record<string, string> = Object.fromEntries((stats.pathways ?? []).map((p) => [p.slug, p.title]));
  const missing = slugs.filter((s) => !titles[s]);
  if (missing.length) {
    const { data } = await admin.from('pathways').select('slug, title').in('slug', missing).eq('status', 'published');
    for (const p of (data ?? []) as { slug: string; title: string }[]) titles[p.slug] = p.title;
  }

  return (
    <DigestScreen
      period={period}
      stats={stats}
      digest={view && saved ? { view, generatedAt: saved.generated_at } : null}
      pathwayTitles={titles}
    />
  );
}
