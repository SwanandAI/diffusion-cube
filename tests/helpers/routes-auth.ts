import { randomUUID } from 'node:crypto';
import { createSupabaseMock, type MockUser, type SupabaseMock, type TableHandler } from './supabase-mock';

// Shared session/role fixtures for route-handler tests.

// user_roles as the per-request (RLS: own rows only) client sees it, answering
// all three query shapes lib/roles.ts makes: hasRole (eq role + maybeSingle),
// hasAnyRole (limit 1 + maybeSingle) and currentRoles (plain select).
export function roleTable(roles: string[]): TableHandler {
  return (op) => {
    const wanted = op.filters.find((f) => f[0] === 'eq' && f[1] === 'role')?.[2];
    if (wanted !== undefined) return { data: roles.includes(wanted as string) ? { role: wanted } : null };
    if (op.single) return { data: roles.length ? { role: roles[0] } : null };
    return { data: roles.map((role) => ({ role })) };
  };
}

// pathway_contributors membership for authorizePathwayContributor.
export function memberTable(pathwayIds: string[]): TableHandler {
  return (op) => {
    const pathwayId = op.filters.find((f) => f[0] === 'eq' && f[1] === 'pathway_id')?.[2];
    return { data: pathwayIds.includes(pathwayId as string) ? { user_id: 'member' } : null };
  };
}

// A session client for `user` (null = anonymous) holding `roles`.
export function sessionMock(
  user: MockUser | null,
  roles: string[] = [],
  tables: Record<string, TableHandler> = {}
): SupabaseMock {
  return createSupabaseMock({ user, tables: { user_roles: roleTable(roles), ...tables } });
}

// Ops the route itself made — without the sys_errors rows withErrorHandling
// writes in the background for every 4xx/5xx.
export function routeOps(sb: SupabaseMock) {
  return sb.queryOps.filter((o) => o.table !== 'sys_errors');
}

export function assetId(): string {
  return `asset-${randomUUID()}`;
}
