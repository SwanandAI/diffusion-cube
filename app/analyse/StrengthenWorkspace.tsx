'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AdoptionWorkspace from '@/components/AdoptionWorkspace';
import { AdoptionConversation } from '@/lib/adoption-conversation';
import { fetchAdoption } from '@/lib/adoptions-cache';

// /analyse owns Explorer sessions end to end: starting a new one, and
// reopening a past one via ?open=<id> (the sidebar's "Recent Explorations"
// links here). When a new row is created, the URL is updated to include
// ?open=<id> so a refresh (or a later sidebar link) reopens the same
// session — without remounting or disrupting the conversation in progress.
function StrengthenWorkspaceContent() {
  const router = useRouter();
  const openId = useSearchParams().get('open');

  const [opened, setOpened] = useState<AdoptionConversation | null>(null);
  // Which id `opened` actually reflects, so "still loading" is derived rather
  // than tracked as its own state that has to be kept in sync.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Stable workspace key — only changes when switching to a different
  // pre-existing session. Does NOT change when the current session creates
  // its row (onCreated), so the in-progress conversation isn't interrupted
  // by the URL update.
  const [sessionKey, setSessionKey] = useState<string>(openId ?? 'new');

  // ID of the row created in this component's lifetime, so the URL change
  // driven by onCreated doesn't trigger a re-fetch or remount.
  const createdInSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!openId) {
      // Bare /analyse — only reset the key if no in-session row exists, so
      // clicking the nav item while a conversation is running preserves it.
      if (!createdInSessionRef.current) setSessionKey('new');
      return;
    }
    // URL was updated by onCreated for the row we just created — skip.
    if (openId === createdInSessionRef.current) return;

    // A different (pre-existing) session is being opened — remount and fetch.
    setSessionKey(openId);
    let cancelled = false;
    fetchAdoption(openId)
      .then((row) => {
        if (cancelled) return;
        // A Contributor row deep-linked here would render the wrong flow.
        setOpened(row && row.meta.flow === 'explorer' ? row : null);
        setLoadedFor(openId);
      })
      .catch(() => {
        if (cancelled) return;
        setOpened(null);
        setLoadedFor(openId);
      });
    return () => {
      cancelled = true;
    };
  }, [openId]);

  // Show a loading state only when fetching a pre-existing session. In-session
  // row creation never shows it: onCreated sets loadedFor before the URL
  // changes, so loadedFor already equals openId by then.
  const loading = Boolean(openId) && loadedFor !== openId;
  const initial = openId && loadedFor === openId ? opened : null;

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-paper">
        <p className="animate-pulse text-sm text-ink-soft">Opening your exploration…</p>
      </div>
    );
  }

  return (
    <AdoptionWorkspace
      key={`analyse-${sessionKey}`}
      initial={initial}
      fixedFlow="explorer"
      onBack={() => router.push('/analyse')}
      onCreated={(c) => {
        // Stamp the in-session ID immediately so the URL change below
        // doesn't trigger a re-fetch or remount of the running workspace.
        createdInSessionRef.current = c.id;
        setOpened(c);
        setLoadedFor(c.id);
        router.replace(`/analyse?open=${c.id}`);
      }}
    />
  );
}

export default function StrengthenWorkspace() {
  // useSearchParams needs a Suspense boundary to keep the route from opting
  // the whole page into client-side rendering — same pattern /adoptions uses.
  return (
    <Suspense fallback={<div className="flex-1 bg-paper" />}>
      <StrengthenWorkspaceContent />
    </Suspense>
  );
}
