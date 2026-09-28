'use client';

import { useEffect, type MouseEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LEGAL_BACK_TARGETS, isLegalFrom } from '@/lib/legal';

const SITE_HOME = 'https://100pathways.com/';
// Per-tab memory of ?from=, so Back still knows where to return after the
// reader follows a Terms ↔ Privacy link (which doesn't carry the param).
const STORAGE_KEY = 'legal-back-from';

function readStoredFrom() {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    return isLegalFrom(saved) ? saved : null;
  } catch {
    return null;
  }
}

// The legal pages' header Back link. Opened from the Sign up or Register to
// Contribute form (always in a new tab, so the half-filled form survives),
// Back closes this tab to reveal that form again; if the browser refuses to
// close it, it navigates to the form's page instead. Opened any other way,
// it's the usual Back to 100pathways.com.
export default function LegalBackLink() {
  const router = useRouter();
  const param = useSearchParams().get('from');
  const paramFrom = isLegalFrom(param) ? param : null;

  useEffect(() => {
    if (!paramFrom) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, paramFrom);
    } catch {
      // Storage blocked — Back still works from the ?from= param on this page.
    }
  }, [paramFrom]);

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    const from = paramFrom ?? readStoredFrom();
    if (!from) return; // plain link to 100pathways.com
    e.preventDefault();
    window.close();
    // Still here → the browser didn't allow closing this tab.
    setTimeout(() => router.push(LEGAL_BACK_TARGETS[from]), 150);
  }

  return (
    <a
      href={paramFrom ? LEGAL_BACK_TARGETS[paramFrom] : SITE_HOME}
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-navy transition hover:text-coral"
    >
      <span aria-hidden>←</span> Back
    </a>
  );
}
