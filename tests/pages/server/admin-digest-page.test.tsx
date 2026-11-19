// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { sessionMock } from '../../helpers/routes-auth';
import { createSupabaseMock, type MockResponse, type SupabaseMock } from '../../helpers/supabase-mock';
import { RedirectError } from '../../helpers/pages-server-mocks';
import type { DigestPayload, DigestStats } from '@/lib/feedback-digest';

vi.mock('next/navigation', async () => (await import('../../helpers/pages-server-mocks')).navigationModule());
vi.mock('next/headers', async () => (await import('../../helpers/pages-server-mocks')).headersModule());
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
const anthropicCtor = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/sdk', () => ({ default: anthropicCtor }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import AdminDigestPage from '@/app/admin/usage/digest/page';

const STATS: DigestStats = {
  users_period: 4,
  conversations_period: 9,
  pathways: [
    { slug: 'mahavistaar', title: 'MahaVISTAAR', conversations: 5 },
    { slug: 'kisan', title: 'Kisan Sathi', conversations: 3 },
  ],
  live_keys: ['d:a', 'l:b', 'd:c', 'f:v1'],
  new_since: 0,
};

const PAYLOAD: DigestPayload = {
  version: 1,
  period_days: 7,
  basis: {
    messages_used: 4,
    messages_total: 4,
    feedback_used: 1,
    keys: [
      { k: 'd:a', p: 'U1' },
      { k: 'l:b', p: 'U2' },
      { k: 'd:c', p: 'U3' },
      { k: 'f:v1', p: 'U2' },
    ],
  },
  summary: [{ text: 'WhatsApp advisory came up most.', refs: [{ section: 'topics', index: 0 }] }],
  topics: [
    {
      title: 'WhatsApp advisory',
      summary: 'How farmers get advice on WhatsApp.',
      areas: ['explore', 'analyse'],
      pathways: ['mahavistaar', 'other-slug'],
      keys: [
        { k: 'd:a', p: 'U1' },
        { k: 'l:b', p: 'U2' },
      ],
    },
    { title: 'Costs', summary: 'What it cost.', areas: ['contribute'], pathways: [], keys: [{ k: 'd:c', p: 'U3' }] },
  ],
  unanswered: [
    {
      question: 'Advisory in tribal languages',
      sources: ['not_covered', 'not_helpful'],
      areas: ['analyse'],
      dates: ['2026-11-16', '2026-11-17'],
      keys: [
        { k: 'd:a', p: 'U1' },
        { k: 'f:v1', p: 'U2' },
      ],
    },
  ],
  terms: [],
};

let admin: SupabaseMock;
let statsArgs: unknown[];

function data(opts: {
  saved?: MockResponse;
  stats?: Partial<DigestStats> | null;
  statsError?: boolean;
} = {}) {
  statsArgs = [];
  admin = createSupabaseMock({
    tables: {
      feedback_digests: opts.saved ?? { data: { payload: PAYLOAD, generated_at: '2026-11-18T05:00:00Z' } },
      pathways: { data: [{ slug: 'other-slug', title: 'Other Pathway' }] },
    },
    rpc: {
      admin_digest_stats: (args) => {
        statsArgs.push(args);
        return opts.statsError ? { error: { message: 'boom' } } : { data: { ...STATS, ...(opts.stats ?? {}) } };
      },
    },
  });
  vi.mocked(createAdminClient).mockReturnValue(admin.client);
}

function as(user: { id: string; email?: string } | null, roles: string[]) {
  vi.mocked(createClient).mockResolvedValue(sessionMock(user, roles).client);
}

const page = (days?: string) => AdminDigestPage({ searchParams: Promise.resolve(days ? { days } : {}) });

beforeEach(() => {
  as({ id: 'me', email: 'someone@example.com' }, ['adopter', 'admin']);
  data();
});

