'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SignOutButton from '@/components/SignOutButton';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/lib/toast';
import { createClient } from '@/lib/supabase/client';

interface AdoptionSummary {
  id: string;
  meta: { name?: string; flow?: string } | null;
  updated_at: string;
}

interface LibraryConversationSummary {
  id: string;
  pathway_title: string | null;
  updated_at: string;
}

interface Props {
  email: string | null;
  adoptions: AdoptionSummary[];
  isAdmin?: boolean;
}

// One shared "Recent Explorations" shape covering both Strengthen sessions
// (designs, flow==='explorer') and Explore/Library chats (library_conversations)
// — the boss wanted Explore's history to live here rather than as its own
// block section on the page itself, same list treatment as Strengthen's.
interface RecentItem {
  id: string;
  kind: 'strengthen' | 'library';
  title: string;
  href: string;
  updatedAt: string;
}

export default function Sidebar({ email, adoptions, isAdmin }: Props) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);
  // Optimistic client-side removal — `adoptions` itself is a server-fetched
  // prop (re-populated on navigation), so a deleted row is masked out here
  // rather than mutated in place; it's simply absent again on the next
  // real fetch anyway. Shared across both kinds since ids never collide.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  const [libraryConversations, setLibraryConversations] = useState<LibraryConversationSummary[]>([]);
  const { confirm, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    // No user to fetch for — leave state as-is rather than a synchronous
    // setState-in-effect; a sign-out remounts the sidebar on the next
    // navigation anyway, so stale data here never actually surfaces.
    if (!email) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from('library_conversations')
      .select('id, pathway_title, updated_at')
      .order('updated_at', { ascending: false })
      .then(({ data }) => {
        if (cancelled || !data) return;
        setLibraryConversations(data);
      });
    return () => {
      cancelled = true;
    };
  }, [email]);

  async function handleDeleteRecent(e: React.MouseEvent, item: RecentItem) {
    e.preventDefault();
    e.stopPropagation();
    const ok = await confirm({
      title: 'Delete this exploration?',
      message: <>&ldquo;{item.title}&rdquo; and its conversation will be permanently deleted. This can&apos;t be undone.</>,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;

    const supabase = createClient();
    const table = item.kind === 'library' ? 'library_conversations' : 'designs';
    const { error } = await supabase.from(table).delete().eq('id', item.id);
    if (error) {
      showToast('Could not delete that exploration. Please try again.', 'error');
      return;
    }
    setDeletedIds((prev) => new Set(prev).add(item.id));
    showToast('Exploration deleted successfully.');
  }

  // Auto-close the mobile drawer whenever the route changes (link clicked).
  // Adjusted during render (React's documented pattern) rather than in an
  // effect, since it's a pure derivation with no external side effect.
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    if (mobileOpen) setMobileOpen(false);
  }

  // Explore, Strengthen, and Contribute are all always shown, regardless of
  // role or approval status — each page gates itself (see their own
  // page.tsx) with an explanatory message and a login/signup button instead
  // of just vanishing from the nav. Only Admin stays conditionally hidden.
  // The wiki itself is corpus material for the companion's prompts now, not
  // a user-facing nav destination (the pages still exist at /wiki, just
  // unlinked here).
  const navItems = [
    { href: '/explore', label: 'Explore' },
    { href: '/analyse', label: 'Analyse' },
    { href: '/contribute', label: 'Contribute' },
    ...(isAdmin ? [{ href: '/admin', label: 'Admin' }] : []),
  ];

  // Contributions now live in their own grid at /contribute — this list
  // combines Strengthen sessions and Explore/Library chats, the two flows
  // that don't have their own dedicated grid page.
  const recentExplorations: RecentItem[] = [
    ...adoptions
      .filter((a) => a.meta?.flow === 'explorer' && !deletedIds.has(a.id))
      .map((a) => ({
        id: a.id,
        kind: 'strengthen' as const,
        title: a.meta?.name || 'New exploration',
        // Strengthen sessions reopen inside /analyse, not the /adoptions
        // grid — that keeps the way out of them the intent menu rather than
        // a list the user never visited.
        href: `/analyse?open=${a.id}`,
        updatedAt: a.updated_at,
      })),
    ...libraryConversations
      .filter((c) => !deletedIds.has(c.id))
      .map((c) => ({
        id: c.id,
        kind: 'library' as const,
        title: c.pathway_title || 'General question',
        href: `/explore?open=${c.id}`,
        updatedAt: c.updated_at,
      })),
  ].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  const body = (
    <>
      <Link href="/" className="flex flex-col items-center gap-0.5 border-b border-navy/10 px-4 py-4 text-center transition hover:bg-paper-dim">
        <span className="font-display text-base font-medium tracking-tight text-navy">100 Pathways</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-soft">Diffusion Cube</span>
      </Link>

      <nav className="space-y-0.5 p-3">
        {navItems.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-3 py-2 text-sm transition ${
                active ? 'bg-navy font-medium text-white' : 'text-ink-soft hover:bg-paper-dim hover:text-navy'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {recentExplorations.length > 0 && (
          <>
            <p className="mt-2 mb-1 px-3 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-soft">
              Recent Explorations
            </p>
            <div className="space-y-0.5">
              {recentExplorations.map((item) => (
                <div key={`${item.kind}-${item.id}`} className="group/item flex items-center rounded-lg hover:bg-paper-dim">
                  <Link
                    href={item.href}
                    className="block flex-1 truncate px-3 py-1.5 text-xs text-ink-soft transition group-hover/item:text-navy"
                    title={item.title}
                  >
                    {item.title}
                  </Link>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteRecent(e, item)}
                    aria-label="Delete exploration"
                    className="flex-shrink-0 px-2 text-ink-soft/50 opacity-0 transition hover:text-coral group-hover/item:opacity-100"
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-navy/10 p-3">
        {email ? (
          <>
            <div className="flex items-center gap-2">
              <span className="min-w-0 truncate text-xs text-ink-soft" title={email}>
                {email}
              </span>
              <Link
                href="/account"
                className={`flex-shrink-0 text-[11px] transition hover:text-coral ${
                  pathname?.startsWith('/account') ? 'font-medium text-navy' : 'text-ink-soft/80'
                }`}
              >
                Account
              </Link>
            </div>
            <div>
              <SignOutButton />
            </div>
          </>
        ) : (
          // An anonymous visitor to /explore (no login required there) has no
          // session to sign out of — offer signing in instead.
          <Link href="/login" className="text-xs font-medium text-navy transition hover:text-coral">
            Sign in
          </Link>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Mobile trigger bar — the sidebar (opened via this) owns branding now that there's no separate top header */}
      <div className="flex h-12 items-center gap-3 border-b border-navy/10 bg-paper px-4 md:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="text-lg leading-none text-navy"
        >
          ☰
        </button>
        <Link href="/" className="flex items-baseline gap-1.5">
          <span className="font-display text-sm font-medium tracking-tight text-navy">100 Pathways</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-soft">/ Diffusion Cube</span>
        </Link>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-navy/40 md:hidden" onClick={() => setMobileOpen(false)} aria-hidden />
      )}

      <aside
        className={`fixed top-0 left-0 z-50 flex h-screen w-[230px] flex-shrink-0 flex-col border-r border-navy/10 bg-paper transition-transform duration-200 ease-in-out md:static md:h-auto md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {body}
      </aside>

      {confirmDialog}
    </>
  );
}
