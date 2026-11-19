import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { sessionMock } from '../../helpers/routes-auth';

vi.mock('next/navigation', async () => (await import('../../helpers/pages-server-mocks')).navigationModule());
vi.mock('next/headers', async () => (await import('../../helpers/pages-server-mocks')).headersModule());
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/pathway-store', () => ({ listPublished: vi.fn(async () => []) }));
vi.mock('@/components/AppShell', () => ({ default: () => null }));
vi.mock('@/app/explore/ExploreLibrary', () => ({ default: () => null }));

import { createClient } from '@/lib/supabase/server';
import PublicExplorePage from '@/app/explore/page';

const CONVERSATIONS: Record<string, { id: string; pathway_slug: string | null; pathway_title: string | null; messages: unknown[] }> = {
  a: { id: 'a', pathway_slug: null, pathway_title: null, messages: [{ role: 'user', content: 'first chat' }] },
  b: { id: 'b', pathway_slug: null, pathway_title: null, messages: [{ role: 'user', content: 'second chat' }] },
};

beforeEach(() => {
  vi.mocked(createClient).mockResolvedValue(
    sessionMock({ id: 'me', email: 'someone@example.com' }, ['adopter'], {
      designs: { data: [] },
      library_conversations: (op) => {
        const id = op.filters.find((f) => f[0] === 'eq' && f[1] === 'id')?.[2] as string | undefined;
        return { data: (id && CONVERSATIONS[id]) || null };
      },
    }).client
  );
});

// The ExploreLibrary element inside AppShell.
const library = async (open?: string) => {
  const shell = (await PublicExplorePage({ searchParams: Promise.resolve(open ? { open } : {}) })) as ReactElement<{
    children: ReactElement<{ initialConversation: unknown }>;
  }>;
  return shell.props.children;
};

describe('app/explore/page.tsx — reopening a saved conversation from the sidebar', () => {
  it('keys ExploreLibrary by the opened conversation, so a sidebar link switches chats without a reload', async () => {
    const a = await library('a');
    const b = await library('b');
    expect(a.props.initialConversation).toMatchObject({ id: 'a' });
    expect(b.props.initialConversation).toMatchObject({ id: 'b' });
    expect(a.key).toBe('a');
    expect(b.key).toBe('b');
  });

  it('uses a different key for /explore with no ?open=, so it goes back to the library', async () => {
    const none = await library();
    expect(none.props.initialConversation).toBeNull();
    expect(none.key).toBe('new');
    expect((await library('a')).key).not.toBe(none.key);
  });

  it('an unknown or someone else’s id (RLS returns nothing) falls back to the library', async () => {
    const missing = await library('not-mine');
    expect(missing.props.initialConversation).toBeNull();
    expect(missing.key).toBe('new');
  });
});
