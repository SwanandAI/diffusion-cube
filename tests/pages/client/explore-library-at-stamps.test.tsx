// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { jsonResponse, stubFetch } from '../../helpers/ui-fork-http';
import { stubScrollIntoView } from '../../helpers/ui-dom';
import { streamResponse } from '../../helpers/pages-client-helpers';

// The admin Feedback Digest (migration 0045) dates a message by its `at` stamp. These tests check
// that Explore's chat stamps it on the visitor's message and on Cube's finished reply, saves it,
// and never sends it to /api/chat.

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
import { createClient } from '@/lib/supabase/client';
import ExploreLibrary from '@/app/explore/ExploreLibrary';

type Saved = Record<string, unknown>[];
let inserts: { messages: Saved }[];
let updates: { messages: Saved }[];

function mockDb() {
  inserts = [];
  updates = [];
  const client = {
    from: vi.fn(() => ({
      insert: (row: { messages: Saved }) => {
        inserts.push(row);
        return { select: () => ({ single: async () => ({ data: { id: 'conv-new' } }) }) };
      },
      update: (row: { messages: Saved }) => {
        updates.push(row);
        return { eq: async () => ({ error: null }) };
      },
    })),
  };
  vi.mocked(createClient).mockReturnValue(client as never);
}

beforeAll(() => stubScrollIntoView());
beforeEach(mockDb);
afterEach(() => vi.unstubAllGlobals());

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

async function ask(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText('Ask a follow-up…'), `${text}{Enter}`);
}

describe('ExploreLibrary stamps messages with `at` for the digest', () => {
  it('stamps the visitor message and the finished reply, saves both, and sends only role and content to /api/chat', async () => {
    const before = Date.now();
    const { calls } = stubFetch((c) => (c.url === '/api/chat' ? streamResponse(['Hello ', 'there']) : undefined));
    render(
      <ExploreLibrary
        signedIn
        initialConversation={{
          id: 'conv-1',
          pathway_slug: null,
          pathway_title: null,
          // A conversation saved before `at` existed: no stamps, must keep working.
          messages: [{ role: 'user', content: 'older question' }, { role: 'assistant', content: 'older answer' }],
        }}
      />
    );
    await ask('What did it cost?');
    await waitFor(() => expect(updates).toHaveLength(1));

    const saved = updates[0].messages;
    expect(saved).toHaveLength(4);
    expect(saved[0]).not.toHaveProperty('at');
    expect(saved[1]).not.toHaveProperty('at');
    expect(saved[2]).toMatchObject({ role: 'user', content: 'What did it cost?', at: expect.stringMatching(ISO) });
    expect(saved[3]).toMatchObject({ role: 'assistant', content: 'Hello there', at: expect.stringMatching(ISO), id: expect.any(String) });
    expect(Date.parse(saved[2].at as string)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(saved[3].at as string)).toBeGreaterThanOrEqual(Date.parse(saved[2].at as string));

    const body = calls.find((c) => c.url === '/api/chat')!.body as { messages: Record<string, unknown>[]; mode: string };
    expect(body.mode).toBe('library');
    for (const m of body.messages) expect(Object.keys(m).sort()).toEqual(['content', 'role']);
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'What did it cost?' });
  });

  it('a rejected request leaves no stamped reply behind and saves nothing', async () => {
    stubFetch((c) => (c.url === '/api/chat' ? jsonResponse({ error: 'Too many requests. Please try again later.' }, 429) : undefined));
    render(
      <ExploreLibrary
        signedIn
        initialConversation={{ id: 'conv-1', pathway_slug: null, pathway_title: null, messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }] }}
      />
    );
    await ask('again');
    await screen.findByText('Too many requests. Please try again later.');
    expect(updates).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it('a reply that breaks off saves nothing, so no half-stamped message reaches the digest', async () => {
    const { brokenStreamResponse } = await import('../../helpers/pages-client-helpers');
    stubFetch((c) => (c.url === '/api/chat' ? brokenStreamResponse(['partial']) : undefined));
    render(
      <ExploreLibrary
        signedIn
        initialConversation={{ id: 'conv-1', pathway_slug: null, pathway_title: null, messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }] }}
      />
    );
    await ask('again');
    await screen.findByText(/partial/);
    expect(updates).toEqual([]);
  });

  it('a signed-out visitor is never saved, stamped or not', async () => {
    stubFetch((c) => (c.url === '/api/chat' ? streamResponse(['Hi']) : undefined));
    render(
      <ExploreLibrary
        initialConversation={{ id: 'x', pathway_slug: null, pathway_title: null, messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }] }}
      />
    );
    await ask('hello');
    await screen.findByText('Hi');
    expect(updates).toEqual([]);
    expect(inserts).toEqual([]);
  });
});
