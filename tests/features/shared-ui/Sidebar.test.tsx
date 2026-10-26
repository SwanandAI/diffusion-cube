// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createSupabaseMock, type SupabaseMock, type TableHandler } from '../../helpers/supabase-mock';

const nav = { pathname: '/analyse' };
const router = { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() };
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => router }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { showToast } from '@/lib/toast';
import Sidebar from '@/components/Sidebar';

const ADOPTIONS = [
  { id: 'd1', meta: { name: 'Kisan Voice analysis', flow: 'explorer' }, updated_at: '2026-10-20T10:00:00Z' },
  { id: 'd2', meta: { name: 'My contribution', flow: 'contributor' }, updated_at: '2026-10-25T10:00:00Z' },
  { id: 'd3', meta: { flow: 'explorer' }, updated_at: '2026-10-10T10:00:00Z' },
  { id: 'd4', meta: null, updated_at: '2026-10-24T10:00:00Z' },
];
const LIBRARY = [
  { id: 'l1', pathway_title: 'Clinic Triage', updated_at: '2026-10-22T10:00:00Z' },
  { id: 'l2', pathway_title: null, updated_at: '2026-10-05T10:00:00Z' },
];

let sb: SupabaseMock;
function withTables(tables: Record<string, TableHandler> = { library_conversations: { data: LIBRARY } }) {
  sb = createSupabaseMock({ user: { id: 'u1', email: 'asha@ekstep.org' }, tables });
  vi.mocked(createClient).mockReturnValue(sb.client);
}

beforeEach(() => {
  nav.pathname = '/analyse';
  vi.mocked(showToast).mockClear();
  withTables();
});

function recentTitles() {
  const heading = screen.queryByText('Recent Explorations');
  if (!heading) return [];
  const list = heading.nextElementSibling as HTMLElement;
  return within(list).getAllByRole('link').map((a) => a.textContent);
}

