import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/roles';
import { listWikiPathways } from '@/lib/wiki-content';
import StatsTable, { fmt } from '@/components/admin/StatsTable';
import ActivityTable, { type ActivityRow } from '@/components/admin/ActivityTable';

// Read-only usage monitoring for product admins (customer spec "Usage logging
// and monitoring"). Every figure except the published-pathway count comes
// from one admin_usage_stats() call (migration 0038), computed on page load;
// the thumbs up / down columns in the Activity table come from
// admin_feedback_stats() (migration 0043). Migration 0045 added the 30-day
// figures behind the Activity table's Overall / 7 / 30-day toggle.

type Area = 'explore' | 'analyse' | 'contribute';
const AREAS: { key: Area; label: string }[] = [
  { key: 'explore', label: 'Explore' },
  { key: 'analyse', label: 'Analyse' },
  { key: 'contribute', label: 'Contribute' },
];

interface UsageStats {
  users: { total: number; new_7d: number; active_7d: number; active_30d: number };
  conversations: Partial<Record<Area, { total: number; last_7d: number; last_30d?: number }>>;
  // 'admin' holds calls only admins trigger (the Feedback Digest, 0044).
  ai_usage: Partial<
    Record<
      Area | 'admin',
      {
        calls: number;
        failed: number;
        input_tokens: number;
        output_tokens: number;
        cache_read_tokens: number;
        cache_creation_tokens: number;
      }
    >
  >;
  errors_per_day: { day: string; expected: number; unexpected: number }[];
  errors_per_source: { source: string; expected: number; unexpected: number }[];
}

interface FeedbackStats {
  per_surface: Partial<
    Record<Area, { up: number; down: number; up_7d?: number; down_7d?: number; up_30d?: number; down_30d?: number }>
  >;
}


function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-navy/10 bg-white p-4">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="mt-1 font-display text-2xl font-medium text-navy">{fmt(value)}</p>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-medium text-navy mb-1">{title}</h2>
      {note && <p className="text-sm text-ink-soft mb-4">{note}</p>}
      {children}
    </section>
  );
}

export default async function AdminUsagePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!(await isAdmin(supabase, user?.email))) {
    redirect('/');
  }

  const admin = createAdminClient();
  const [{ data, error }, { data: feedbackData, error: feedbackError }, pathways] = await Promise.all([
    admin.rpc('admin_usage_stats'),
    admin.rpc('admin_feedback_stats'),
    listWikiPathways(),
  ]);
  // Fails into app/error.tsx (generic message) and is recorded by
  // instrumentation.ts.
  if (error) throw error;
  if (feedbackError) throw feedbackError;
  const stats = data as UsageStats;
  const feedback = (feedbackData ?? { per_surface: {} }) as FeedbackStats;
  const fb = (a: Area) => feedback.per_surface?.[a] ?? { up: 0, down: 0 };
  const publishedPathways = new Set(pathways.map((p) => p.slug)).size;

  const conv = (a: Area) => stats.conversations[a] ?? { total: 0, last_7d: 0 };
  const activity: ActivityRow[] = AREAS.map((a) => {
    const c = conv(a.key);
    const f = fb(a.key);
    return {
      label: a.label,
      figures: {
        all: { conversations: c.total ?? 0, up: f.up ?? 0, down: f.down ?? 0 },
        '7d': { conversations: c.last_7d ?? 0, up: f.up_7d ?? 0, down: f.down_7d ?? 0 },
        '30d': { conversations: c.last_30d ?? 0, up: f.up_30d ?? 0, down: f.down_30d ?? 0 },
      },
    };
  });
  const convTotal = AREAS.reduce((sum, a) => sum + conv(a.key).total, 0);
  const conv7d = AREAS.reduce((sum, a) => sum + conv(a.key).last_7d, 0);
  const ai = (a: Area | 'admin') => stats.ai_usage[a];
  // With prompt caching the API reports uncached, cache-read and cache-write
  // input separately; the customer's "total input tokens" is all three.
  const totalInput = (a: Area | 'admin') =>
    (ai(a)?.input_tokens ?? 0) + (ai(a)?.cache_read_tokens ?? 0) + (ai(a)?.cache_creation_tokens ?? 0);

  return (
    <div className="min-h-screen bg-paper text-ink p-4 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/admin" className="text-xs text-ink-soft hover:text-coral transition-colors">
          ← Admin
        </Link>
        <h1 className="font-display text-2xl font-medium text-navy mt-2 mb-1">Usage</h1>
        <p className="text-sm text-ink-soft">
          Figures as of when this page was opened. &ldquo;Last week&rdquo; means the last 7 days.
        </p>
        <Link href="/admin/usage/digest" className="mt-3 inline-block text-sm font-medium text-coral hover:underline">
          Digest →
        </Link>

        <Section title="Users">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Registered users" value={stats.users.total} />
            <Tile label="New sign-ups, last 7 days" value={stats.users.new_7d} />
            <Tile label="Active, last 7 days" value={stats.users.active_7d} />
            <Tile label="Active, last 30 days" value={stats.users.active_30d} />
          </div>
        </Section>

        <Section
          title="Activity"
          note="Conversations are saved chats, counted by when they were started. Explore counts signed-in visitors only — signed-out library chats aren't saved. Thumbs up / down are votes on Cube's replies, one per person per reply (a changed vote counts once, on the day it was last changed); Explore's include signed-out visitors."
        >
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Published pathways" value={publishedPathways} />
            <Tile label="Conversations" value={convTotal} />
            <Tile label="Conversations, last 7 days" value={conv7d} />
          </div>
          <ActivityTable rows={activity} />
          <Link href="/admin/usage/feedback" className="mt-3 inline-block text-sm font-medium text-coral hover:underline">
            Review thumbs down →
          </Link>
        </Section>

        <Section
          title="AI usage"
          note="LLM calls and tokens since usage recording started. Input tokens are the total sent to the LLM; cached input is the part of that read back from the prompt cache, which is billed at about a tenth of the normal rate."
        >
          <StatsTable
            head={['Area', 'LLM calls', 'Failed', 'Input tokens', 'Output tokens', 'Cached input tokens']}
            rows={[...AREAS, { key: 'admin' as const, label: 'Admin (digest)' }].map((a) => [
              a.label,
              ai(a.key)?.calls ?? 0,
              ai(a.key)?.failed ?? 0,
              totalInput(a.key),
              ai(a.key)?.output_tokens ?? 0,
              ai(a.key)?.cache_read_tokens ?? 0,
            ])}
          />
        </Section>

        <Section title="Errors" note="From the system error log, which keeps the last 30 days. Days are in IST (India Standard Time).">
          <Link href="/admin/errors" className="mb-4 inline-block text-sm font-medium text-coral hover:underline">
            See the most recent errors →
          </Link>
          {stats.errors_per_day.length === 0 ? (
            <p className="text-sm text-ink-soft">No errors recorded in the last 30 days.</p>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <StatsTable
                head={['Day', 'Unexpected', 'Expected']}
                rows={stats.errors_per_day.map((d) => [d.day, d.unexpected, d.expected])}
              />
              <StatsTable
                head={['Source', 'Unexpected', 'Expected']}
                rows={stats.errors_per_source.map((s) => [s.source, s.unexpected, s.expected])}
              />
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
