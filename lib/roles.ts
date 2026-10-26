import type { SupabaseClient } from '@supabase/supabase-js';

// Every account holds 'adopter' from creation (a trigger on auth.users —
// migration 0039); the other two are granted by an admin.
export type Role = 'adopter' | 'pathway_contributor' | 'admin';

// Checks the CURRENT signed-in user's own roles via the normal per-request
// client (not the service-role client) — relies on user_roles' "select own
// rows" RLS policy, so this only ever sees the caller's own grants.
export async function hasRole(supabase: SupabaseClient, role: Role): Promise<boolean> {
  const { data } = await supabase.from('user_roles').select('role').eq('role', role).maybeSingle();
  return !!data;
}

// All of the current user's roles in one query (same RLS as hasRole) — for a
// route that checks several.
// Throws if the read fails, so a database error surfaces as a 500 rather
// than being mistaken for an account with no roles.
export async function currentRoles(supabase: SupabaseClient): Promise<Set<Role>> {
  const { data, error } = await supabase.from('user_roles').select('role');
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.role as Role));
}

// Every account gets 'adopter' when it's created (migration 0039), so a
// zero-role account shouldn't exist any more — this stays as a guard on the
// signed-in-only pages and routes (see app/(app)/layout.tsx).
export async function hasAnyRole(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase.from('user_roles').select('role').limit(1).maybeSingle();
  return !!data;
}

// ADMIN_EMAILS is a permanent fallback, not the only path — kept so there's
// no bootstrapping problem (someone always has access even if user_roles is
// ever empty or a row goes missing). Real admin grants beyond this list live
// in the database as an ordinary 'admin' role, same as the other three.
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const adminAddresses = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return adminAddresses.includes(email.toLowerCase());
}

// The actual check to use everywhere — env-var fallback OR a real 'admin'
// role grant.
export async function isAdmin(supabase: SupabaseClient, email: string | null | undefined): Promise<boolean> {
  if (isAdminEmail(email)) return true;
  return hasRole(supabase, 'admin');
}
