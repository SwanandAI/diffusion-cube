import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type SupabaseMock } from '../../helpers/supabase-mock';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
// Only a type is used from ChatPanel; keep the React component out of the test.
vi.mock('@/components/ChatPanel', () => ({}));

import { createClient } from '@/lib/supabase/client';
import { EMPTY_GRID } from '@/lib/dimensions';
import type { Message } from '@/components/ChatPanel';
import {
  formatVersionLabel,
  getLatestDesignDocument,
  hashConversationState,
  insertDesignDocumentVersion,
  insertDraftVersion,
  listDesignDocumentVersions,
} from '@/lib/design-documents';

const msg = (content: string) => ({ role: 'user', content }) as unknown as Message;
const row = (version: number) => ({
  id: `d${version}`,
  design_id: 'design-1',
  doc_type: 'analysis',
  version_number: version,
  content_hash: 'h',
  content: 'c',
  created_at: '2026-10-01T00:00:00Z',
});

let sb: SupabaseMock;
function useTable(response: { data?: unknown; error?: { message: string } | null }) {
  sb = createSupabaseMock({ tables: { design_documents: response } });
  vi.mocked(createClient).mockReturnValue(sb.client);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('hashConversationState', () => {
  it('is deterministic and hex', () => {
    const a = hashConversationState([msg('hi')], EMPTY_GRID);
    expect(a).toBe(hashConversationState([msg('hi')], EMPTY_GRID));
    expect(a).toMatch(/^[0-9a-f]{1,8}$/);
  });

  it('changes when a message is added or edited', () => {
    const base = hashConversationState([msg('hi')], EMPTY_GRID);
    expect(hashConversationState([msg('hi'), msg('more')], EMPTY_GRID)).not.toBe(base);
    expect(hashConversationState([msg('hj')], EMPTY_GRID)).not.toBe(base);
  });

  it("changes when any cell's density or note changes", () => {
    const base = hashConversationState([], EMPTY_GRID);
    expect(hashConversationState([], { ...EMPTY_GRID, 'persona:Explore': { density: 1, note: '' } })).not.toBe(base);
    expect(hashConversationState([], { ...EMPTY_GRID, 'persona:Explore': { density: 0, note: 'x' } })).not.toBe(base);
  });

  it('handles empty input, unicode and very long conversations', () => {
    expect(hashConversationState([], {})).toMatch(/^[0-9a-f]+$/);
    expect(hashConversationState([msg('किसान 😀')], EMPTY_GRID)).toMatch(/^[0-9a-f]+$/);
    expect(hashConversationState([msg('x'.repeat(200_000))], EMPTY_GRID)).toMatch(/^[0-9a-f]+$/);
  });
});

describe('formatVersionLabel', () => {
  it.each([
    [1, 'v0.1'],
    [9, 'v0.9'],
    [10, 'v0.10'],
    [0, 'v0.0'],
  ])('%i -> %s', (n, label) => {
    expect(formatVersionLabel(n)).toBe(label);
  });
});

describe('getLatestDesignDocument', () => {
  it('reads the newest version for one design and doc type', async () => {
    useTable({ data: row(3) });
    await expect(getLatestDesignDocument('design-1', 'analysis')).resolves.toEqual(row(3));
    const [op] = sb.ops('design_documents', 'select');
    expect(op.filters).toEqual([
      ['eq', 'design_id', 'design-1'],
      ['eq', 'doc_type', 'analysis'],
      ['order', 'version_number', { ascending: false }],
      ['limit', 1],
    ]);
    expect(op.single).toBe('maybeSingle');
  });

  it('returns null when there is no version yet', async () => {
    useTable({ data: null });
    await expect(getLatestDesignDocument('design-1', 'plan')).resolves.toBeNull();
  });

  it('returns null (and logs) on a read error', async () => {
    useTable({ error: { message: 'boom' } });
    await expect(getLatestDesignDocument('design-1', 'plan')).resolves.toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('listDesignDocumentVersions', () => {
  it('lists versions newest first', async () => {
    useTable({ data: [row(2), row(1)] });
    await expect(listDesignDocumentVersions('design-1', 'draft')).resolves.toEqual([row(2), row(1)]);
    expect(sb.ops('design_documents', 'select')[0].filters).toContainEqual(['order', 'version_number', { ascending: false }]);
  });

  it('returns [] for null data or an error', async () => {
    useTable({ data: null });
    await expect(listDesignDocumentVersions('design-1', 'draft')).resolves.toEqual([]);
    useTable({ error: { message: 'boom' } });
    await expect(listDesignDocumentVersions('design-1', 'draft')).resolves.toEqual([]);
  });
});

describe('insertDesignDocumentVersion / insertDraftVersion', () => {
  beforeEach(() => useTable({ data: row(4) }));

  it('inserts previous + 1 and returns the stored row', async () => {
    await expect(insertDesignDocumentVersion('design-1', 'analysis', 'abc', '# Doc', 3)).resolves.toEqual(row(4));
    const [op] = sb.ops('design_documents', 'insert');
    expect(op.payload).toEqual({ design_id: 'design-1', doc_type: 'analysis', version_number: 4, content_hash: 'abc', content: '# Doc' });
    expect(op.single).toBe('single');
  });

  it('starts at version 1 when there is none', async () => {
    await insertDesignDocumentVersion('design-1', 'plan', 'h', 'c', 0);
    expect(sb.ops('design_documents', 'insert')[0].payload).toMatchObject({ version_number: 1 });
  });

  it('returns null on an insert error', async () => {
    useTable({ error: { message: 'unique violation' } });
    await expect(insertDesignDocumentVersion('design-1', 'plan', 'h', 'c', 1)).resolves.toBeNull();
  });

  it('stores a draft with doc_type draft and a timestamp as its hash', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_790_000_000_000);
    await insertDraftVersion('design-1', 'draft body', 2);
    expect(sb.ops('design_documents', 'insert')[0].payload).toEqual({
      design_id: 'design-1',
      doc_type: 'draft',
      version_number: 3,
      content_hash: '1790000000000',
      content: 'draft body',
    });
  });
});
