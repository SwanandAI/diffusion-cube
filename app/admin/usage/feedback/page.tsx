import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/roles';
import { PAGE_SIZE, daysAgoIso, questionBefore, shortText, type QuestionLookup } from '@/lib/feedback-review';
import type { FeedbackSurface } from '@/lib/message-feedback';

// Admin review of 👎 votes: each rated reply with the question asked just
// before it, newest first. Read with the service role (message_feedback has
// no client policy, migration 0043; conversations are read by id). No
// migration: a vote's conversation_id is a designs id for Analyse and
// Contribute and a library_conversations id for Explore, and its message_id
// is the reply's `id` inside that conversation's messages. Only the one
// question is shown, never the rest of the chat, and no voter is named.
// Paged with ?page=N (PAGE_SIZE votes each, newest first); only the page's
// conversations are read.

const PERIODS = [
  { key: 'all', label: 'Overall', days: null },
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
] as const;

const AREA_LABEL: Record<FeedbackSurface, string> = { explore: 'Explore', analyse: 'Analyse', contribute: 'Contribute' };
const MISSING: Record<Exclude<QuestionLookup['status'], 'found'>, string> = {
  not_saved: 'Signed-out visitor — this chat isn’t saved, so the question isn’t available.',
  deleted: 'The conversation has since been deleted.',
  reply_gone: 'This reply is no longer in the conversation.',
  no_question: 'No question before this reply (Cube’s opening message).',
};
const WHEN = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

interface Vote {
  id: string;
  surface: FeedbackSurface;
  pathway_slug: string | null;
  conversation_id: string | null;
  message_id: string;
  message_excerpt: string;
  updated_at: string;
}

type PeriodKey = (typeof PERIODS)[number]['key'];

/** This page's URL for a period and page number (page 1 and Overall are left out). */
const pageHref = (period: PeriodKey, page: number) => {
  const q = new URLSearchParams();
  if (period !== 'all') q.set('days', period);
  if (page > 1) q.set('page', String(page));
  const qs = q.toString();
  return `/admin/usage/feedback${qs ? `?${qs}` : ''}`;
};

