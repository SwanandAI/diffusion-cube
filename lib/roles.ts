import type { SupabaseClient } from '@supabase/supabase-js';

export type Role = 'general_user' | 'adopter' | 'pathway_contributor' | 'admin';

// app_metadata key recording that an account's one-time default 'adopter'
// grant is settled — see app/api/auth/grant-default-role/route.ts.
export const DEFAULT_ROLE_GRANTED_FLAG = 'default_role_granted';

// Checks the CURRENT signed-in user's own roles via the normal per-request
// client (not the service-role client) — relies on user_roles' "select own
// rows" RLS policy, so this only ever sees the caller's own grants.
export async function hasRole(supabase: SupabaseClient, role: Role): Promise<boolean> {
  const { data } = await supabase.from('user_roles').select('role').eq('role', role).maybeSingle();
  return !!data;
}

// A signup with zero roles at all is "pending" — no admin has approved them
// yet. Approving is granting at least one role, so this doubles as the
// approval check (see app/(app)/layout.tsx).
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
