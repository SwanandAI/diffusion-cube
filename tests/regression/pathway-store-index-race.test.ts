import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type QueryOp, type SupabaseMock, type TableHandler } from '../helpers/supabase-mock';

// Regression repros for the background indexing job (lib/pathway-store.ts,
// indexPublishedVersion). Each test asserts the CORRECT behaviour, so it
// fails until the bug it names is fixed.

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/embeddings', () => ({
  embedTexts: vi.fn(),
  toPgVector: (v: number[]) => `[${v.join(',')}]`,
}));
vi.mock('@/lib/errors', () => ({ logError: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { embedTexts } from '@/lib/embeddings';
import { indexPublishedVersion } from '@/lib/pathway-store';

const DOC = `---
title: Maha Path
---

## Section 1 — Overview

The pilot ran in two districts.
`;

const UNIT_ROW = { id: 'maha-u01', title: 'Sign an MoU', applies_when: '', fails_when: '', adopter_intents: [], body: 'Body' };
const vec = Array.from({ length: 384 }, () => 0.5);
const FAST = { retryDelayMs: 0 };

let admin: SupabaseMock;

function setup(tables: Record<string, TableHandler>) {
  admin = createSupabaseMock({ tables });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

beforeEach(() => {
  vi.mocked(embedTexts).mockReset();
  vi.mocked(embedTexts).mockImplementation(async (texts: string[]) => texts.map(() => vec));
});

describe('indexPublishedVersion — a newer publish lands while the job is embedding', () => {
  // The job for v2 passes its "still the live version?" check, then spends
  // seconds embedding. Meanwhile the admin publishes v3: publishVersion
  // deletes v2's units and inserts v3's under the SAME ids (<slug>-uNN).
  function tables(): Record<string, TableHandler> {
    let pointerReads = 0;
    return {
      pathways: (op: QueryOp) => {
        if (op.action !== 'select') return {};
        pointerReads++;
        // First read: v2 is live. Any later read: v3 has been published.
        return { data: { published_version_id: pointerReads === 1 ? 'v2' : 'v3' } };
      },
      pathway_units: (op: QueryOp) => (op.action === 'select' ? { data: [UNIT_ROW] } : {}),
      pathway_versions: () => ({ data: { content: DOC } }),
      pathway_doc_chunks: () => ({}),
    };
  }

  it("BUG-3: never writes v2's unit vectors onto rows that now belong to v3", async () => {
    setup(tables());
    await indexPublishedVersion({ pathwayId: 'p1', versionId: 'v2' }, undefined, FAST);
    // Every vector write must be scoped to the version it was computed from;
    // an update by id alone hits v3's row with the same id.
    for (const op of admin.ops('pathway_units', 'update')) {
      expect(op.filters).toContainEqual(['eq', 'version_id', 'v2']);
    }
  });

  it("BUG-3: does not delete the pathway's document passages once it has been superseded", async () => {
    setup(tables());
    const res = await indexPublishedVersion({ pathwayId: 'p1', versionId: 'v2' }, undefined, FAST);
    // The delete is pathway-wide, so a stale job wipes v3's freshly indexed
    // passages and inserts v2's — which match_pathway_doc_chunks then ignores
    // (version_id <> published_version_id). Net: v3 has no passages while
    // index_status says 'indexed'.
    expect(admin.ops('pathway_doc_chunks', 'delete')).toHaveLength(0);
    expect(admin.ops('pathway_doc_chunks', 'insert')).toHaveLength(0);
    expect(res.superseded).toBe(true);
  });
});
