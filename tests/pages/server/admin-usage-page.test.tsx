// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { sessionMock } from '../../helpers/routes-auth';
import { createSupabaseMock } from '../../helpers/supabase-mock';
import { RedirectError } from '../../helpers/pages-server-mocks';

vi.mock('next/navigation', async () => (await import('../../helpers/pages-server-mocks')).navigationModule());
vi.mock('next/headers', async () => (await import('../../helpers/pages-server-mocks')).headersModule());
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/wiki-content', () => ({ listWikiPathways: vi.fn(async () => []) }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import AdminUsagePage from '@/app/admin/usage/page';

const usage = (aiUsage: Record<string, unknown>) => ({
  users: { total: 1, new_7d: 0, active_7d: 0, active_30d: 0 },
  conversations: {},
  ai_usage: aiUsage,
  errors_per_day: [],
  errors_per_source: [],
});

function data(aiUsage: Record<string, unknown> = {}, feedback: unknown = { per_surface: {}, recent_down: [] }) {
  vi.mocked(createAdminClient).mockReturnValue(
    createSupabaseMock({
      rpc: {
        admin_usage_stats: { data: usage(aiUsage) },
        admin_feedback_stats: { data: feedback },
      },
    }).client
  );
}

const row = (label: string) => screen.getByText(label).closest('tr')!;

beforeEach(() => {
  vi.mocked(createClient).mockResolvedValue(sessionMock({ id: 'me', email: 'someone@example.com' }, ['adopter', 'admin']).client);
  data();
});

describe('app/admin/usage/page.tsx — Feedback Digest additions', () => {
  it('links to the digest', async () => {
    render(await AdminUsagePage());
    expect(screen.getByRole('link', { name: 'Digest →' })).toHaveAttribute('href', '/admin/usage/digest');
  });

  it('links to the thumbs-down review', async () => {
    render(await AdminUsagePage());
    expect(screen.getByRole('link', { name: 'Review thumbs down →' })).toHaveAttribute('href', '/admin/usage/feedback');
  });

  it('shows digest AI calls in an "Admin (digest)" row', async () => {
    data({
      admin: { calls: 3, failed: 1, input_tokens: 1000, output_tokens: 200, cache_read_tokens: 0, cache_creation_tokens: 0 },
    });
    render(await AdminUsagePage());
    expect(row('Admin (digest)')).toHaveTextContent('Admin (digest)311,000200');
  });

  it('shows zeros when there have been no digest calls, and the other areas are unchanged', async () => {
    render(await AdminUsagePage());
    expect(row('Admin (digest)')).toHaveTextContent('Admin (digest)00000');
    expect(screen.getAllByText('Explore').length).toBeGreaterThan(0);
  });

  it('still redirects a non-admin', async () => {
    vi.mocked(createClient).mockResolvedValue(sessionMock({ id: 'me', email: 'someone@example.com' }, ['adopter']).client);
    await expect(AdminUsagePage()).rejects.toEqual(new RedirectError('/'));
  });
});

describe('app/admin/usage/page.tsx — Activity table: thumbs and the Overall / 7 / 30-day toggle', () => {
  const activityRow = (label: string) =>
    screen.getAllByText(label).map((el) => el.closest('tr')!).find((tr) => tr && tr.closest('table')!.textContent!.includes('Thumbs up'))!;

  const activity = () => {
    vi.mocked(createAdminClient).mockReturnValue(
      createSupabaseMock({
        rpc: {
          admin_usage_stats: {
            data: {
              ...usage({}),
              conversations: {
                explore: { total: 40, last_7d: 6, last_30d: 25 },
                analyse: { total: 12, last_7d: 2, last_30d: 5 },
              },
            },
          },
          admin_feedback_stats: {
            data: {
              per_surface: {
                explore: { up: 7, down: 3, up_7d: 1, down_7d: 2, up_30d: 4, down_30d: 3 },
                contribute: { up: 1200, down: 0, up_7d: 0, down_7d: 0, up_30d: 9, down_30d: 0 },
              },
              recent_down: [],
            },
          },
        },
      }).client
    );
  };

  it('defaults to Overall, and switches every column to the last 7 or 30 days without reloading', async () => {
    activity();
    render(await AdminUsagePage());
    expect(screen.getByRole('button', { name: 'Overall' })).toHaveAttribute('aria-pressed', 'true');
    expect(activityRow('Explore')).toHaveTextContent('Explore4073');

    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Overall' })).toHaveAttribute('aria-pressed', 'false');
    expect(activityRow('Explore')).toHaveTextContent('Explore612');
    expect(activityRow('Analyse')).toHaveTextContent('Analyse200');

    fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }));
    expect(activityRow('Explore')).toHaveTextContent('Explore2543');
    expect(activityRow('Contribute')).toHaveTextContent('Contribute090');

    fireEvent.click(screen.getByRole('button', { name: 'Overall' }));
    expect(activityRow('Contribute')).toHaveTextContent('Contribute01,2000');
  });

  it('shows zeros for 30 days when the database has not been migrated to 0045 yet (no *_30d keys)', async () => {
    render(await AdminUsagePage());
    fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }));
    expect(activityRow('Explore')).toHaveTextContent('Explore000');
  });

  it('adds Thumbs up and Thumbs down columns per area to the Activity table', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      createSupabaseMock({
        rpc: {
          admin_usage_stats: {
            data: { ...usage({}), conversations: { explore: { total: 40, last_7d: 6 }, analyse: { total: 12, last_7d: 2 } } },
          },
          admin_feedback_stats: {
            data: {
              per_surface: { explore: { up: 7, down: 3, up_7d: 1, down_7d: 1 }, contribute: { up: 1200, down: 0, up_7d: 0, down_7d: 0 } },
              recent_down: [{ surface: 'explore', pathway_slug: null, excerpt: 'a bad reply', at: '2026-11-17T05:00:00Z' }],
            },
          },
        },
      }).client
    );
    render(await AdminUsagePage());
    const head = screen.getByText('Thumbs up').closest('tr')!;
    expect(head).toHaveTextContent('AreaConversationsThumbs upThumbs down');
    expect(head).not.toHaveTextContent('Last 7 days');
    expect(activityRow('Explore')).toHaveTextContent('Explore4073');
    expect(activityRow('Analyse')).toHaveTextContent('Analyse1200');
    expect(activityRow('Contribute')).toHaveTextContent('Contribute01,2000');
  });

  it('has no separate Reply feedback section, totals or recent thumbs-down list', async () => {
    data({}, { per_surface: {}, recent_down: [{ surface: 'explore', pathway_slug: null, excerpt: 'a bad reply', at: '2026-11-17T05:00:00Z' }] });
    render(await AdminUsagePage());
    expect(screen.queryByRole('heading', { name: 'Reply feedback' })).not.toBeInTheDocument();
    expect(screen.queryByText('Recent thumbs down')).not.toBeInTheDocument();
    expect(screen.queryByText('Helpful (thumbs up)')).not.toBeInTheDocument();
    expect(screen.queryByText('a bad reply')).not.toBeInTheDocument();
    expect(screen.getAllByText('Thumbs up')).toHaveLength(1);
  });

  it('shows zeros when feedback stats come back empty', async () => {
    data({}, null);
    render(await AdminUsagePage());
    expect(activityRow('Explore')).toHaveTextContent('Explore000');
  });
});
