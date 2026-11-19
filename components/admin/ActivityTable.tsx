'use client';

import { useState } from 'react';
import StatsTable from './StatsTable';

// /admin/usage's Activity table with an Overall / Last 7 days / Last 30 days
// toggle. All three ranges arrive with the page (admin_usage_stats and
// admin_feedback_stats, migration 0045), so switching is instant and never
// refetches. Conversations count by when they were started (as the Feedback
// Digest does); thumbs by when the vote was cast or last changed.

export const ACTIVITY_RANGES = [
  { key: 'all', label: 'Overall' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
] as const;
export type ActivityRange = (typeof ACTIVITY_RANGES)[number]['key'];

export interface ActivityFigures {
  conversations: number;
  up: number;
  down: number;
}

export interface ActivityRow {
  label: string;
  figures: Record<ActivityRange, ActivityFigures>;
}

export default function ActivityTable({ rows }: { rows: ActivityRow[] }) {
  const [range, setRange] = useState<ActivityRange>('all');

  return (
    <div>
      <div role="group" aria-label="Period" className="mb-3 inline-flex rounded-lg border border-navy/15 bg-white p-0.5 text-sm">
        {ACTIVITY_RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            aria-pressed={r.key === range}
            onClick={() => setRange(r.key)}
            className={`rounded-md px-3 py-1 transition ${
              r.key === range ? 'bg-navy font-medium text-white' : 'text-ink-soft hover:text-navy'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <StatsTable
        head={['Area', 'Conversations', 'Thumbs up', 'Thumbs down']}
        rows={rows.map((row) => {
          const f = row.figures[range];
          return [row.label, f.conversations, f.up, f.down];
        })}
      />
    </div>
  );
}
