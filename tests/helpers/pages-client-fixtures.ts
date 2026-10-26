import { EMPTY_META, type AdoptionConversation, type AdoptionMeta } from '@/lib/adoption-conversation';
import { EMPTY_GRID } from '@/lib/dimensions';

// Adoption rows for tests/pages/client/* (kept apart from pages-client-helpers
// so tests that don't need them skip importing the conversation module).

let seq = 0;
export function makeAdoption(
  meta: Partial<AdoptionMeta> = {},
  rest: Partial<Omit<AdoptionConversation, 'meta'>> = {}
): AdoptionConversation {
  seq += 1;
  return {
    id: rest.id ?? `design-${seq}`,
    meta: { ...EMPTY_META, ...meta },
    grid: rest.grid ?? EMPTY_GRID,
    messages: rest.messages ?? [],
    updatedAt: rest.updatedAt ?? new Date().toISOString(),
  };
}

export const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
