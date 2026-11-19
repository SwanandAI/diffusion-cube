import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createSupabaseMock, type QueryOp, type SupabaseMock } from '../helpers/supabase-mock';
import { jsonRequest } from '../helpers/request';
import { memberTable, sessionMock } from '../helpers/routes-auth';

// Regression repro for POST /api/pathway-sources. Asserts the CORRECT
// behaviour, so it fails until the bug is fixed.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { POST as register } from '@/app/api/pathway-sources/route';

const KEPT_PATH = 'contrib/p1/1111-Vendor Eval.pdf';
let admin: SupabaseMock;

beforeEach(() => {
  vi.mocked(createClient).mockResolvedValue(
    sessionMock({ id: 'u1', email: 'c@example.com' }, ['adopter', 'pathway_contributor'], {
      pathway_contributors: memberTable(['p1']),
      designs: { data: { id: 'd1', pathway_id: 'p1' } },
    }).client
  );
  // The first attempt's row WAS saved (its response was lost on the way
  // back to the browser), with KEPT_PATH as its file.
  admin = createSupabaseMock({
    tables: {
      pathway_sources: (op: QueryOp) =>
        op.action === 'select' && op.filters.some((f) => f[1] === 'content_hash')
          ? { data: { id: 'row-1', source_key: 'src-01', storage_path: KEPT_PATH } }
          : {},
    },
  });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
});

describe('POST /api/pathway-sources — retry after a lost response', () => {
  it("BUG-2: does not delete the file the already-kept row points at", async () => {
    // keepOriginalDocument's retry re-sends the SAME storagePath it uploaded
    // on attempt 1 (fileDone stays true), with the same text.
    const res = await register(
      new NextRequest(
        jsonRequest('http://localhost/api/pathway-sources', {
          pathwayId: 'p1', designId: 'd1', fileName: 'Vendor Eval.pdf', mimeType: 'application/pdf',
          storagePath: KEPT_PATH, text: 'We chose Vendor X.',
        })
      )
    );
    expect(await res.json()).toMatchObject({ id: 'row-1', duplicate: true });
    // Removing it leaves row-1.storage_path pointing at nothing.
    const removed = admin.storageBucket.remove.mock.calls.flatMap((c) => (c as unknown[])[0] as string[]);
    expect(removed).not.toContain(KEPT_PATH);
  });
});
