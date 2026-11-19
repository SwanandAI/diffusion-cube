// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { sessionMock } from '../../helpers/routes-auth';
import { createSupabaseMock, type MockResponse, type SupabaseMock } from '../../helpers/supabase-mock';
import { RedirectError } from '../../helpers/pages-server-mocks';

vi.mock('next/navigation', async () => (await import('../../helpers/pages-server-mocks')).navigationModule());
vi.mock('next/headers', async () => (await import('../../helpers/pages-server-mocks')).headersModule());
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import AdminFeedbackPage from '@/app/admin/usage/feedback/page';

const vote = (o: Record<string, unknown>) => ({
  id: `v-${o.message_id}`,
  surface: 'analyse',
  pathway_slug: null,
  conversation_id: null,
  message_excerpt: 'A reply',
  updated_at: '2026-11-18T05:00:00Z',
  ...o,
});

const VOTES = [
  vote({ message_id: 'r1', surface: 'analyse', conversation_id: 'd-1', message_excerpt: 'It built a WhatsApp advisory…' }),
  vote({ message_id: 'r2', surface: 'explore', conversation_id: 'l-1', pathway_slug: 'mahavistaar', message_excerpt: 'Explore reply' }),
  vote({ message_id: 'r3', surface: 'explore', conversation_id: null, message_excerpt: 'Anon reply' }),
  vote({ message_id: 'r4', surface: 'contribute', conversation_id: 'd-gone', message_excerpt: 'Deleted reply' }),
];

let admin: SupabaseMock;

