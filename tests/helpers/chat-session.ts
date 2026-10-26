import type { TableHandler } from './supabase-mock';

// A user_roles table handler for the session client that answers every way
// lib/roles.ts reads it: currentRoles (plain select of all rows), hasRole
// (eq('role', x) + maybeSingle) and hasAnyRole (limit(1) + maybeSingle).
export function rolesTable(roles: string[]): TableHandler {
  return (op) => {
    const wanted = op.filters.find((f) => f[0] === 'eq' && f[1] === 'role')?.[2];
    if (wanted !== undefined) return { data: roles.includes(wanted as string) ? { role: wanted } : null };
    if (op.single) return { data: roles[0] ? { role: roles[0] } : null };
    return { data: roles.map((role) => ({ role })) };
  };
}

// The value of the first eq(column, value) filter on an op, if any.
export function eqValue(filters: unknown[][], column: string): unknown {
  return filters.find((f) => f[0] === 'eq' && f[1] === column)?.[2];
}
