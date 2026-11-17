import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/roles';
import { listWikiPathways } from '@/lib/wiki-content';

// Read-only usage monitoring for product admins (customer spec "Usage logging
// and monitoring"). Every figure except the published-pathway count comes
// from one admin_usage_stats() call (migration 0038), computed on page load;
// the reply-feedback figures in the Activity section come from
// admin_feedback_stats() (migration 0043).

type Area = 'explore' | 'analyse' | 'contribute';
const AREAS: { key: Area; label: string }[] = [
  { key: 'explore', label: 'Explore' },
  { key: 'analyse', label: 'Analyse' },
  { key: 'contribute', label: 'Contribute' },
];

interface UsageStats {
  users: { total: number; new_7d: number; active_7d: number; active_30d: number };
  conversations: Partial<Record<Area, { total: number; last_7d: number }>>;
  ai_usage: Partial<
    Record<
      Area,
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
  per_surface: Partial<Record<Area, { up: number; down: number; up_7d: number; down_7d: number }>>;
  recent_down: { surface: Area; pathway_slug: string | null; excerpt: string; at: string }[];
}

const fmt = (n: number | undefined) => (n ?? 0).toLocaleString('en-US');

// Share of thumbs that are up, or an en dash when there are none yet.
const helpfulShare = (up: number, down: number) =>
  up + down === 0 ? '–' : `${Math.round((up / (up + down)) * 100)}%`;

const IST_DATE = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });

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

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-navy/10 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-navy/10 text-left text-xs text-ink-soft">
            {head.map((h, i) => (
              <th key={h} className={`px-4 py-2 font-medium ${i > 0 ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-navy/5 last:border-0">
              {row.map((cell, i) => (
                <td key={i} className={`px-4 py-2 ${i > 0 ? 'text-right tabular-nums' : 'text-navy'}`}>
                  {typeof cell === 'number' ? fmt(cell) : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
  const feedback = (feedbackData ?? { per_surface: {}, recent_down: [] }) as FeedbackStats;
  const fb = (a: Area) => feedback.per_surface[a] ?? { up: 0, down: 0, up_7d: 0, down_7d: 0 };
  const fbUp = AREAS.reduce((sum, a) => sum + fb(a.key).up, 0);
  const fbDown = AREAS.reduce((sum, a) => sum + fb(a.key).down, 0);
  const areaLabel = (a: Area) => AREAS.find((x) => x.key === a)?.label ?? a;
  const publishedPathways = new Set(pathways.map((p) => p.slug)).size;

  const conv = (a: Area) => stats.conversations[a] ?? { total: 0, last_7d: 0 };
  const convTotal = AREAS.reduce((sum, a) => sum + conv(a.key).total, 0);
  const conv7d = AREAS.reduce((sum, a) => sum + conv(a.key).last_7d, 0);
  const ai = (a: Area) => stats.ai_usage[a];
  // With prompt caching the API reports uncached, cache-read and cache-write
  // input separately; the customer's "total input tokens" is all three.
  const totalInput = (a: Area) =>
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
          note="Conversations are saved chats. Explore counts signed-in visitors only — signed-out library chats aren't saved."
        >
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Published pathways" value={publishedPathways} />
            <Tile label="Conversations" value={convTotal} />
            <Tile label="Conversations, last 7 days" value={conv7d} />
          </div>
          <Table
            head={['Area', 'Conversations', 'Last 7 days']}
            rows={AREAS.map((a) => [a.label, conv(a.key).total, conv(a.key).last_7d])}
          />

          <h3 className="mt-8 mb-1 font-display text-base font-medium text-navy">Reply feedback</h3>
          <p className="mb-4 text-sm text-ink-soft">
            Thumbs up / down on Cube&rsquo;s replies — one vote per person per reply, and a changed vote counts once.
            Explore includes signed-out visitors.
          </p>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Helpful (thumbs up)" value={fbUp} />
            <Tile label="Not helpful (thumbs down)" value={fbDown} />
          </div>
          <Table
            head={['Area', 'Thumbs up', 'Thumbs down', 'Helpful', 'Up, last 7 days', 'Down, last 7 days']}
            rows={AREAS.map((a) => [
              a.label,
              fb(a.key).up,
              fb(a.key).down,
              helpfulShare(fb(a.key).up, fb(a.key).down),
              fb(a.key).up_7d,
              fb(a.key).down_7d,
            ])}
          />
          <h4 className="mt-6 mb-2 text-sm font-medium text-navy">Recent thumbs down</h4>
          {feedback.recent_down.length === 0 ? (
            <p className="text-sm text-ink-soft">No thumbs down yet.</p>
          ) : (
            <ul className="space-y-2">
              {feedback.recent_down.map((d, i) => (
                <li key={i} className="rounded-xl border border-navy/10 bg-white p-4 text-sm">
                  <p className="text-xs text-ink-soft">
                    {areaLabel(d.surface)}
                    {d.pathway_slug ? ` · ${d.pathway_slug}` : ''} · {IST_DATE.format(new Date(d.at))}
                  </p>
                  <p className="mt-1 text-ink">{d.excerpt || '(no text)'}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="AI usage"
          note="LLM calls and tokens since usage recording started. Input tokens are the total sent to the LLM; cached input is the part of that read back from the prompt cache, which is billed at about a tenth of the normal rate."
        >
          <Table
            head={['Area', 'LLM calls', 'Failed', 'Input tokens', 'Output tokens', 'Cached input tokens']}
            rows={AREAS.map((a) => [
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
              <Table
                head={['Day', 'Unexpected', 'Expected']}
                rows={stats.errors_per_day.map((d) => [d.day, d.unexpected, d.expected])}
              />
              <Table
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
