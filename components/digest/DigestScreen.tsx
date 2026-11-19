import Link from 'next/link';
import type { ReactNode } from 'react';
import GenerateButton from './GenerateButton';
import {
  DIGEST_PERIODS,
  FEW_USERS,
  type Area,
  type DigestPeriod,
  type DigestStats,
  type DigestView,
  type UnansweredSource,
} from '@/lib/feedback-digest';

// The admin Feedback Digest screen (docs/features/feedback-digest/, FD-06):
// the most discussed pathways first (SQL, no AI), then the saved AI digest
// for the period. User, conversation and 👍/👎 counts are on /admin/usage's
// Activity table, not repeated here. A server component; only GenerateButton
// runs in the browser. Layout follows the Cube 2.0 digest tab, styled like
// /admin/usage.

interface Props {
  period: DigestPeriod;
  stats: DigestStats;
  digest: { view: DigestView; generatedAt: string } | null;
  pathwayTitles: Record<string, string>;
}

const AREA_LABEL: Record<Area, string> = { explore: 'Explore', analyse: 'Analyse', contribute: 'Contribute' };
const SOURCE_LABEL: Record<UnansweredSource, string> = {
  not_covered: 'Cube said not covered',
  not_helpful: 'Marked not helpful',
};

const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString('en-US');
const plural = (n: number, word: string) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;

const WHEN = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
const DAY = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const shortDay = (d: string) => {
  const date = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? d : DAY.format(date);
};

