// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type SupabaseMock } from '../helpers/supabase-mock';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/design-documents', () => ({
  getLatestDesignDocument: vi.fn(async () => null),
  listDesignDocumentVersions: vi.fn(async () => []),
  insertDesignDocumentVersion: vi.fn(),
  insertDraftVersion: vi.fn(),
  hashConversationState: vi.fn(() => 'hash-1'),
}));
vi.mock('@/lib/extract-text', () => ({
  ATTACH_ACCEPT: '.pdf,.txt,.png',
  CONTRIBUTOR_ATTACH_ACCEPT: '.pdf,.txt,.png,.csv',
  getFileExtension: vi.fn((name: string) => {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    return ['pdf', 'txt', 'md', 'png', 'jpg'].includes(ext) ? ext : null;
  }),
  isImageFile: vi.fn((name: string) => /\.(png|jpg)$/i.test(name)),
  extractTextFromFile: vi.fn(async () => 'extracted text'),
  fileToImageBlock: vi.fn(async () => ({ mediaType: 'image/png', base64: 'IMG64' })),
}));

import { createClient } from '@/lib/supabase/client';
import {
  getLatestDesignDocument,
  insertDesignDocumentVersion,
  insertDraftVersion,
  listDesignDocumentVersions,
} from '@/lib/design-documents';
import { extractTextFromFile } from '@/lib/extract-text';
import {
  EMPTY_GRID,
  EMPTY_META,
  useAdoptionConversation,
  type AdoptionConversation,
} from '@/lib/adoption-conversation';
import { GENERIC_ERROR_MESSAGE } from '@/lib/error-messages';
import { ANALYSIS_DOC_MARKER, PATHWAY_DOC_MARKER, PUBLISH_CONSENT_MARKER } from '@/lib/grid-update';
import type { Message } from '@/components/ChatPanel';

// ---- fetch plumbing -------------------------------------------------------

type FetchCall = { url: string; init?: RequestInit; body: Record<string, unknown> };
type Handler = (call: FetchCall) => Response | Promise<Response>;

let calls: FetchCall[];
let routes: Handler;

function streamResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// A reply whose stream breaks after the given chunks.
function brokenStreamResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (i < chunks.length) return { done: false, value: enc.encode(chunks[i++]) };
          throw new Error('network reset');
        },
      }),
    },
  } as unknown as Response;
}

function gridUpdate(obj: unknown): string {
  return `<grid_update>${JSON.stringify(obj)}</grid_update>`;
}

function chatCalls(mode?: string) {
  return calls.filter((c) => c.url === '/api/chat' && (!mode || c.body.mode === mode));
}

// ---- supabase plumbing ----------------------------------------------------

let sb: SupabaseMock;
let designInsertError = false;
let pathwayRow: Record<string, unknown> | null = null;

function makeSupabase() {
  sb = createSupabaseMock({
    tables: {
      designs: (op) => {
        if (op.action === 'insert') {
          if (designInsertError) return { error: { message: 'rls' } };
          const p = op.payload as Record<string, unknown>;
          return {
            data: { id: 'design-1', meta: p.meta, grid_state: p.grid_state, messages: p.messages, updated_at: '2026-10-01T00:00:00Z' },
          };
        }
        return {};
      },
      pathways: () => ({ data: pathwayRow }),
    },
  });
  vi.mocked(createClient).mockReturnValue(sb.client);
}

function lastPersistedMessages(): Message[] {
  const updates = sb.ops('designs', 'update');
  return (updates[updates.length - 1].payload as { messages: Message[] }).messages;
}

function existing(flow: 'explorer' | 'contributor', messages: Message[] = [], extraMeta: Partial<typeof EMPTY_META> = {}): AdoptionConversation {
  return {
    id: 'design-9',
    meta: { ...EMPTY_META, flow, ...extraMeta },
    grid: { ...EMPTY_GRID },
    messages,
    updatedAt: '2026-10-01T00:00:00Z',
  };
}

