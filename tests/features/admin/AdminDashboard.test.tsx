// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deferred, jsonResponse, stubFetch } from '../../helpers/ui-fork-http';

vi.mock('@/lib/toast', () => ({ showToast: vi.fn() }));

import { showToast } from '@/lib/toast';
import AdminDashboard, { type AdminUserRow } from '@/components/AdminDashboard';

function makeRow(i: number, over: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    id: `user-${i}`,
    email: `person${i}@example.org`,
    name: `Person ${i}`,
    organization: `Org ${i}`,
    roles: ['adopter'],
    ...over,
  };
}

const ROWS: AdminUserRow[] = [
  makeRow(1, { name: 'Asha Rao', email: 'asha@ekstep.org', organization: 'EkStep Foundation' }),
  makeRow(2, {
    name: 'Bilal Khan',
    email: 'bilal@agri.gov.in',
    organization: 'Maharashtra Agriculture Dept',
    roles: ['adopter', 'pathway_contributor'],
  }),
  makeRow(3, { name: 'Chen Li', email: 'chen@health.org', organization: 'Health NGO', roles: ['adopter', 'admin'] }),
];

function rowFor(text: string) {
  return screen.getByText(text).closest('tr') as HTMLElement;
}

function boxes(row: HTMLElement) {
  const [contributor, admin] = within(row).getAllByRole('checkbox');
  return { contributor, admin };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.mocked(showToast).mockClear();
});