export default function DigestScreen({ period, stats, digest, pathwayTitles }: Props) {
  const view = digest?.view;
  const pathwayName = (slug: string) => pathwayTitles[slug] ?? slug;
  // Live, and counted exactly as /admin/usage's Activity table counts
  // "Last 7 days" (conversations created in the period), so the pages agree.
  const bannerPeople = stats.users_period;
  const bannerConvs = stats.conversations_period;

  const sections: { title: string; content: ReactNode }[] = view
    ? [
        {
          title: 'Most discussed topics',
          content: view.topics.length > 0 && (
            <ol className="space-y-3">
              {view.topics.map(({ item, conversations, people }, i) => (
                <Item key={i}>
                  <p className="font-medium text-navy">
                    <span className="mr-2 text-ink-soft">{i + 1}.</span>
                    {item.title}
                  </p>
                  <p className="text-ink">{item.summary}</p>
                  <Tags>
                    {item.areas.map((a) => (
                      <Tag key={a}>{AREA_LABEL[a] ?? a}</Tag>
                    ))}
                    {item.pathways.map((s) => (
                      <Tag key={s} tone="blue">
                        {pathwayName(s)}
                      </Tag>
                    ))}
                  </Tags>
                  <Meta>
                    {plural(conversations, 'conversation')} · {plural(people, 'user')}
                  </Meta>
                </Item>
              ))}
            </ol>
          ),
        },
        {
          title: 'Unanswered questions',
          content: view.unanswered.length > 0 && (
            <ul className="space-y-3">
              {view.unanswered.map(({ item, people }, i) => (
                <Item key={i}>
                  <p className="font-medium text-navy">{item.question}</p>
                  <Tags>
                    {item.sources.map((s) => (
                      <Tag key={s} tone="coral">
                        {SOURCE_LABEL[s] ?? s}
                      </Tag>
                    ))}
                    {item.areas.map((a) => (
                      <Tag key={a}>{AREA_LABEL[a] ?? a}</Tag>
                    ))}
                  </Tags>
                  <Meta>
                    {item.dates.length > 0 && <>Asked {item.dates.map(shortDay).join(', ')} · </>}
                    {plural(people, 'user')}
                  </Meta>
                </Item>
              ))}
            </ul>
          ),
        },
        {
          title: 'Terms people asked about',
          content: view.terms.length > 0 && (
            <ul className="space-y-3">
              {view.terms.map(({ item, people }, i) => (
                <Item key={i}>
                  <p className="font-medium text-navy">{item.term}</p>
                  <p className="text-ink">{item.observation}</p>
                  <Meta>{plural(people, 'user')}</Meta>
                </Item>
              ))}
            </ul>
          ),
        },
      ]
    : [];

  return (
    <div className="min-h-screen bg-paper p-4 text-ink sm:p-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/admin/usage" className="text-xs text-ink-soft transition-colors hover:text-coral">
          ← Usage
        </Link>
        <h1 className="mt-2 mb-1 font-display text-2xl font-medium text-navy">Digest</h1>
        <p className="text-sm text-ink-soft">
          What people asked Cube, which topics and pathways came up most, and what Cube couldn&rsquo;t answer.
        </p>

        {/* Header: period, generated time, (re)generate */}
        <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div role="group" aria-label="Period" className="inline-flex rounded-lg border border-navy/15 bg-white p-0.5 text-sm">
              {DIGEST_PERIODS.map((d) => (
                <Link
                  key={d}
                  href={`/admin/usage/digest${d === 7 ? '' : `?days=${d}`}`}
                  aria-current={d === period ? 'page' : undefined}
                  className={`rounded-md px-3 py-1 transition ${
                    d === period ? 'bg-navy font-medium text-white' : 'text-ink-soft hover:text-navy'
                  }`}
                >
                  Last {d} days
                </Link>
              ))}
            </div>
            <p className="text-xs text-ink-soft">
              {digest
                ? `Generated on ${WHEN.format(new Date(digest.generatedAt))} IST`
                : `No digest for the last ${period} days yet.`}
            </p>
          </div>
          <GenerateButton key={period} period={period} hasDigest={!!digest} />
        </div>

        <p className="mt-6 rounded-xl bg-blue/10 px-4 py-2.5 text-sm text-ink">
          In the last {period} days: {plural(bannerConvs, 'conversation')} from {plural(bannerPeople, 'user')}, counted as on
          the Usage page.
          {bannerPeople < FEW_USERS && ' Too few users to see patterns.'}
          {view && view.basis.messagesTotal > view.basis.messagesUsed &&
            ` Only the most recent ${fmt(view.basis.messagesUsed)} of ${fmt(view.basis.messagesTotal)} questions were read.`}
          {digest && stats.new_since > 0 && ` ${plural(stats.new_since, 'new conversation')} since this digest was generated.`}
        </p>

        {view?.basis.empty && <p className="mt-6 text-sm text-ink-soft">No conversations in the last {period} days.</p>}

        {view && view.summary.length > 0 && (
          <section className="mt-6 rounded-xl border border-navy/10 bg-white p-4">
            <h2 className="font-display text-lg font-medium text-navy">Summary</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-ink">
              {view.summary.map((b, i) => (
                <li key={i}>
                  {b.text}
                  {b.people > 0 && <span className="text-xs text-ink-soft"> ({plural(b.people, 'user')})</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Most discussed pathways (till date, computed when the page opens), after the Summary */}
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-navy/10 bg-white p-4">
            <p className="text-xs text-ink-soft">Most discussed pathways, till date</p>
            {stats.pathways?.length ? (
              <ol className="mt-1.5 space-y-1 text-sm">
                {stats.pathways.slice(0, 5).map((p) => (
                  <li key={p.slug} className="flex justify-between gap-3">
                    <span className="text-navy">{p.title}</span>
                    <span className="whitespace-nowrap text-xs text-ink-soft">{fmt(p.conversations)} conv.</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-1.5 text-sm text-ink-soft">No pathways discussed yet.</p>
            )}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-ink-soft">
          A pathway counts once per conversation in which Cube&rsquo;s answers drew on it. Users, conversations and
          👍/👎 counts are on the{' '}
          <Link href="/admin/usage" className="underline hover:text-coral">
            Usage
          </Link>{' '}
          page.
        </p>

        {sections
          .filter((s) => s.content)
          .map((s) => (
            <section key={s.title} className="mt-8">
              <h2 className="mb-3 font-display text-lg font-medium text-navy">{s.title}</h2>
              {s.content}
            </section>
          ))}
      </div>
    </div>
  );
}

function Item({ children }: { children: ReactNode }) {
  return <li className="space-y-1.5 rounded-xl border border-navy/10 bg-white px-4 py-3 text-sm leading-relaxed">{children}</li>;
}

function Meta({ children }: { children: ReactNode }) {
  return <p className="text-xs text-ink-soft">{children}</p>;
}

function Tags({ children }: { children: ReactNode }) {
  return <p className="flex flex-wrap gap-1.5 text-xs">{children}</p>;
}

function Tag({ children, tone = 'navy' }: { children: ReactNode; tone?: 'navy' | 'blue' | 'coral' }) {
  const tones = { navy: 'bg-navy/10 text-navy', blue: 'bg-blue/10 text-blue', coral: 'bg-coral/15 text-coral' };
  return <span className={`inline-block rounded-full px-2 py-0.5 ${tones[tone]}`}>{children}</span>;
}
