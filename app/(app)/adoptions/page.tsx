'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AdoptionWorkspace from '@/components/AdoptionWorkspace';
import { AdoptionConversation } from '@/lib/adoption-conversation';
import { createClient } from '@/lib/supabase/client';
import { hasRole } from '@/lib/roles';
import { fetchAdoptionsList, setAdoptionsListCache } from '@/lib/adoptions-cache';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/lib/toast';

function formatRelativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type Selection = string | null;

function AdoptionsPageContent() {
  const searchParams = useSearchParams();
  const openId = searchParams.get('open');

  const [adoptions, setAdoptions] = useState<AdoptionConversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [appliedOpenId, setAppliedOpenId] = useState<string | null>(null);
  const [canStrengthen, setCanStrengthen] = useState(false);
  const [canContribute, setCanContribute] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    let cancelled = false;
    fetchAdoptionsList()
      .then((list) => {
        if (cancelled) return;
        setAdoptions(list);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError('Could not load your adoptions.');
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const supabase = createClient();
    Promise.all([hasRole(supabase, 'adopter'), hasRole(supabase, 'pathway_contributor')]).then(
      ([adopter, contributor]) => {
        setCanStrengthen(adopter);
        setCanContribute(contributor);
      }
    );
  }, []);

  // Deep-links from the sidebar (/adoptions?open=<id>). Adjusted during
  // render (React's documented pattern) — tracks the last-applied id so a
  // different link still switches, while "← All adoptions" stays put.
  if (loaded && openId && openId !== appliedOpenId && adoptions.some((a) => a.id === openId)) {
    setAppliedOpenId(openId);
    setSelection(openId);
  }

  async function deleteAdoption(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    const ok = await confirm({
      title: 'Delete this adoption?',
      message: "The adoption and its conversation will be permanently deleted. This can't be undone.",
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;

    const supabase = createClient();
    const { error } = await supabase.from('designs').delete().eq('id', id);
    if (error) {
      showToast('Could not delete that adoption. Please try again.', 'error');
      return;
    }
    setAdoptions((prev) => {
      const next = prev.filter((a) => a.id !== id);
      setAdoptionsListCache(next);
      return next;
    });
    showToast('Adoption deleted successfully.');
  }

  if (selection) {
    const existing = adoptions.find((a) => a.id === selection) ?? null;
    return (
      <AdoptionWorkspace
        key={selection}
        initial={existing}
        onBack={() => setSelection(null)}
        onCreated={(c) =>
          setAdoptions((prev) => {
            const next = [c, ...prev];
            setAdoptionsListCache(next);
            return next;
          })
        }
        onChange={(c) =>
          setAdoptions((prev) => {
            const next = prev.map((a) => (a.id === c.id ? c : a));
            setAdoptionsListCache(next);
            return next;
          })
        }
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-paper p-4 sm:p-8">
      {confirmDialog}
      <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-medium tracking-tight text-navy">Your adoptions</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Every adoption you&apos;ve worked through, and where each one stands.
          </p>
        </div>
        <div className="flex flex-shrink-0 gap-2">
          {canStrengthen && (
            <Link
              href="/analyse"
              className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition hover:bg-coral"
            >
              + Analyse
            </Link>
          )}
          {canContribute && (
            <Link
              href="/contribute"
              className="rounded-lg border border-navy/20 px-4 py-2 text-sm font-medium text-navy transition hover:border-coral hover:text-coral"
            >
              + Contribute
            </Link>
          )}
        </div>
      </div>

      {!loaded ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : adoptions.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-sm text-ink-soft">Start a new adoption from the buttons above to see it here.</p>
          {loadError && <p className="text-xs text-coral">{loadError}</p>}
        </div>
      ) : (
        <>
          {loadError && <p className="mb-4 text-xs text-coral">{loadError}</p>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {adoptions.map((a) => (
              <div
                key={a.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelection(a.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelection(a.id);
                  }
                }}
                className="group relative flex cursor-pointer flex-col gap-2 rounded-2xl border border-navy/10 bg-white p-5 text-left transition hover:border-coral/50 hover:shadow-sm"
              >
                <button
                  type="button"
                  onClick={(e) => deleteAdoption(e, a.id)}
                  aria-label="Delete adoption"
                  className="absolute top-3 right-3 text-ink-soft/50 opacity-0 transition hover:text-coral group-hover:opacity-100"
                >
                  🗑
                </button>
                <div className="pr-5 font-display font-medium text-navy">{a.meta.name || 'New adoption'}</div>
                {(a.meta.sector || a.meta.geography) && (
                  <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-soft">
                    {[a.meta.sector, a.meta.geography].filter(Boolean).join(' · ')}
                  </div>
                )}
                {a.meta.summary && <p className="line-clamp-3 text-sm leading-relaxed text-ink-soft">{a.meta.summary}</p>}
                <div className="mt-auto pt-2 text-[10px] text-ink-soft/70">Updated {formatRelativeTime(a.updatedAt)}</div>
              </div>
            ))}
          </div>
        </>
      )}
      </div>
    </div>
  );
}

export default function AdoptionsPage() {
  return (
    <Suspense fallback={null}>
      <AdoptionsPageContent />
    </Suspense>
  );
}
