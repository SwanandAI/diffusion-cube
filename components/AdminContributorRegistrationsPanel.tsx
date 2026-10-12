'use client';

import { useState } from 'react';

export interface AdminContributorRegistrationRow {
  id: string;
  pocName: string;
  pocEmail: string;
  organisationName: string;
  pathwayRole: string;
  pathwayDescription: string;
  accessStatus: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

const STATUS_LABEL: Record<AdminContributorRegistrationRow['accessStatus'], string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

export default function AdminContributorRegistrationsPanel({
  initialRows,
}: {
  initialRows: AdminContributorRegistrationRow[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, action: 'approve' | 'reject') {
    setPending(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/contributor-registrations/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registration_id: id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Could not ${action} this registration.`);
        return;
      }
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, accessStatus: action === 'approve' ? 'approved' : 'rejected' } : r))
      );
    } finally {
      setPending(null);
    }
  }

  if (rows.length === 0) {
    return <p className="text-sm text-ink-soft">No contributor registrations yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-xs text-coral">{error}</p>}
      {rows.map((row) => (
        <div key={row.id} className="rounded-xl border border-navy/10 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-navy">{row.pocName || 'Unnamed'}</span>
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${
                    row.accessStatus === 'approved'
                      ? 'bg-coral-soft text-coral'
                      : row.accessStatus === 'rejected'
                        ? 'bg-paper-dim text-ink-soft'
                        : 'bg-yellow-soft text-navy'
                  }`}
                >
                  {STATUS_LABEL[row.accessStatus]}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-ink-soft">
                {row.pocEmail} · {row.organisationName || 'No organisation'} · {row.pathwayRole}
              </div>
              {row.pathwayDescription && <p className="mt-2 text-sm text-ink">{row.pathwayDescription}</p>}
              <div className="mt-1 text-[10px] text-ink-soft/70">{new Date(row.createdAt).toLocaleDateString()}</div>
            </div>
            {/* A rejected registration can still be approved later. */}
            {row.accessStatus !== 'approved' && (
              <div className="flex flex-shrink-0 gap-2">
                {row.accessStatus === 'pending' && (
                  <button
                    type="button"
                    onClick={() => act(row.id, 'reject')}
                    disabled={pending === row.id}
                    className="rounded-lg border border-coral/30 px-2.5 py-1 text-xs font-medium text-coral transition hover:bg-coral hover:text-white disabled:opacity-50"
                  >
                    Reject
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => act(row.id, 'approve')}
                  disabled={pending === row.id}
                  className="rounded-lg bg-navy px-2.5 py-1 text-xs font-medium text-white transition hover:bg-coral disabled:opacity-50"
                >
                  {pending === row.id ? 'Approving…' : 'Approve'}
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
