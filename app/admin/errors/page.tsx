import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdmin } from '@/lib/roles';

// The latest 50 system errors (sys_errors, migration 0035) for the system
// administrator — read-only, linked from /admin/usage. Stack traces sit behind
// a click. All values render as text, never HTML.

const LIMIT = 50;

interface ErrorRow {
  id: string;
  created_at: string;
  source: string;
  message: string;
  stack: string | null;
  context: Record<string, string | number> | null;
  user_id: string | null;
  environment: string;
}

function utc(iso: string) {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export default async function AdminErrorsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!(await isAdmin(supabase, user?.email))) {
    redirect('/');
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('sys_errors')
    .select('id, created_at, source, message, stack, context, user_id, environment')
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  if (error) throw error;
  const rows = (data ?? []) as ErrorRow[];

  // Who was affected, by email — only for the users on this page.
  const emails = new Map<string, string>();
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((id): id is string => Boolean(id)))];
  await Promise.all(
    userIds.map(async (id) => {
      const { data: found } = await admin.auth.admin.getUserById(id);
      if (found?.user?.email) emails.set(id, found.user.email);
    })
  );

  return (
    <div className="min-h-screen bg-paper text-ink p-4 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/admin/usage" className="text-xs text-ink-soft hover:text-coral transition-colors">
          ← Usage
        </Link>
        <h1 className="font-display text-2xl font-medium text-navy mt-2 mb-1">Recent errors</h1>
        <p className="text-sm text-ink-soft mb-6">
          The latest {LIMIT} entries in the system error log (kept for 30 days), newest first.
        </p>

        {rows.length === 0 ? (
          <p className="text-sm text-ink-soft">No errors recorded in the last 30 days.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => {
              const kind = r.context?.kind === 'expected' ? 'expected' : 'unexpected';
              const ids = Object.entries(r.context ?? {}).filter(([k]) => k !== 'kind' && k !== 'user_id');
              return (
                <li key={r.id} className="rounded-xl border border-navy/10 bg-white p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
                    <span className="tabular-nums">{utc(r.created_at)}</span>
                    <span className="font-mono text-navy">{r.source}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 ${
                        kind === 'unexpected' ? 'bg-coral/10 text-coral' : 'bg-navy/5 text-ink-soft'
                      }`}
                    >
                      {kind}
                    </span>
                    <span>{r.environment}</span>
                    <span>{r.user_id ? emails.get(r.user_id) ?? r.user_id : '—'}</span>
                  </div>
                  <p className="mt-2 break-words text-sm text-ink">{r.message}</p>
                  {ids.length > 0 && (
                    <p className="mt-1 break-all font-mono text-xs text-ink-soft">
                      {ids.map(([k, v]) => `${k}=${v}`).join('  ')}
                    </p>
                  )}
                  {r.stack && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-ink-soft hover:text-navy">Stack trace</summary>
                      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-paper p-3 font-mono text-xs text-ink">
                        {r.stack}
                      </pre>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
