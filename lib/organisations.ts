// Server-only helpers for the organisations registry.
// Client components should fetch from /api/organisations, not import this.

import { createAdminClient } from '@/lib/supabase/admin'

export interface Organisation {
  id: string
  name: string
  canonical_role: string | null
  url: string | null
}

// ilike treats % and _ as wildcards and \ as their escape — a name containing
// them must match literally.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

/** Search by name prefix — used for the autocomplete in OrganisationInput. */
export async function searchOrganisations(query: string): Promise<Organisation[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('organisations')
    .select('id, name, canonical_role, url')
    .ilike('name', `%${escapeLike(query)}%`)
    .order('name', { ascending: true })
    .limit(10)
  if (error) throw error
  return (data as Organisation[]) ?? []
}

/**
 * Find an existing org by exact name (case-insensitive) or create it.
 * Returns the org id. Used by the join-pathway route. `url`, when given, is
 * only ever set on create — an existing org's URL is never overwritten by a
 * later contributor's registration, since it's shared/canonical.
 */
export async function ensureOrganisation(name: string, canonicalRole?: string, url?: string): Promise<string> {
  const admin = createAdminClient()
  const trimmed = name.trim()

  // Try exact match first (case-insensitive via ilike + limit 1)
  const { data: existing } = await admin
    .from('organisations')
    .select('id')
    .ilike('name', escapeLike(trimmed))
    .limit(1)
    .maybeSingle()

  if (existing) return existing.id as string

  // Create a new org (service-role bypasses the "inserts via service-role only" RLS)
  const { data: created, error } = await admin
    .from('organisations')
    .insert({ name: trimmed, canonical_role: canonicalRole ?? null, url: url?.trim() ?? '' })
    .select('id')
    .single()

  if (error || !created) throw new Error(`Could not create organisation "${trimmed}": ${error?.message}`)
  return created.id as string
}