describe('app/admin/usage/digest/page.tsx — access', () => {
  it('redirects a signed-in non-admin to / without reading anything', async () => {
    as({ id: 'me', email: 'someone@example.com' }, ['adopter', 'pathway_contributor']);
    await expect(page()).rejects.toEqual(new RedirectError('/'));
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('redirects an anonymous visitor to /', async () => {
    as(null, []);
    await expect(page()).rejects.toThrow('REDIRECT:/');
  });
});

describe('app/admin/usage/digest/page.tsx — content', () => {
  it('shows the pathways tile, the banner and the sections in order, without any Claude call', async () => {
    render(await page());
    expect(screen.getByRole('heading', { level: 1, name: 'Digest' })).toBeInTheDocument();
    const tile = screen.getByText('Most discussed pathways, till date').parentElement!;
    expect(tile).toHaveTextContent('MahaVISTAAR5 conv.');
    expect(tile).toHaveTextContent('Kisan Sathi3 conv.');

    // Live stats, never the saved digest's own counts (3 users, 3 conversations).
    expect(screen.getByText(/In the last 7 days: 9 conversations from 4 users, counted as on the Usage page\./)).toBeInTheDocument();
    expect(screen.queryByText(/Too few users/)).not.toBeInTheDocument();

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Summary', 'Most discussed topics', 'Unanswered questions']);

    expect(screen.getByText('WhatsApp advisory came up most.').parentElement).toHaveTextContent('(2 users)');
    const topic = screen.getByText('WhatsApp advisory').closest('li')!;
    expect(within(topic).getByText('Explore')).toBeInTheDocument();
    expect(within(topic).getByText('MahaVISTAAR')).toBeInTheDocument();
    expect(within(topic).getByText('Other Pathway')).toBeInTheDocument(); // looked up, not in the top-pathways list
    expect(topic).toHaveTextContent('2 conversations · 2 users');

    const question = screen.getByText('Advisory in tribal languages').closest('li')!;
    expect(within(question).getByText('Cube said not covered')).toBeInTheDocument();
    expect(within(question).getByText('Marked not helpful')).toBeInTheDocument();
    expect(question).toHaveTextContent('Asked 16 Nov, 17 Nov · 2 users');

    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();

    expect(anthropicCtor).not.toHaveBeenCalled();
    expect(statsArgs).toEqual([{ p_days: 7, p_since: '2026-11-18T05:00:00Z' }]);
  });

  it('shows the banner, then the Summary, then the most discussed pathways, then the topics', async () => {
    render(await page());
    const banner = screen.getByText(/In the last 7 days:/);
    const summary = screen.getByRole('heading', { name: 'Summary' });
    const pathways = screen.getByText('Most discussed pathways, till date');
    const topics = screen.getByRole('heading', { name: 'Most discussed topics' });
    const before = (x: Node, y: Node) => !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(banner, summary)).toBe(true);
    expect(before(summary, pathways)).toBe(true);
    expect(before(pathways, topics)).toBe(true);
  });

  it('reads the 30-day digest for ?days=30 and marks that period', async () => {
    render(await page('30'));
    expect(statsArgs[0]).toMatchObject({ p_days: 30 });
    expect(admin.ops('feedback_digests', 'select')[0].filters).toContainEqual(['eq', 'period_days', 30]);
    expect(screen.getByRole('link', { name: 'Last 30 days' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Last 7 days' })).toHaveAttribute('href', '/admin/usage/digest');
  });

  it('treats an unknown period as 7 days', async () => {
    await page('99');
    expect(statsArgs[0]).toMatchObject({ p_days: 7 });
  });
});

describe('app/admin/usage/digest/page.tsx — edge cases', () => {
  it('without a saved digest shows "No digest yet", the numbers and a Generate button', async () => {
    data({ saved: { data: null } });
    render(await page());
    expect(screen.getByText('No digest for the last 7 days yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate digest' })).toBeInTheDocument();
    expect(screen.getByText(/In the last 7 days: 9 conversations from 4 users/)).toBeInTheDocument();
    expect(statsArgs[0]).toMatchObject({ p_since: null });
  });

  it('says so for an empty digest', async () => {
    const empty = { ...PAYLOAD, basis: { messages_used: 0, messages_total: 0, feedback_used: 0, keys: [] }, summary: [], topics: [], unanswered: [] };
    data({ saved: { data: { payload: empty, generated_at: '2026-11-18T05:00:00Z' } }, stats: { users_period: 0, conversations_period: 0 } });
    render(await page());
    expect(screen.getByText('No conversations in the last 7 days.')).toBeInTheDocument();
    expect(screen.getByText(/Too few users to see patterns\./)).toBeInTheDocument();
  });

  it('hints at new conversations since the digest', async () => {
    data({ stats: { new_since: 8 } });
    render(await page());
    expect(screen.getByText(/8 new conversations since this digest was generated\./)).toBeInTheDocument();
  });

  it('hides what rested only on a deleted conversation and recounts users', async () => {
    data({ stats: { live_keys: ['d:a', 'l:b', 'f:v1'] } }); // d:c deleted
    render(await page());
    expect(screen.queryByText('Costs')).not.toBeInTheDocument();
    expect(screen.getByText('WhatsApp advisory')).toBeInTheDocument();
  });

  it('shows a placeholder when no pathways have been discussed', async () => {
    data({ stats: { pathways: [] } });
    render(await page());
    expect(screen.getByText('No pathways discussed yet.')).toBeInTheDocument();
  });

  it('does not repeat the Usage page\'s user, conversation or 👍/👎 tiles, and shows no cost', async () => {
    render(await page());
    expect(screen.queryByText('Users')).not.toBeInTheDocument();
    expect(screen.queryByText('Conversations')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Feedback, last/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Thumbs up')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Cost' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\$\d|tokens/);
    expect(screen.getByRole('link', { name: 'Usage' })).toHaveAttribute('href', '/admin/usage');
    expect(admin.ops('feedback_digest_runs', 'select')).toHaveLength(0);
  });

  it('hides a section with no items', async () => {
    render(await page());
    expect(screen.queryByRole('heading', { name: 'Terms people asked about' })).not.toBeInTheDocument();
  });
});

describe('app/admin/usage/digest/page.tsx — failures', () => {
  it('throws (generic error page) when the stats function fails', async () => {
    data({ statsError: true });
    await expect(page()).rejects.toMatchObject({ message: 'boom' });
  });
});

// ---------------------------------------------------------------------------
// Gap-filling cases (QA pass)
// ---------------------------------------------------------------------------

describe('app/admin/usage/digest/page.tsx — more access and period cases', () => {
  it('lets an ADMIN_EMAILS-only admin in', async () => {
    as({ id: 'env', email: 'env-admin@example.com' }, ['adopter']);
    render(await page());
    expect(screen.getByRole('heading', { level: 1, name: 'Digest' })).toBeInTheDocument();
  });

  it.each([[''], ['0'], ['7'], ['30.0'], ['-30'], ['abc']])('?days=%s is treated as a period the page knows', async (days) => {
    await page(days);
    expect([7, 30]).toContain((statsArgs[0] as { p_days: number }).p_days);
    if (days !== '30') expect(statsArgs[0]).toMatchObject({ p_days: 7 });
  });

  it('a repeated ?days=30&days=30 (an array at runtime) falls back to 7 instead of throwing', async () => {
    await AdminDigestPage({ searchParams: Promise.resolve({ days: ['30', '30'] as unknown as string }) });
    expect(statsArgs[0]).toMatchObject({ p_days: 7 });
  });
});

describe('app/admin/usage/digest/page.tsx — more failures', () => {
  it('throws when reading the saved digest fails', async () => {
    data({ saved: { error: { message: 'digest read failed' } } });
    await expect(page()).rejects.toMatchObject({ message: 'digest read failed' });
  });

});

describe('app/admin/usage/digest/page.tsx — hostile or damaged stored data', () => {
  it.each([[null], ['text'], [[]], [{ topics: 'x', summary: 5, basis: [] }], [{ version: 99 }]])(
    'a damaged saved payload (%j) renders the page with no sections instead of crashing',
    async (payload) => {
      data({ saved: { data: { payload, generated_at: '2026-11-18T05:00:00Z' } } });
      render(await page());
      expect(screen.getByRole('heading', { level: 1, name: 'Digest' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Most discussed topics' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
    }
  );

  it('markup in a stored title or summary is shown as text, never as HTML', async () => {
    const evil: DigestPayload = {
      ...PAYLOAD,
      topics: [{ title: '<img src=x onerror=alert(1)>', summary: '<script>alert(1)</script>', areas: [], pathways: [], keys: [{ k: 'd:a', p: 'U1' }] }],
      unanswered: [],
      summary: [],
    };
    data({ saved: { data: { payload: evil, generated_at: '2026-11-18T05:00:00Z' } } });
    const { container } = render(await page());
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });

  it('missing live_keys hides every item rather than showing deleted conversations', async () => {
    data({ stats: { live_keys: undefined } });
    render(await page());
    expect(screen.queryByRole('heading', { name: 'Most discussed topics' })).not.toBeInTheDocument();
    expect(screen.queryByText('WhatsApp advisory')).not.toBeInTheDocument();
    expect(screen.getByText(/In the last 7 days: 9 conversations from 4 users/)).toBeInTheDocument();
  });

  it('a pathway slug that is no longer published is shown by slug, and the title lookup asks for published pathways only', async () => {
    data({ stats: { pathways: [] } });
    render(await page());
    const lookup = admin.ops('pathways', 'select')[0];
    expect(lookup.filters).toContainEqual(['eq', 'status', 'published']);
    expect(lookup.filters).toContainEqual(['in', 'slug', ['mahavistaar', 'other-slug']]);
  });
});

describe('app/admin/usage/digest/page.tsx — numbers', () => {
  it('shows only the top five pathways', async () => {
    const pathways = Array.from({ length: 8 }, (_, i) => ({ slug: `p${i}`, title: `Pathway ${i}`, conversations: 20 - i }));
    data({ stats: { pathways } });
    render(await page());
    const tile = screen.getByText('Most discussed pathways, till date').parentElement!;
    expect(tile).toHaveTextContent('Pathway 4');
    expect(tile).not.toHaveTextContent('Pathway 5');
  });

  it('uses singular words for one user and one conversation, and groups thousands', async () => {
    const one = { ...PAYLOAD, basis: { ...PAYLOAD.basis, keys: [{ k: 'd:a', p: 'U1' }] }, topics: [], unanswered: [], summary: [] };
    data({
      saved: { data: { payload: one, generated_at: '2026-11-18T05:00:00Z' } },
      stats: { users_period: 1, conversations_period: 1, pathways: [{ slug: 'mahavistaar', title: 'MahaVISTAAR', conversations: 12345 }] },
    });
    render(await page());
    expect(screen.getByText(/In the last 7 days: 1 conversation from 1 user,/)).toBeInTheDocument();
    expect(screen.getByText('Most discussed pathways, till date').parentElement).toHaveTextContent('12,345 conv.');
  });

  it('says only the newest questions were read when the input was capped', async () => {
    const capped = { ...PAYLOAD, basis: { ...PAYLOAD.basis, messages_used: 400, messages_total: 1500 } };
    data({ saved: { data: { payload: capped, generated_at: '2026-11-18T05:00:00Z' } } });
    render(await page());
    expect(screen.getByText(/Only the most recent 400 of 1,500 questions were read\./)).toBeInTheDocument();
  });

  it('shows the generated time in India time', async () => {
    render(await page());
    expect(screen.getByText(/Generated on 18 Nov 2026, 10:30 am IST/i)).toBeInTheDocument(); // 05:00Z = 10:30 IST
  });

  it('the 30-day view with no saved digest shows its own empty message and leaves the toggle on 30', async () => {
    data({ saved: { data: null } });
    render(await page('30'));
    expect(screen.getByText('No digest for the last 30 days yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Last 30 days' })).toHaveAttribute('aria-current', 'page');
  });
});