describe('AdminDashboard', () => {
  it('shows only Name, Email, Organization, Pathway Contributor and Admin columns', () => {
    render(<AdminDashboard initialRows={ROWS} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Name', 'Email', 'Organization', 'Pathway Contributor', 'Admin']);
    expect(screen.queryByText(/General User/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Adopter/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
  });

  it('renders each row with two role checkboxes reflecting current roles', () => {
    render(<AdminDashboard initialRows={ROWS} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(ROWS.length * 2);
    const asha = boxes(rowFor('Asha Rao'));
    expect(asha.contributor).not.toBeChecked();
    expect(asha.admin).not.toBeChecked();
    const bilal = boxes(rowFor('Bilal Khan'));
    expect(bilal.contributor).toBeChecked();
    expect(bilal.admin).not.toBeChecked();
    const chen = boxes(rowFor('Chen Li'));
    expect(chen.admin).toBeChecked();
  });

  it('does not visually highlight any row as pending (no special row styling)', () => {
    render(<AdminDashboard initialRows={ROWS} />);
    for (const name of ['Asha Rao', 'Bilal Khan', 'Chen Li']) {
      expect(rowFor(name).className).toBe('border-b border-navy/5');
    }
  });

  it('shows a dash for a missing name or organization', () => {
    render(<AdminDashboard initialRows={[makeRow(9, { name: '', organization: '' })]} />);
    const row = rowFor('person9@example.org');
    expect(within(row).getAllByText('—')).toHaveLength(2);
  });

  it('shows the empty state for zero users and no table or search', () => {
    render(<AdminDashboard initialRows={[]} />);
    expect(screen.getByText('No users yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('granting a role POSTs action "add" and checks the box on success', async () => {
    const { calls } = stubFetch(() => jsonResponse({ ok: true }));
    const user = userEvent.setup();
    render(<AdminDashboard initialRows={ROWS} />);
    const { contributor } = boxes(rowFor('Asha Rao'));
    await user.click(contributor);
    await waitFor(() => expect(contributor).toBeChecked());
    expect(calls).toEqual([
      { url: '/api/admin/roles', method: 'POST', body: { user_id: 'user-1', role: 'pathway_contributor', action: 'add' } },
    ]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('revoking a role POSTs action "remove" and unchecks the box on success', async () => {
    const { calls } = stubFetch(() => jsonResponse({ ok: true }));
    const user = userEvent.setup();
    render(<AdminDashboard initialRows={ROWS} />);
    const { admin } = boxes(rowFor('Chen Li'));
    await user.click(admin);
    await waitFor(() => expect(admin).not.toBeChecked());
    expect(calls[0].body).toEqual({ user_id: 'user-3', role: 'admin', action: 'remove' });
  });

  it('sends JSON with a content-type header', async () => {
    const { fn } = stubFetch(() => jsonResponse({ ok: true }));
    const user = userEvent.setup();
    render(<AdminDashboard initialRows={ROWS} />);
    await user.click(boxes(rowFor('Asha Rao')).admin);
    await waitFor(() => expect(fn).toHaveBeenCalled());
    const init = fn.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('on API failure shows an error toast and leaves the checkbox unchanged', async () => {
    stubFetch(() => jsonResponse({ error: 'Forbidden' }, 403));
    const user = userEvent.setup();
    render(<AdminDashboard initialRows={ROWS} />);
    const { contributor } = boxes(rowFor('Bilal Khan'));
    expect(contributor).toBeChecked();
    await user.click(contributor);
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Could not update that role. Please try again.', 'error')
    );
    expect(contributor).toBeChecked();
    expect(contributor).toBeEnabled();
  });

  it('when the network is down shows an error toast and leaves the checkbox unchanged', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const user = userEvent.setup();
    render(<AdminDashboard initialRows={ROWS} />);
    const { contributor } = boxes(rowFor('Bilal Khan'));
    await user.click(contributor);
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Could not update that role. Check your connection and try again.', 'error')
    );
    expect(contributor).toBeChecked();
    expect(contributor).toBeEnabled();
  });

  it('on a 500 leaves an unchecked box unchecked', async () => {
    stubFetch(() => jsonResponse({}, 500));
    const user = userEvent.setup();
    render(<AdminDashboard initialRows={ROWS} />);
    const { admin } = boxes(rowFor('Asha Rao'));
    await user.click(admin);
    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    expect(admin).not.toBeChecked();
  });

  it('disables only the toggled checkbox while its request is pending, then re-enables it', async () => {
    const gate = deferred<Response>();
    const { fn } = stubFetch(() => gate.promise);
    const user = userEvent.setup();
    render(<AdminDashboard initialRows={ROWS} />);
    const { contributor, admin } = boxes(rowFor('Asha Rao'));
    await user.click(contributor);
    await waitFor(() => expect(contributor).toBeDisabled());
    expect(admin).toBeEnabled();
    expect(boxes(rowFor('Bilal Khan')).contributor).toBeEnabled();

    // A second click while pending does nothing (the input is disabled).
    await user.click(contributor);
    expect(fn).toHaveBeenCalledTimes(1);

    gate.resolve(jsonResponse({ ok: true }));
    await waitFor(() => expect(contributor).toBeEnabled());
    expect(contributor).toBeChecked();
  });

  it('only updates the targeted user', async () => {
    stubFetch(() => jsonResponse({ ok: true }));
    const user = userEvent.setup();
    render(<AdminDashboard initialRows={ROWS} />);
    await user.click(boxes(rowFor('Asha Rao')).admin);
    await waitFor(() => expect(boxes(rowFor('Asha Rao')).admin).toBeChecked());
    expect(boxes(rowFor('Bilal Khan')).admin).not.toBeChecked();
    expect(boxes(rowFor('Chen Li')).contributor).not.toBeChecked();
  });

  describe('search', () => {
    it('filters by name, case-insensitively', async () => {
      const user = userEvent.setup();
      render(<AdminDashboard initialRows={ROWS} />);
      await user.type(screen.getByRole('searchbox'), 'ASHA');
      expect(screen.getByText('Asha Rao')).toBeInTheDocument();
      expect(screen.queryByText('Bilal Khan')).not.toBeInTheDocument();
      expect(screen.queryByText('Chen Li')).not.toBeInTheDocument();
    });

    it('filters by email', async () => {
      const user = userEvent.setup();
      render(<AdminDashboard initialRows={ROWS} />);
      await user.type(screen.getByRole('searchbox'), 'agri.gov');
      expect(screen.getAllByRole('row')).toHaveLength(2); // header + 1
      expect(screen.getByText('Bilal Khan')).toBeInTheDocument();
    });

    it('filters by organization', async () => {
      const user = userEvent.setup();
      render(<AdminDashboard initialRows={ROWS} />);
      await user.type(screen.getByRole('searchbox'), 'health ngo');
      expect(screen.getByText('Chen Li')).toBeInTheDocument();
      expect(screen.queryByText('Asha Rao')).not.toBeInTheDocument();
    });

    it('ignores surrounding whitespace in the query', async () => {
      const user = userEvent.setup();
      render(<AdminDashboard initialRows={ROWS} />);
      await user.type(screen.getByRole('searchbox'), '   chen   ');
      expect(screen.getByText('Chen Li')).toBeInTheDocument();
      expect(screen.queryByText('Asha Rao')).not.toBeInTheDocument();
    });

    it('a whitespace-only query shows everyone', async () => {
      const user = userEvent.setup();
      render(<AdminDashboard initialRows={ROWS} />);
      await user.type(screen.getByRole('searchbox'), '   ');
      expect(screen.getAllByRole('row')).toHaveLength(ROWS.length + 1);
    });

    it('shows a no-match message with the query and hides the table', async () => {
      const user = userEvent.setup();
      render(<AdminDashboard initialRows={ROWS} />);
      await user.type(screen.getByRole('searchbox'), 'zzz-nobody');
      expect(screen.getByText('No users match “zzz-nobody”.')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
    });

    it('handles a very long query without matching', async () => {
      const user = userEvent.setup();
      render(<AdminDashboard initialRows={ROWS} />);
      const long = 'x'.repeat(300);
      await user.click(screen.getByRole('searchbox'));
      await user.paste(long);
      expect(screen.getByText(`No users match “${long}”.`)).toBeInTheDocument();
    });

    it('resets to page 1 when the query changes', async () => {
      const many = Array.from({ length: 45 }, (_, i) => makeRow(i + 1));
      const user = userEvent.setup();
      render(<AdminDashboard initialRows={many} />);
      await user.click(screen.getByRole('button', { name: '3' }));
      expect(screen.getByText('Showing 41–45 of 45')).toBeInTheDocument();
      await user.type(screen.getByRole('searchbox'), 'person');
      expect(screen.getByText('Showing 1–20 of 45')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-current', 'page');
    });

    it('a role toggle on a filtered view updates the right user', async () => {
      const { calls } = stubFetch(() => jsonResponse({ ok: true }));
      const user = userEvent.setup();
      render(<AdminDashboard initialRows={ROWS} />);
      await user.type(screen.getByRole('searchbox'), 'chen');
      await user.click(boxes(rowFor('Chen Li')).contributor);
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0].body).toEqual({ user_id: 'user-3', role: 'pathway_contributor', action: 'add' });
    });
  });

  describe('pagination', () => {
    it('shows 20 users per page', async () => {
      const many = Array.from({ length: 21 }, (_, i) => makeRow(i + 1));
      const user = userEvent.setup();
      render(<AdminDashboard initialRows={many} />);
      expect(screen.getAllByRole('row')).toHaveLength(21); // header + 20
      expect(screen.getByText('Showing 1–20 of 21')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Next' }));
      expect(screen.getAllByRole('row')).toHaveLength(2);
      expect(screen.getByText('Person 21')).toBeInTheDocument();
    });

    it('exactly one page of users shows no page controls', () => {
      const many = Array.from({ length: 20 }, (_, i) => makeRow(i + 1));
      render(<AdminDashboard initialRows={many} />);
      expect(screen.getByText('Showing 1–20 of 20')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    });
  });
});
