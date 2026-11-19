import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock } from '../helpers/supabase-mock';

// Regression repros for lib/retrieval.ts (pathwayPassages / selectSourceText)
// and lib/text-chunks.ts. Each test asserts the CORRECT behaviour, so it
// fails until the bug it names is fixed.

const anthropic = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: anthropic.create };
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/embeddings', () => ({ embedTexts: vi.fn(), toPgVector: (v: number[]) => `[${v.join(',')}]` }));
vi.mock('@/lib/ai-usage', () => ({ recordAiUsage: vi.fn() }));
vi.mock('@/lib/errors', () => ({ logError: vi.fn() }));
vi.mock('@/lib/pathway-store', async (orig) => ({
  ...(await orig<typeof import('@/lib/pathway-store')>()),
  publicSourceTexts: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { embedTexts } from '@/lib/embeddings';
import { publicSourceTexts } from '@/lib/pathway-store';
import { pathwayPassages, selectSourceText, SOURCE_TEXT_BUDGET } from '@/lib/retrieval';
import { keywordsOf } from '@/lib/text-chunks';

beforeEach(() => {
  vi.mocked(embedTexts).mockReset();
  vi.mocked(embedTexts).mockResolvedValue([[0.1, 0.2]]);
  vi.mocked(publicSourceTexts).mockReset();
  vi.mocked(publicSourceTexts).mockResolvedValue([{ id: 's1', file_name: 'vendors.pdf', text: 'We chose Vendor X.' }]);
  anthropic.create.mockReset();
});

describe('pathwayPassages', () => {
  it('BUG-6: a failing write-up passage lookup degrades to the originals instead of failing the whole chat', async () => {
    // e.g. migration 0043 not applied yet where the code is deployed, or a
    // transient RPC error. The module promises "nothing here throws" on the
    // coverage path; this error reaches the route and 500s the chat.
    const admin = createSupabaseMock({
      rpc: { match_pathway_doc_chunks: () => ({ error: { message: 'function match_pathway_doc_chunks does not exist', code: '42883' } }) },
    });
    vi.mocked(createAdminClient).mockReturnValue(admin.client);
    await expect(pathwayPassages('maha', 'Which vendor?')).resolves.toContain('Vendor X');
  });
});

describe('selectSourceText', () => {
  it('BUG-9: over budget with no shared keywords, still gives the model something instead of nothing', () => {
    // Haiku already said the write-up does not answer; returning '' turns
    // that into a confident "the pathway doesn't document this".
    const big = { id: 's1', file_name: 'report.pdf', text: 'Telephony vendor selection notes. '.repeat(Math.ceil((SOURCE_TEXT_BUDGET + 10) / 33)) };
    expect(selectSourceText([big], 'Who paid for it?')).not.toBe('');
  });
});

describe('keywordsOf', () => {
  it('BUG-10: keeps Devanagari words whole (vowel signs are \\p{M}, not \\p{L})', () => {
    expect(keywordsOf('किसान सलाह')).toEqual(expect.arrayContaining(['किसान', 'सलाह']));
  });
});