beforeEach(() => {
  calls = [];
  designInsertError = false;
  pathwayRow = null;
  routes = () => streamResponse(['Hello']);
  makeSupabase();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      const call = { url, init, body };
      calls.push(call);
      return routes(call);
    })
  );
});

// ---------------------------------------------------------------------------

describe('useAdoptionConversation — first message', () => {
  it('lazily creates the row, streams the reply, applies the grid_update and persists', async () => {
    const onCreated = vi.fn();
    const onChange = vi.fn();
    routes = () =>
      streamResponse([
        'Thanks — tell me ',
        'more about the pilot.',
        '<grid_update>{"cells":{"persona:Explore":{"density":2,"note":"farmers"}},',
        '"meta":{"name":"Kiosk","sector":"Agri"},"flowStep":2,"pathwaysReferenced":["blue-dots"]}</grid_update>',
      ]);
    const { result } = renderHook(() => useAdoptionConversation({ initial: null, onCreated, onChange }));
    expect(result.current.conversation).toBeNull();

    await act(async () => {
      await result.current.handleUserSend('We run kiosks', 'explorer', 'analyse');
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Row created once with the chosen flow/intent.
    const [insert] = sb.ops('designs', 'insert');
    expect((insert.payload as { meta: typeof EMPTY_META }).meta).toMatchObject({ flow: 'explorer', intent: 'analyse' });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'design-1' }));

    // Request shape.
    const [call] = chatCalls('companion');
    expect(call.body).toMatchObject({ designId: 'design-1', flow: 'explorer', messages: [{ role: 'user', content: 'We run kiosks' }] });
    expect(call.body.existingPublishedDoc).toBeUndefined();

    const conv = result.current.conversation!;
    expect(conv.messages).toEqual([
      { role: 'user', content: 'We run kiosks' },
      { role: 'assistant', content: 'Thanks — tell me more about the pilot.', pathwaysReferenced: ['blue-dots'] },
    ]);
    expect(conv.grid['persona:Explore']).toEqual({ density: 2, note: 'farmers' });
    expect(conv.meta).toMatchObject({ name: 'Kiosk', sector: 'Agri', flowStep: 2, flow: 'explorer' });

    await waitFor(() => expect(sb.ops('designs', 'update').length).toBeGreaterThan(0));
    expect(lastPersistedMessages()).toHaveLength(2);
    expect(onChange).toHaveBeenCalled();
  });

  it('never moves flowStep backwards without an intent switch, and ignores unknown grid cells', async () => {
    routes = () => streamResponse(['ok', gridUpdate({ cells: { 'bogus:Cell': { density: 3, note: 'x' } }, flowStep: 1 })]);
    const { result } = renderHook(() =>
      useAdoptionConversation({ initial: existing('explorer', [], { flowStep: 4, intent: 'analyse' }) })
    );
    await act(async () => {
      await result.current.handleUserSend('next');
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.conversation!.meta.flowStep).toBe(4);
    expect(result.current.conversation!.grid).not.toHaveProperty('bogus:Cell');
  });

  it('surfaces a row-creation failure and never calls /api/chat', async () => {
    designInsertError = true;
    const { result } = renderHook(() => useAdoptionConversation({ initial: null }));
    let error: unknown;
    await act(async () => {
      await result.current.handleUserSend('hi', 'explorer').catch((e) => {
        error = e;
      });
    });
    expect((error as Error).message).toBe('Could not start a new adoption workspace. Try again.');
    expect(chatCalls()).toHaveLength(0);
    expect(result.current.conversation).toBeNull();
  });

  it('seeds a contributor row with the pathway it joins', async () => {
    pathwayRow = { title: 'Voice AI', description: 'Extension', slug: 'voice-ai', content_cache: null };
    const { result } = renderHook(() => useAdoptionConversation({ initial: null, pathwayId: 'pw-1' }));
    await waitFor(() => expect(result.current.pathwayPreview).toEqual({ title: 'Voice AI', sector: '', description: 'Extension' }));
    await act(async () => {
      await result.current.handleUserSend('hi', 'contributor');
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const [insert] = sb.ops('designs', 'insert');
    expect(insert.payload).toMatchObject({
      pathway_id: 'pw-1',
      meta: { flow: 'contributor', pathwayId: 'pw-1', name: 'Voice AI', summary: 'Extension' },
    });
  });
});

describe('useAdoptionConversation — failed turns', () => {
  it('shows a 4xx error body as a notice that is neither persisted nor sent back as history', async () => {
    routes = () => jsonResponse({ error: 'You need the Explorer role.' }, 403);
    const { result } = renderHook(() => useAdoptionConversation({ initial: existing('explorer') }));
    await act(async () => {
      await result.current.handleUserSend('hi');
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const msgs = result.current.conversation!.messages;
    expect(msgs[msgs.length - 1]).toEqual({ role: 'assistant', content: 'You need the Explorer role.', notice: true });
    expect(sb.ops('designs', 'update')).toHaveLength(0);

    routes = () => streamResponse(['second reply']);
    await act(async () => {
      await result.current.handleUserSend('again');
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const second = chatCalls('companion')[1];
    expect(second.body.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'user', content: 'again' },
    ]);
    await waitFor(() => expect(sb.ops('designs', 'update').length).toBeGreaterThan(0));
    expect(lastPersistedMessages().some((m) => m.notice)).toBe(false);
  });

  it('shows the generic message for a 5xx, without reading its body', async () => {
    routes = () => jsonResponse({ error: 'stack trace leak' }, 500);
    const { result } = renderHook(() => useAdoptionConversation({ initial: existing('explorer') }));
    await act(async () => {
      await result.current.handleUserSend('hi');
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.conversation!.messages.at(-1)).toEqual({ role: 'assistant', content: GENERIC_ERROR_MESSAGE, notice: true });
  });

  it('shows the generic message when the 4xx body is not JSON', async () => {
    routes = () => new Response('<html>bad gateway</html>', { status: 429 });
    const { result } = renderHook(() => useAdoptionConversation({ initial: existing('explorer') }));
    await act(async () => {
      await result.current.handleUserSend('hi');
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.conversation!.messages.at(-1)?.content).toBe(GENERIC_ERROR_MESSAGE);
  });

  it('shows the generic message when the network request itself throws', async () => {
    routes = () => {
      throw new TypeError('Failed to fetch');
    };
    const { result } = renderHook(() => useAdoptionConversation({ initial: existing('explorer') }));
    await act(async () => {
      await result.current.handleUserSend('hi');
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.conversation!.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: GENERIC_ERROR_MESSAGE, notice: true },
    ]);
  });

  it('keeps the partial reply (minus any grid_update) above the generic message when the stream breaks', async () => {
    routes = () => brokenStreamResponse(['Half an answer', '<grid_update>{"cells":']);
    const { result } = renderHook(() => useAdoptionConversation({ initial: existing('explorer') }));
    await act(async () => {
      await result.current.handleUserSend('hi');
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.conversation!.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: `Half an answer\n\n${GENERIC_ERROR_MESSAGE}`, notice: true },
    ]);
    expect(sb.ops('designs', 'update')).toHaveLength(0);
  });
});

describe('useAdoptionConversation — attachments', () => {
  it('stages a text file (reading → ready) and folds it into the next message', async () => {
    const { result } = renderHook(() => useAdoptionConversation({ initial: existing('explorer') }));
    act(() => {
      result.current.handleAttachFiles([new File(['abc'], 'report.pdf')]);
    });
    expect(result.current.pendingAttachments[0]).toMatchObject({ name: 'report.pdf', state: 'reading' });
    await waitFor(() => expect(result.current.pendingAttachments[0].state).toBe('ready'));

    await act(async () => {
      await result.current.handleUserSend('');
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pendingAttachments).toEqual([]);
    const user = result.current.conversation!.messages.find((m) => m.role === 'user')!;
    expect(user.content).toContain('Please read the attached file(s)');
    expect(user.content).toContain('--- Uploaded: report.pdf ---\nextracted text');
    expect(user.displayContent).toBe('📄 Uploaded **report.pdf**');
  });

  it('sends an attached image as a base64 image block', async () => {
    const { result } = renderHook(() => useAdoptionConversation({ initial: existing('explorer') }));
    act(() => {
      result.current.handleAttachFiles([new File(['x'], 'photo.png')]);
    });
    await waitFor(() => expect(result.current.pendingAttachments[0]?.state).toBe('ready'));
    await act(async () => {
      await result.current.handleUserSend('what is this');
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const [call] = chatCalls('companion');
    expect((call.body.messages as unknown[]).at(-1)).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'what is this' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'IMG64' } },
      ],
    });
    expect(result.current.conversation!.messages[0].displayContent).toBe('what is this\n🖼️ Uploaded **photo.png**');
  });

  it('rejects an unsupported type in the explorer flow with an error chip', () => {
    const { result } = renderHook(() => useAdoptionConversation({ initial: existing('explorer') }));
    act(() => {
      result.current.handleAttachFiles([new File(['x'], 'data.csv')]);
    });
    expect(result.current.pendingAttachments[0]).toMatchObject({ state: 'error' });
    expect(result.current.pendingAttachments[0].error).toMatch(/Unsupported type/);
  });

  it('keeps an unreadable allowed file as an asset-only attachment in the contributor flow', async () => {
    vi.mocked(extractTextFromFile).mockRejectedValueOnce(new Error('No readable text'));
    const { result } = renderHook(() => useAdoptionConversation({ initial: existing('contributor') }));
    act(() => {
      result.current.handleAttachFiles([new File(['%PDF'], 'scan.pdf')]);
    });
    await waitFor(() => expect(result.current.pendingAttachments[0]?.state).toBe('ready'));
    expect(result.current.pendingAttachments[0]).toMatchObject({ kind: 'asset', sizeBytes: 4 });
    expect(result.current.hasToolkitAssetFile('scan.pdf')).toBe(true);
  });

  it('marks an unreadable file as an error in the explorer flow, and removeAttachment drops it', async () => {
    vi.mocked(extractTextFromFile).mockRejectedValueOnce(new Error('No readable text found'));
    const { result } = renderHook(() => useAdoptionConversation({ initial: existing('explorer') }));
    act(() => {
      result.current.handleAttachFiles([new File(['%PDF'], 'scan.pdf')]);
    });
    await waitFor(() => expect(result.current.pendingAttachments[0]?.state).toBe('error'));
    expect(result.current.pendingAttachments[0].error).toBe('No readable text found');
    act(() => {
      result.current.removeAttachment(result.current.pendingAttachments[0].id);
    });
    expect(result.current.pendingAttachments).toEqual([]);
  });
});

describe('useAdoptionConversation — explorer documents', () => {
  it('reads back stored analysis/summary for a reopened explorer conversation', async () => {
    const row = { id: 'doc-a', design_id: 'design-9', doc_type: 'analysis', version_number: 1, content_hash: 'h', content: 'A', created_at: '' };
    vi.mocked(getLatestDesignDocument).mockImplementation(async (_id, type) => (type === 'analysis' ? (row as never) : null));
    const { result } = renderHook(() => useAdoptionConversation({ initial: existing('explorer') }));
    await waitFor(() => expect(result.current.explorerDoc.analysis).toEqual(row));
    expect(getLatestDesignDocument).toHaveBeenCalledWith('design-9', 'plan');
    expect(listDesignDocumentVersions).not.toHaveBeenCalled();

    act(() => result.current.openExplorerDocument('analysis'));
    expect(result.current.explorerDoc.open).toBe('analysis');
    act(() => result.current.closeExplorerDocument());
    expect(result.current.explorerDoc.open).toBeNull();
  });

  it('generates and stores the analysis document when the companion asks for it', async () => {
    vi.mocked(insertDesignDocumentVersion).mockResolvedValue({
      id: 'doc-1',
      design_id: 'design-9',
      doc_type: 'analysis',
      version_number: 1,
      content_hash: 'hash-1',
      content: '# Analysis',
      created_at: '',
    });
    routes = ({ body }) =>
      body.mode === 'analysis-doc'
        ? streamResponse(['# Analy', 'sis'])
        : streamResponse(['Generating it now.', gridUpdate({ cells: {}, explorerAction: { type: 'analysis' } })]);
    const { result } = renderHook(() => useAdoptionConversation({ initial: existing('explorer') }));
    await act(async () => {
      await result.current.handleUserSend('yes please');
    });
    await waitFor(() => expect(result.current.explorerDoc.analysis?.id).toBe('doc-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(insertDesignDocumentVersion).toHaveBeenCalledWith('design-9', 'analysis', 'hash-1', '# Analysis', 0);
    const last = result.current.conversation!.messages.at(-1)!;
    expect(last.content).toContain(ANALYSIS_DOC_MARKER);
    expect(last.content).toContain('Would you like to work on any of the specific gaps');
    expect(result.current.explorerDoc.generating).toBeNull();
  });

  it('records the error and saves nothing when document generation fails', async () => {
    routes = ({ body }) =>
      body.mode === 'analysis-doc'
        ? jsonResponse({ error: 'Daily limit reached.' }, 429)
        : streamResponse(['ok', gridUpdate({ cells: {}, explorerAction: { type: 'analysis' } })]);
    const { result } = renderHook(() => useAdoptionConversation({ initial: existing('explorer') }));
    await act(async () => {
      await result.current.handleUserSend('yes');
    });
    await waitFor(() => expect(result.current.explorerDoc.error).toBe('Daily limit reached.'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(insertDesignDocumentVersion).not.toHaveBeenCalled();
    expect(result.current.conversation!.messages.at(-1)!.content).not.toContain(ANALYSIS_DOC_MARKER);
  });
});

describe('useAdoptionConversation — contributor pathway flow', () => {
  const DRAFT = [
    '# Voice AI pathway',
    '',
    '## Section 4 — Toolkits and playbooks',
    '',
    '| # | Title | Type | Reuse condition |',
    '|---|---|---|---|',
    '| 1 | Farmer FAQ Bank | Toolkit Asset | New language rollout |',
    '',
    '## Section 5 — Problems',
  ].join('\n');

  it('drafts the pathway in the background and appends the draft card plus the asset card', async () => {
    vi.mocked(insertDraftVersion).mockResolvedValue({
      id: 'draft-1',
      design_id: 'design-9',
      doc_type: 'draft',
      version_number: 1,
      content_hash: 'x',
      content: DRAFT,
      created_at: '',
    });
    routes = ({ body }) =>
      body.mode === 'pathway-draft'
        ? streamResponse([DRAFT])
        : streamResponse(['Drafting now.', gridUpdate({ cells: {}, pathwayAction: { type: 'generate' } })]);
    const { result } = renderHook(() =>
      useAdoptionConversation({ initial: existing('contributor', [], { pathwayId: 'pw-1' }) })
    );
    await act(async () => {
      await result.current.handleUserSend('that is everything');
    });
    await waitFor(() => expect(result.current.pathwayDoc.content).not.toBeNull());
    await waitFor(() => expect(result.current.conversation!.messages.some((m) => m.assetShare)).toBe(true));

    const draftCall = chatCalls('pathway-draft')[0];
    const trailing = (draftCall.body.messages as Array<{ content: string }>).at(-1)!.content;
    expect(trailing).toContain('Draft my adoption as a pathway page now.');
    expect(trailing).toContain('none found');

    expect(result.current.pathwayDoc).toMatchObject({ versionNumber: 1, loading: false, error: null });
    const msgs = result.current.conversation!.messages;
    const docMsg = msgs.find((m) => m.content.includes(PATHWAY_DOC_MARKER))!;
    expect(docMsg.content).toContain('Next, share the reusable assets listed in Section 4 below.');
    const card = msgs.find((m) => m.assetShare)!.assetShare!;
    expect(card.items.map((i) => i.name)).toEqual(['Farmer FAQ Bank']);
    expect(card.noneInSection4).toBe(false);
  });

  it('records the draft error and stores no version when pathway-draft fails', async () => {
    routes = ({ body }) =>
      body.mode === 'pathway-draft'
        ? jsonResponse({}, 500)
        : streamResponse(['Drafting now.', gridUpdate({ cells: {}, pathwayAction: { type: 'generate' } })]);
    const { result } = renderHook(() =>
      useAdoptionConversation({ initial: existing('contributor', [], { pathwayId: 'pw-1' }) })
    );
    await act(async () => {
      await result.current.handleUserSend('go');
    });
    await waitFor(() => expect(result.current.pathwayDoc.error).toBe(GENERIC_ERROR_MESSAGE));
    expect(insertDraftVersion).not.toHaveBeenCalled();
    expect(result.current.pathwayDoc.loading).toBe(false);
  });

  it('a publish action raises one consent card; "keep" marks it kept and persists', async () => {
    routes = () => streamResponse(['Sure.', gridUpdate({ cells: {}, pathwayAction: { type: 'publish' } })]);
    const { result } = renderHook(() =>
      useAdoptionConversation({ initial: existing('contributor', [], { pathwayId: 'pw-1' }) })
    );
    await act(async () => {
      await result.current.handleUserSend('publish it');
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const card = result.current.conversation!.messages.find((m) => m.publishConsent)!;
    expect(card.displayContent).toBe(PUBLISH_CONSENT_MARKER);
    expect(card.publishConsent!.status).toBe('pending');

    // A second request while one is pending doesn't add another card.
    await act(async () => {
      await result.current.requestPublishConsent();
    });
    expect(result.current.conversation!.messages.filter((m) => m.publishConsent)).toHaveLength(1);

    let answer: { ok: boolean } | undefined;
    await act(async () => {
      answer = await result.current.answerPublishConsent(card.publishConsent!.id, 'keep');
    });
    expect(answer).toEqual({ ok: true });
    const kept = result.current.conversation!.messages.find((m) => m.publishConsent)!;
    expect(kept.publishConsent!.status).toBe('kept');
    expect(kept.content).toContain('private draft');
    await waitFor(() => expect(lastPersistedMessages().find((m) => m.publishConsent)?.publishConsent?.status).toBe('kept'));
  });

  it('"send" assembles the pathway, marks the card sent and appends the outcome', async () => {
    const { result } = renderHook(() =>
      useAdoptionConversation({ initial: existing('contributor', [], { pathwayId: 'pw-1' }) })
    );
    await act(async () => {
      await result.current.requestPublishConsent();
    });
    const id = result.current.conversation!.messages[0].publishConsent!.id;
    routes = ({ url }) =>
      url === '/api/pathways/assemble' ? jsonResponse({ slug: 'voice-ai', content: '# Final' }) : streamResponse(['']);
    let answer: { ok: boolean } | undefined;
    await act(async () => {
      answer = await result.current.answerPublishConsent(id, 'send');
    });
    expect(answer).toEqual({ ok: true });
    expect(calls.find((c) => c.url === '/api/pathways/assemble')!.body).toEqual({ pathwayId: 'pw-1', designId: 'design-9' });
    expect(result.current.pathwayDoc).toMatchObject({ reviewRequested: true, publishedSlug: 'voice-ai', content: '# Final' });
    const msgs = result.current.conversation!.messages;
    expect(msgs[0].publishConsent!.status).toBe('sent');
    expect(msgs.at(-1)!.content).toContain('Sent for review.');
    expect(result.current.loading).toBe(false);
    expect(result.current.toolkitAssetsVersion).toBe(1);
  });

  it('"send" failure returns the server error and leaves the card pending', async () => {
    const { result } = renderHook(() =>
      useAdoptionConversation({ initial: existing('contributor', [], { pathwayId: 'pw-1' }) })
    );
    await act(async () => {
      await result.current.requestPublishConsent();
    });
    const id = result.current.conversation!.messages[0].publishConsent!.id;
    routes = () => jsonResponse({ error: 'No draft to publish yet.' }, 400);
    let answer: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      answer = await result.current.answerPublishConsent(id, 'send');
    });
    expect(answer).toEqual({ ok: false, error: 'No draft to publish yet.' });
    expect(result.current.conversation!.messages[0].publishConsent!.status).toBe('pending');
    expect(result.current.loading).toBe(false);
  });

  it('"delete" failure keeps the card pending; success marks it deleted without persisting', async () => {
    const { result } = renderHook(() =>
      useAdoptionConversation({ initial: existing('contributor', [], { pathwayId: 'pw-1' }) })
    );
    await act(async () => {
      await result.current.requestPublishConsent();
    });
    const id = result.current.conversation!.messages[0].publishConsent!.id;
    routes = () => jsonResponse({}, 500);
    let answer: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      answer = await result.current.answerPublishConsent(id, 'delete');
    });
    expect(answer).toEqual({ ok: false, error: 'Could not delete this contribution. Try again.' });

    const updatesBefore = sb.ops('designs', 'update').length;
    routes = () => jsonResponse({ ok: true });
    await act(async () => {
      answer = await result.current.answerPublishConsent(id, 'delete');
    });
    expect(answer).toEqual({ ok: true });
    expect(calls.at(-1)).toMatchObject({ url: '/api/contributions/design-9' });
    expect(calls.at(-1)!.init!.method).toBe('DELETE');
    expect(result.current.conversation!.messages[0].publishConsent!.status).toBe('deleted');
    expect(sb.ops('designs', 'update').length).toBe(updatesBefore);
  });

  it('answering an unknown or already-answered consent is a no-op', async () => {
    const { result } = renderHook(() => useAdoptionConversation({ initial: existing('contributor') }));
    let answer: { ok: boolean } | undefined;
    await act(async () => {
      answer = await result.current.answerPublishConsent('nope', 'send');
    });
    expect(answer).toEqual({ ok: true });
    expect(calls).toHaveLength(0);
  });

  it('publishPathwayDocument refuses a workspace with no linked pathway', async () => {
    const { result } = renderHook(() => useAdoptionConversation({ initial: existing('contributor') }));
    let out: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      out = await result.current.publishPathwayDocument();
    });
    expect(out?.ok).toBe(false);
    expect(out?.error).toMatch(/No pathway linked/);
    expect(calls).toHaveLength(0);
  });

  it('loads stored draft versions on mount and lets the pane switch between them', async () => {
    const v2 = { id: 'd2', design_id: 'design-9', doc_type: 'draft' as const, version_number: 2, content_hash: '', content: 'v2', created_at: '' };
    const v1 = { ...v2, id: 'd1', version_number: 1, content: 'v1' };
    vi.mocked(listDesignDocumentVersions).mockResolvedValue([v2, v1]);
    const { result } = renderHook(() => useAdoptionConversation({ initial: existing('contributor') }));
    await waitFor(() => expect(result.current.pathwayDoc.content).toBe('v2'));
    expect(result.current.pathwayDoc.versionNumber).toBe(2);

    act(() => result.current.selectPathwayDocVersion(1));
    expect(result.current.pathwayDoc.selectedVersionNumber).toBe(1);
    // Picking the latest collapses back to "follow the latest".
    act(() => result.current.selectPathwayDocVersion(2));
    expect(result.current.pathwayDoc.selectedVersionNumber).toBeNull();

    act(() => result.current.openPathwayDocument());
    expect(result.current.pathwayDoc.paneOpen).toBe(true);
    act(() => result.current.closePathwayDocument());
    expect(result.current.pathwayDoc.paneOpen).toBe(false);
  });

  it('sends the published pathway as existingPublishedDoc on contributor turns', async () => {
    pathwayRow = { slug: 'voice-ai', content_cache: '# Live doc', title: 'Voice AI', review_requested: true };
    const { result } = renderHook(() =>
      useAdoptionConversation({ initial: existing('contributor', [], { pathwayId: 'pw-1' }) })
    );
    await waitFor(() => expect(result.current.pathwayDoc.pathwayPublishedContent).toBe('# Live doc'));
    expect(result.current.pathwayDoc.reviewRequested).toBe(true);
    await act(async () => {
      await result.current.handleUserSend('adding my part');
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(chatCalls('companion')[0].body.existingPublishedDoc).toBe('# Live doc');
  });
});