function data(opts: { votes?: MockResponse; designs?: MockResponse } = {}) {
  admin = createSupabaseMock({
    tables: {
      message_feedback: opts.votes ?? { data: VOTES },
      designs: opts.designs ?? {
        data: [
          {
            id: 'd-1',
            messages: [
              { role: 'user', content: 'EARLIER PRIVATE QUESTION' },
              { role: 'assistant', content: 'earlier answer', id: 'r0' },
              { role: 'user', content: 'What did MahaVISTAAR do?' },
              { role: 'assistant', content: 'It built…', id: 'r1' },
              { role: 'user', content: 'LATER PRIVATE QUESTION' },
            ],
          },
        ],
      },
      library_conversations: {
        data: [{ id: 'l-1', messages: [{ role: 'user', content: 'How does it work offline?' }, { role: 'assistant', content: 'x', id: 'r2' }] }],
      },
      pathways: { data: [{ slug: 'mahavistaar', title: 'MahaVISTAAR' }] },
    },
  });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

const as = (user: { id: string; email?: string } | null, roles: string[]) =>
  vi.mocked(createClient).mockResolvedValue(sessionMock(user, roles).client);
const page = (days?: string, pageNo?: string) =>
  AdminFeedbackPage({ searchParams: Promise.resolve({ ...(days ? { days } : {}), ...(pageNo ? { page: pageNo } : {}) }) });
const card = (text: string) => screen.getByText(text).closest('li')!;

beforeEach(() => {
  as({ id: 'me', email: 'someone@example.com' }, ['adopter', 'admin']);
  data();
});

describe('app/admin/usage/feedback/page.tsx — access', () => {
  it('redirects a non-admin to / without reading anything', async () => {
    as({ id: 'me', email: 'someone@example.com' }, ['adopter']);
    await expect(page()).rejects.toEqual(new RedirectError('/'));
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('redirects an anonymous visitor', async () => {
    as(null, []);
    await expect(page()).rejects.toThrow('REDIRECT:/');
  });
});

describe('app/admin/usage/feedback/page.tsx — content', () => {
  it('reads only 👎 votes, newest first, one page of 20 with an exact count', async () => {
    render(await page());
    const q = admin.ops('message_feedback', 'select')[0];
    expect(q.filters).toContainEqual(['eq', 'vote', -1]);
    expect(q.filters).toContainEqual(['order', 'updated_at', { ascending: false }]);
    expect(q.filters).toContainEqual(['range', 0, 19]);
    expect(q.options).toEqual({ count: 'exact' });
    expect(q.filters.some((f) => f[0] === 'gte')).toBe(false); // Overall
    expect(screen.getByRole('link', { name: 'Overall' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows the question just before each rated reply, and nothing else from the conversation', async () => {
    const { container } = render(await page());
    const a = card('It built a WhatsApp advisory…');
    expect(within(a).getByText('What did MahaVISTAAR do?')).toBeInTheDocument();
    expect(a).toHaveTextContent('Analyse');
    expect(container).not.toHaveTextContent('EARLIER PRIVATE QUESTION');
    expect(container).not.toHaveTextContent('LATER PRIVATE QUESTION');

    const e = card('Explore reply');
    expect(within(e).getByText('How does it work offline?')).toBeInTheDocument();
    expect(e).toHaveTextContent('Explore · MahaVISTAAR');
  });

  it('reads each conversation from the right store, by id', async () => {
    render(await page());
    expect(admin.ops('designs', 'select')[0].filters).toContainEqual(['in', 'id', ['d-1', 'd-gone']]);
    expect(admin.ops('library_conversations', 'select')[0].filters).toContainEqual(['in', 'id', ['l-1']]);
  });

  it('explains a signed-out vote and a deleted conversation instead of a question', async () => {
    render(await page());
    expect(card('Anon reply')).toHaveTextContent('Signed-out visitor');
    expect(card('Deleted reply')).toHaveTextContent('has since been deleted');
  });

  it('never names a voter', async () => {
    const { container } = render(await page());
    expect(admin.ops('message_feedback', 'select')[0].columns).not.toMatch(/user_id|voter_key/);
    expect(container).not.toHaveTextContent('someone@example.com');
  });

  it('filters to the last 7 or 30 days', async () => {
    render(await page('7'));
    const gte = admin.ops('message_feedback', 'select')[0].filters.find((f) => f[0] === 'gte')!;
    expect(gte[1]).toBe('updated_at');
    const ageDays = (Date.now() - new Date(gte[2] as string).getTime()) / 86_400_000;
    expect(ageDays).toBeGreaterThan(6.99);
    expect(ageDays).toBeLessThan(7.01);
    expect(screen.getByRole('link', { name: 'Last 7 days' })).toHaveAttribute('aria-current', 'page');
  });

  it('treats an unknown period as Overall', async () => {
    await page('99');
    expect(admin.ops('message_feedback', 'select')[0].filters.some((f) => f[0] === 'gte')).toBe(false);
  });

  it('says so when there are no thumbs down, without reading any conversation', async () => {
    data({ votes: { data: [] } });
    render(await page('30'));
    expect(screen.getByText('No thumbs down in the last 30 days.')).toBeInTheDocument();
    expect(admin.ops('designs', 'select')).toHaveLength(0);
    expect(admin.ops('library_conversations', 'select')).toHaveLength(0);
  });

  it('throws (generic error page) when reading votes or conversations fails', async () => {
    data({ votes: { error: { message: 'votes failed' } } });
    await expect(page()).rejects.toMatchObject({ message: 'votes failed' });
    data({ designs: { error: { message: 'designs failed' } } });
    await expect(page()).rejects.toMatchObject({ message: 'designs failed' });
  });
});

describe('app/admin/usage/feedback/page.tsx — pagination', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => vote({ message_id: `m${i}`, message_excerpt: `Reply ${i}` }));

  it('shows no pager when everything fits on one page', async () => {
    render(await page());
    expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument();
    expect(screen.getByText('4 thumbs down.')).toBeInTheDocument();
  });

  it('on page 1 of 3 offers only "Older", keeping the period in the link', async () => {
    data({ votes: { data: many(20), count: 57 } });
    render(await page('30'));
    const nav = screen.getByRole('navigation', { name: 'Pages' });
    expect(nav).toHaveTextContent('Page 1 of 3');
    expect(within(nav).queryByRole('link', { name: '← Newer' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Older →' })).toHaveAttribute('href', '/admin/usage/feedback?days=30&page=2');
    expect(screen.getByText('57 thumbs down in the last 30 days · showing 1–20.')).toBeInTheDocument();
  });

  it('reads the right slice for page 3 and links back to page 2', async () => {
    data({ votes: { data: many(17), count: 57 } });
    render(await page(undefined, '3'));
    expect(admin.ops('message_feedback', 'select')[0].filters).toContainEqual(['range', 40, 59]);
    const nav = screen.getByRole('navigation', { name: 'Pages' });
    expect(nav).toHaveTextContent('Page 3 of 3');
    expect(within(nav).getByRole('link', { name: '← Newer' })).toHaveAttribute('href', '/admin/usage/feedback?page=2');
    expect(within(nav).queryByRole('link', { name: 'Older →' })).not.toBeInTheDocument();
    expect(screen.getByText(/showing 41–57\./)).toBeInTheDocument();
  });

  it('switching the period goes back to page 1', async () => {
    data({ votes: { data: many(20), count: 57 } });
    render(await page('7', '2'));
    expect(screen.getByRole('link', { name: 'Last 30 days' })).toHaveAttribute('href', '/admin/usage/feedback?days=30');
    expect(screen.getByRole('link', { name: 'Overall' })).toHaveAttribute('href', '/admin/usage/feedback');
  });

  it('a page past the end redirects to page 1 of the same period', async () => {
    data({ votes: { error: { message: 'Requested range not satisfiable', code: 'PGRST103' } } });
    await expect(page('7', '9')).rejects.toEqual(new RedirectError('/admin/usage/feedback?days=7'));
    data({ votes: { data: [], count: 3 } });
    await expect(page(undefined, '2')).rejects.toEqual(new RedirectError('/admin/usage/feedback'));
  });

  it.each([['0'], ['-1'], ['abc'], ['1.5'], ['9999999']])('?page=%s is treated as page 1', async (p) => {
    await page(undefined, p);
    expect(admin.ops('message_feedback', 'select')[0].filters).toContainEqual(['range', 0, 19]);
  });

  it('reads only the conversations of the votes on this page', async () => {
    data({ votes: { data: [vote({ message_id: 'r1', conversation_id: 'd-1' })], count: 41 } });
    render(await page(undefined, '3'));
    expect(admin.ops('designs', 'select')[0].filters).toContainEqual(['in', 'id', ['d-1']]);
  });
});