/** A positive page number from the URL; anything else is page 1. */
const toPage = (v: unknown) => (typeof v === 'string' && /^\d{1,6}$/.test(v) && Number(v) > 0 ? Number(v) : 1);

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; page?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!(await isAdmin(supabase, user?.email))) {
    redirect('/');
  }

  const params = await searchParams;
  const days = String(params.days ?? '');
  const period = PERIODS.find((p) => p.key === days) ?? PERIODS[0];
  const page = toPage(params.page);
  const from = (page - 1) * PAGE_SIZE;
  const admin = createAdminClient();

  let query = admin
    .from('message_feedback')
    .select('id, surface, pathway_slug, conversation_id, message_id, message_excerpt, updated_at', { count: 'exact' })
    .eq('vote', -1);
  if (period.days) query = query.gte('updated_at', daysAgoIso(period.days));
  const { data, error, count } = await query
    .order('updated_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  // A page past the end (an old link, or votes withdrawn meanwhile): PostgREST
  // answers PGRST103 "range not satisfiable"; go back to the first page.
  if ((error?.code === 'PGRST103' || (!error && !data?.length)) && page > 1) redirect(pageHref(period.key, 1));
  // Fails into app/error.tsx (generic message), as /admin/usage does.
  if (error) throw error;
  const votes = (data ?? []) as Vote[];
  const total = count ?? votes.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // The conversations behind these votes, by store.
  const ids = (s: (v: Vote) => boolean) => [...new Set(votes.filter((v) => s(v) && v.conversation_id).map((v) => v.conversation_id!))];
  const designIds = ids((v) => v.surface !== 'explore');
  const libraryIds = ids((v) => v.surface === 'explore');
  const slugs = [...new Set(votes.map((v) => v.pathway_slug).filter((s): s is string => !!s))];
  const [designs, library, pathways] = await Promise.all([
    designIds.length ? admin.from('designs').select('id, messages').in('id', designIds) : { data: [], error: null },
    libraryIds.length ? admin.from('library_conversations').select('id, messages').in('id', libraryIds) : { data: [], error: null },
    slugs.length ? admin.from('pathways').select('slug, title').in('slug', slugs) : { data: [], error: null },
  ]);
  if (designs.error) throw designs.error;
  if (library.error) throw library.error;
  const messagesOf = new Map<string, unknown>();
  for (const c of [...(designs.data ?? []), ...(library.data ?? [])] as { id: string; messages: unknown }[]) {
    messagesOf.set(`${c.id}`, c.messages);
  }
  const titles = new Map(((pathways.data ?? []) as { slug: string; title: string }[]).map((p) => [p.slug, p.title]));

  const lookup = (v: Vote): QuestionLookup => {
    if (!v.conversation_id) return { status: 'not_saved' };
    if (!messagesOf.has(v.conversation_id)) return { status: 'deleted' };
    return questionBefore(messagesOf.get(v.conversation_id), v.message_id);
  };

  return (
    <div className="min-h-screen bg-paper p-4 text-ink sm:p-8">
      <div className="mx-auto max-w-4xl">
        <Link href="/admin/usage" className="text-xs text-ink-soft transition-colors hover:text-coral">
          ← Usage
        </Link>
        <h1 className="mt-2 mb-1 font-display text-2xl font-medium text-navy">Thumbs down</h1>
        <p className="text-sm text-ink-soft">
          Replies people marked not helpful, with the question they asked just before. Only that question is shown,
          not the rest of the conversation, and voters aren&rsquo;t named.
        </p>

        <div role="group" aria-label="Period" className="mt-6 inline-flex rounded-lg border border-navy/15 bg-white p-0.5 text-sm">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={pageHref(p.key, 1)}
              aria-current={p.key === period.key ? 'page' : undefined}
              className={`rounded-md px-3 py-1 transition ${
                p.key === period.key ? 'bg-navy font-medium text-white' : 'text-ink-soft hover:text-navy'
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          {total > 0 &&
            `${total.toLocaleString('en-US')} thumbs down${period.days ? ` in the last ${period.days} days` : ''}` +
              (pages > 1 ? ` · showing ${from + 1}–${from + votes.length}` : '') +
              '.'}
        </p>

        {votes.length === 0 ? (
          <p className="mt-6 text-sm text-ink-soft">No thumbs down{period.days ? ` in the last ${period.days} days` : ' yet'}.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {votes.map((v) => {
              const q = lookup(v);
              return (
                <li key={v.id} className="space-y-2 rounded-xl border border-navy/10 bg-white px-4 py-3 text-sm leading-relaxed">
                  <p className="text-xs text-ink-soft">
                    {AREA_LABEL[v.surface] ?? v.surface}
                    {v.pathway_slug ? ` · ${titles.get(v.pathway_slug) ?? v.pathway_slug}` : ''} ·{' '}
                    {WHEN.format(new Date(v.updated_at))} IST
                  </p>
                  <div>
                    <p className="text-xs font-medium text-navy">Asked</p>
                    {q.status === 'found' ? (
                      <p className="text-ink">{q.question}</p>
                    ) : (
                      <p className="italic text-ink-soft">{MISSING[q.status]}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-coral">Cube replied 👎</p>
                    <p className="text-ink">{shortText(v.message_excerpt || '') || '(no text)'}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {pages > 1 && (
          <nav aria-label="Pages" className="mt-6 flex items-center justify-between gap-4 text-sm">
            {page > 1 ? (
              <Link href={pageHref(period.key, page - 1)} className="font-medium text-coral hover:underline">
                ← Newer
              </Link>
            ) : (
              <span aria-hidden="true" />
            )}
            <span className="text-ink-soft">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <Link href={pageHref(period.key, page + 1)} className="font-medium text-coral hover:underline">
                Older →
              </Link>
            ) : (
              <span aria-hidden="true" />
            )}
          </nav>
        )}
      </div>
    </div>
  );
}
