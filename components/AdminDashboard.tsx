'use client';

import { useState } from 'react';
import type { Role } from '@/lib/roles';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/lib/toast';

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  organization: string;
  roles: Role[];
}

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'general_user', label: 'General User' },
  { value: 'adopter', label: 'Adopter' },
  { value: 'pathway_contributor', label: 'Pathway Contributor' },
  { value: 'admin', label: 'Admin' },
];

export default function AdminDashboard({ initialRows }: { initialRows: AdminUserRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [pending, setPending] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  async function toggleRole(userId: string, role: Role, hasIt: boolean) {
    const key = `${userId}:${role}`;
    setPending(key);
    try {
      const res = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, role, action: hasIt ? 'remove' : 'add' }),
      });
      if (!res.ok) {
        showToast('Could not update that role. Please try again.', 'error');
        return;
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === userId ? { ...r, roles: hasIt ? r.roles.filter((x) => x !== role) : [...r.roles, role] } : r
        )
      );
    } finally {
      setPending(null);
    }
  }

  async function reject(userId: string) {
    const ok = await confirm({
      title: 'Reject this signup?',
      message: "The account will be permanently deleted. They can sign up again with the same email. This can't be undone.",
      confirmLabel: 'Reject and delete',
      danger: true,
    });
    if (!ok) return;
    setPending(`${userId}:reject`);
    try {
      const res = await fetch('/api/admin/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error ?? 'Could not reject that account. Please try again.', 'error');
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== userId));
      showToast('Signup rejected and account deleted.');
    } finally {
      setPending(null);
    }
  }

  if (rows.length === 0) {
    return <p className="text-sm text-ink-soft">No users yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      {confirmDialog}
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left font-mono text-[10px] uppercase tracking-[0.15em] text-ink-soft border-b border-navy/10">
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">Email</th>
            <th className="py-2 pr-4">Organization</th>
            {ROLE_OPTIONS.map((r) => (
              <th key={r.value} className="py-2 pr-4">
                {r.label}
              </th>
            ))}
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isPendingRow = row.roles.length === 0;
            return (
              <tr key={row.id} className={`border-b border-navy/5 ${isPendingRow ? 'bg-yellow-soft' : ''}`}>
                <td className="py-2 pr-4">{row.name || '—'}</td>
                <td className="py-2 pr-4">{row.email}</td>
                <td className="py-2 pr-4">{row.organization || '—'}</td>
                {ROLE_OPTIONS.map((r) => {
                  const hasIt = row.roles.includes(r.value);
                  const key = `${row.id}:${r.value}`;
                  return (
                    <td key={r.value} className="py-2 pr-4">
                      <input
                        type="checkbox"
                        checked={hasIt}
                        disabled={pending === key}
                        onChange={() => toggleRole(row.id, r.value, hasIt)}
                      />
                    </td>
                  );
                })}
                <td className="py-2">
                  {isPendingRow && (
                    <button
                      onClick={() => reject(row.id)}
                      disabled={pending === `${row.id}:reject`}
                      className="text-xs text-coral border border-coral/40 rounded-lg px-2.5 py-1 hover:bg-coral-soft transition-colors disabled:opacity-50"
                    >
                      Reject
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