describe('Sidebar', () => {
  it('always shows Explore, Analyse, Contribute; Admin only for admins', () => {
    const { unmount } = render(<Sidebar email="asha@ekstep.org" adoptions={[]} />);
    const navEl = screen.getByRole('navigation');
    expect(within(navEl).getAllByRole('link').map((l) => l.textContent)).toEqual(['Explore', 'Analyse', 'Contribute']);
    unmount();
    render(<Sidebar email="asha@ekstep.org" adoptions={[]} isAdmin />);
    expect(within(screen.getByRole('navigation')).getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  });

  it('highlights the active section, including sub-paths', () => {
    nav.pathname = '/contribute/abc';
    render(<Sidebar email={null} adoptions={[]} />);
    const navEl = screen.getByRole('navigation');
    expect(within(navEl).getByRole('link', { name: 'Contribute' }).className).toContain('bg-navy');
    expect(within(navEl).getByRole('link', { name: 'Explore' }).className).not.toContain('bg-navy');
  });

  it('anonymous visitors get Sign in, no account links, and no history fetch', () => {
    render(<Sidebar email={null} adoptions={[]} />);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('link', { name: 'Account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(sb.client.from).not.toHaveBeenCalled();
  });

  it('signed-in users see their email, Account and Sign out', () => {
    render(<Sidebar email="asha@ekstep.org" adoptions={[]} />);
    expect(screen.getByTitle('asha@ekstep.org')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('merges explorer sessions and library chats, newest first, excluding contributions', async () => {
    render(<Sidebar email="asha@ekstep.org" adoptions={ADOPTIONS} />);
    await waitFor(() => expect(recentTitles()).toContain('Clinic Triage'));
    expect(recentTitles()).toEqual(['Clinic Triage', 'Kisan Voice analysis', 'New exploration', 'General question']);
    expect(screen.getByRole('link', { name: 'Kisan Voice analysis' })).toHaveAttribute('href', '/analyse?open=d1');
    expect(screen.getByRole('link', { name: 'Clinic Triage' })).toHaveAttribute('href', '/explore?open=l1');
    expect(screen.queryByText('My contribution')).not.toBeInTheDocument();
    const [op] = sb.ops('library_conversations', 'select');
    expect(op.filters).toEqual([['order', 'updated_at', { ascending: false }]]);
  });

  it('shows no Recent Explorations section when there is nothing to list', async () => {
    withTables({ library_conversations: { data: [] } });
    render(<Sidebar email="asha@ekstep.org" adoptions={[ADOPTIONS[1]]} />);
    await waitFor(() => expect(sb.client.from).toHaveBeenCalled());
    expect(screen.queryByText('Recent Explorations')).not.toBeInTheDocument();
  });

  it('a failed history fetch leaves only the explorer sessions', async () => {
    withTables({ library_conversations: { error: { message: 'rls' } } });
    render(<Sidebar email="asha@ekstep.org" adoptions={ADOPTIONS} />);
    await waitFor(() => expect(sb.client.from).toHaveBeenCalled());
    expect(recentTitles()).toEqual(['Kisan Voice analysis', 'New exploration']);
  });

  it('deleting a recent item asks first; cancel keeps it', async () => {
    const user = userEvent.setup();
    render(<Sidebar email="asha@ekstep.org" adoptions={ADOPTIONS} />);
    await waitFor(() => expect(recentTitles()).toHaveLength(4));
    const row = screen.getByRole('link', { name: 'Kisan Voice analysis' }).parentElement as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Delete exploration' }));
    expect(screen.getByRole('dialog', { name: 'Delete this exploration?' })).toHaveTextContent('“Kisan Voice analysis”');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(sb.ops('designs')).toHaveLength(0);
    expect(recentTitles()).toContain('Kisan Voice analysis');
  });

  it('confirming deletes from the right table, hides the row and toasts', async () => {
    const user = userEvent.setup();
    render(<Sidebar email="asha@ekstep.org" adoptions={ADOPTIONS} />);
    await waitFor(() => expect(recentTitles()).toHaveLength(4));

    const strengthen = screen.getByRole('link', { name: 'Kisan Voice analysis' }).parentElement as HTMLElement;
    await user.click(within(strengthen).getByRole('button', { name: 'Delete exploration' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(recentTitles()).not.toContain('Kisan Voice analysis'));
    expect(sb.ops('designs', 'delete')[0].filters).toEqual([['eq', 'id', 'd1']]);
    expect(showToast).toHaveBeenCalledWith('Exploration deleted successfully.');

    const library = screen.getByRole('link', { name: 'Clinic Triage' }).parentElement as HTMLElement;
    await user.click(within(library).getByRole('button', { name: 'Delete exploration' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(recentTitles()).not.toContain('Clinic Triage'));
    expect(sb.ops('library_conversations', 'delete')[0].filters).toEqual([['eq', 'id', 'l1']]);
  });

  it('a failed delete shows an error toast and keeps the row', async () => {
    withTables({
      library_conversations: { data: LIBRARY },
      designs: (op) => (op.action === 'delete' ? { error: { message: 'denied' } } : {}),
    });
    const user = userEvent.setup();
    render(<Sidebar email="asha@ekstep.org" adoptions={ADOPTIONS} />);
    await waitFor(() => expect(recentTitles()).toHaveLength(4));
    const row = screen.getByRole('link', { name: 'Kisan Voice analysis' }).parentElement as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Delete exploration' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Could not delete that exploration. Please try again.', 'error')
    );
    expect(recentTitles()).toContain('Kisan Voice analysis');
  });

  it('mobile drawer opens from the menu button, closes on backdrop and on navigation', async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(<Sidebar email={null} adoptions={[]} />);
    const aside = container.querySelector('aside') as HTMLElement;
    expect(aside.className).toContain('-translate-x-full');
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(aside.className).toContain('translate-x-0');
    expect(aside.className).not.toContain('-translate-x-full');
    await user.click(container.querySelector('.fixed.inset-0') as HTMLElement);
    expect(aside.className).toContain('-translate-x-full');

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    nav.pathname = '/explore';
    rerender(<Sidebar email={null} adoptions={[]} />);
    expect(aside.className).toContain('-translate-x-full');
  });
});
