'use client';

// Lets a contributor pick an existing pathway to join, or create a new one.
// Only published pathways are offered — an unpublished one is just someone
// else's private draft (design_documents is owner-only), so there's nothing
// to join; the contributor starts their own instead.
// Org name and role are read server-side from contributor_registrations —
// no need to ask again here.

import { useEffect, useState } from 'react';
import Select from '@/components/Select';

interface PathwaySummary {
  id: string;
  slug: string;
  title: string;
  sector: string | null;
  description: string | null;
  created_at: string;
  isContributor: boolean;
  isPublished: boolean;
}

// A match against the curated corpus (content/wiki/pathways/index.md): it's
// in the library but has no pathways row, so it can be viewed, not joined.
interface CuratedMatch {
  slug: string;
  title: string;
  sector: string | null;
}

interface Props {
  onSelect: (pathwayId: string) => void;
  onBack: () => void;
}

export default function PathwaySelector({ onSelect, onBack }: Props) {
  const [pathways, setPathways] = useState<PathwaySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSector, setNewSector] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const [joining, setJoining] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [similarMatch, setSimilarMatch] = useState<PathwaySummary | null>(null);
  const [curatedMatch, setCuratedMatch] = useState<CuratedMatch | null>(null);
  const [checkingSimilar, setCheckingSimilar] = useState(false);

  useEffect(() => {
    fetch('/api/pathways')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((data: PathwaySummary[]) => {
        setPathways(data.filter((p) => p.isPublished));
        setLoading(false);
      })
      .catch(() => {
        setError('Could not load pathways. Try again.');
        setLoading(false);
      });
  }, []);

  async function joinAndSelect(pathwayId: string, alreadyJoined: boolean) {
    if (alreadyJoined) {
      onSelect(pathwayId);
      return;
    }
    setJoining(true);
    setError(null);
    try {
      const res = await fetch(`/api/pathways/${pathwayId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        // The server answered, so a non-JSON body is still a failed join —
        // "Could not reach the server" is only for a fetch that never landed.
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Could not join pathway.');
        return;
      }
      onSelect(pathwayId);
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setJoining(false);
    }
  }

  // "Did you mean this one?" — an LLM call compares the candidate against
  // every existing pathway's title/sector/description for a genuine
  // same-underlying-deployment match (not just overlapping words), before
  // anything is created. If the user has already seen and dismissed a match
  // for the current fields (similarMatch was set, and they clicked through
  // anyway), this click skips straight to actually creating it.
  async function handleCreateClick() {
    if (!newTitle.trim() || !newDescription.trim() || !newSector.trim()) return;
    if (!similarMatch) {
      setCheckingSimilar(true);
      setError(null);
      try {
        const res = await fetch('/api/pathways/check-similar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle.trim(), sector: newSector.trim(), description: newDescription.trim() }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.curatedMatch?.slug) {
            setCuratedMatch(data.curatedMatch);
            return;
          }
          if (data.matchId) {
            const match = pathways.find((p) => p.id === data.matchId) ?? null;
            if (match) {
              setSimilarMatch(match);
              return;
            }
          }
        }
      } catch {
        // Best-effort check — if it fails, fall through to creating rather
        // than blocking the contributor entirely.
      } finally {
        setCheckingSimilar(false);
      }
    }
    void createPathway();
  }

  async function createPathway() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/pathways', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim(), sector: newSector.trim(), description: newDescription.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Could not create pathway.'); return; }
      await joinAndSelect(data.id, false);
    } catch {
      setError('Could not create pathway. Try again.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-paper p-4 sm:p-8">
      <div className="mx-auto max-w-2xl">
        <button type="button" onClick={onBack} className="mb-6 text-xs font-medium text-ink-soft transition hover:text-coral">
          ← Back
        </button>
        <h1 className="font-display text-2xl font-medium tracking-tight text-navy">Which pathway are you contributing to?</h1>
        <p className="mt-2 text-sm text-ink-soft">Join an existing pathway to add your deployment experience, or start a new one if yours is the first.</p>

        {error && <p className="mt-4 text-sm text-coral">{error}</p>}

        {joining && (
          <p className="mt-4 text-sm text-ink-soft">Joining pathway…</p>
        )}

        <div className="mt-6">
          <label htmlFor="pathwaySelect" className="mb-1 block text-xs font-medium text-ink-soft">
            Existing pathways
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="w-full">
              <Select
                id="pathwaySelect"
                value={selectedId}
                onChange={setSelectedId}
                disabled={loading || joining || pathways.length === 0}
                placeholder={loading ? 'Loading…' : pathways.length === 0 ? 'No published pathways yet — start a new one below' : 'Select a pathway…'}
                options={pathways.map((p) => ({
                  value: p.id,
                  label: `${p.title}${p.sector ? ` — ${p.sector}` : ''}${p.isContributor ? ' (already contributing)' : ''}`,
                }))}
                className="rounded-lg border border-navy/15 px-3 py-2 text-sm text-navy outline-none focus:border-coral focus:ring-1 focus:ring-coral/30 disabled:opacity-50"
              />
            </div>
            <button
              type="button"
              disabled={!selectedId || joining}
              onClick={() => {
                const p = pathways.find((x) => x.id === selectedId);
                if (p) joinAndSelect(p.id, p.isContributor);
              }}
              className="flex-shrink-0 rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition hover:bg-coral disabled:opacity-40"
            >
              {joining ? 'Joining…' : 'Continue →'}
            </button>
          </div>
        </div>

        {/* Create new pathway */}
        <div className="mt-8 rounded-xl border border-navy/10 bg-white p-5">
          <h2 className="font-display font-medium text-navy">Start a new pathway</h2>
          <p className="mt-1 text-xs text-ink-soft">Only if your adoption domain isn&apos;t covered above.</p>
          <div className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">Pathway name *</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => {
                  setNewTitle(e.target.value);
                  setSimilarMatch(null);
                  setCuratedMatch(null);
                }}
                placeholder="e.g. Voice AI for Agricultural Extension"
                className="w-full rounded-lg border border-navy/15 bg-paper px-3 py-2 text-sm text-navy placeholder-ink-soft/50 outline-none focus:border-coral focus:ring-1 focus:ring-coral/30"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">Short description *</label>
              <textarea
                rows={3}
                value={newDescription}
                onChange={(e) => {
                  setNewDescription(e.target.value);
                  setSimilarMatch(null);
                  setCuratedMatch(null);
                }}
                placeholder="What was built, for whom, and roughly what problem it solves — a couple of sentences is enough"
                className="w-full resize-none rounded-lg border border-navy/15 bg-paper px-3 py-2 text-sm text-navy placeholder-ink-soft/50 outline-none focus:border-coral focus:ring-1 focus:ring-coral/30"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">Sector *</label>
              <input
                type="text"
                value={newSector}
                onChange={(e) => {
                  setNewSector(e.target.value);
                  setSimilarMatch(null);
                  setCuratedMatch(null);
                }}
                placeholder="e.g. Agriculture, Health, Education"
                className="w-full rounded-lg border border-navy/15 bg-paper px-3 py-2 text-sm text-navy placeholder-ink-soft/50 outline-none focus:border-coral focus:ring-1 focus:ring-coral/30"
              />
            </div>

            {checkingSimilar && <p className="text-xs text-ink-soft">Checking for similar pathways…</p>}

            {similarMatch && (
              <div className="rounded-lg border border-coral/30 bg-coral-soft p-3">
                <p className="text-sm text-navy">
                  Did you mean <span className="font-medium">{similarMatch.title}</span>
                  {similarMatch.sector ? ` (${similarMatch.sector})` : ''}? Joining an existing pathway keeps
                  everyone&apos;s contributions in one document.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => joinAndSelect(similarMatch.id, similarMatch.isContributor)}
                    disabled={joining}
                    className="rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white transition hover:bg-coral disabled:opacity-50"
                  >
                    Join that one instead
                  </button>
                  <button
                    type="button"
                    onClick={() => void createPathway()}
                    disabled={creating}
                    className="rounded-lg border border-navy/20 px-3 py-1.5 text-xs font-medium text-navy transition hover:border-coral hover:text-coral disabled:opacity-50"
                  >
                    {creating ? 'Creating…' : "No, this is genuinely different"}
                  </button>
                </div>
              </div>
            )}

            {curatedMatch && (
              <div className="rounded-lg border border-coral/30 bg-coral-soft p-3">
                <p className="text-sm text-navy">
                  This looks like <span className="font-medium">{curatedMatch.title}</span>
                  {curatedMatch.sector ? ` (${curatedMatch.sector})` : ''}, which is already in the library. Have a
                  look before starting a new one.
                </p>
                <div className="mt-2 flex gap-2">
                  <a
                    href={`/wiki/${curatedMatch.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white transition hover:bg-coral"
                  >
                    View that pathway
                  </a>
                  <button
                    type="button"
                    onClick={() => void createPathway()}
                    disabled={creating}
                    className="rounded-lg border border-navy/20 px-3 py-1.5 text-xs font-medium text-navy transition hover:border-coral hover:text-coral disabled:opacity-50"
                  >
                    {creating ? 'Creating…' : 'No, this is genuinely different'}
                  </button>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleCreateClick()}
              disabled={
                !newTitle.trim() ||
                !newDescription.trim() ||
                !newSector.trim() ||
                creating ||
                joining ||
                checkingSimilar ||
                !!similarMatch ||
                !!curatedMatch
              }
              className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition hover:bg-coral disabled:opacity-40"
            >
              {creating ? 'Creating…' : checkingSimilar ? 'Checking…' : 'Create and continue →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
