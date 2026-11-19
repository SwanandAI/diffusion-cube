// The plain figures table used on /admin/usage. No hooks, so both the server
// page and client components (ActivityTable) can render it.

export const fmt = (n: number | undefined) => (n ?? 0).toLocaleString('en-US');

export default function StatsTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-navy/10 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-navy/10 text-left text-xs text-ink-soft">
            {head.map((h, i) => (
              <th key={h} className={`px-4 py-2 font-medium ${i > 0 ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-navy/5 last:border-0">
              {row.map((cell, i) => (
                <td key={i} className={`px-4 py-2 ${i > 0 ? 'text-right tabular-nums' : 'text-navy'}`}>
                  {typeof cell === 'number' ? fmt(cell) : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
