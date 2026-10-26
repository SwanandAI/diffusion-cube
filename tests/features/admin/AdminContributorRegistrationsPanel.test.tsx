// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deferred, jsonResponse, stubFetch } from '../../helpers/ui-fork-http';
import AdminContributorRegistrationsPanel, {
  type AdminContributorRegistrationRow,
} from '@/components/AdminContributorRegistrationsPanel';

function reg(i: number, over: Partial<AdminContributorRegistrationRow> = {}): AdminContributorRegistrationRow {
  return {
    id: `reg-${i}`,
    pocName: `Contributor ${i}`,
    pocEmail: `poc${i}@example.org`,
    organisationName: `Org ${i}`,
    pathwayRole: 'Implementer',
    pathwayDescription: `Voice advisory deployment ${i}`,
    accessStatus: 'pending',
    createdAt: '2026-10-01T10:00:00Z',
    ...over,
  };
}

function card(name: string) {
  return screen.getByText(name).closest('div.rounded-xl') as HTMLElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
});


describe('AdminContributorRegistrationsPanel', () => {
  it('shows the empty state with no registrations', () => {
    render(<AdminContributorRegistrationsPanel initialRows={[]} />);
    expect(screen.getByText('No contributor registrations yet.')).toBeInTheDocument();
  });

  it('renders details and status badges', () => {
    render(
      <AdminContributorRegistrationsPanel
        initialRows={[
          reg(1),
          reg(2, { accessStatus: 'approved' }),
          reg(3, { accessStatus: 'rejected', organisationName: '', pathwayDescription: '', pocName: '' }),
        ]}
      />
    );
    expect(within(card('Contributor 1')).getByText('Pending')).toBeInTheDocument();
    expect(within(card('Contributor 1')).getByText('poc1@example.org · Org 1 · Implementer')).toBeInTheDocument();
    expect(within(card('Contributor 1')).getByText('Voice advisory deployment 1')).toBeInTheDocument();
    expect(within(card('Contributor 2')).getByText('Approved')).toBeInTheDocument();
    const unnamed = card('Unnamed');
    expect(within(unnamed).getByText('Rejected')).toBeInTheDocument();
    expect(within(unnamed).getByText('poc3@example.org · No organisation · Implementer')).toBeInTheDocument();
  });

  it('pending rows offer Reject and Approve; rejected rows only Approve; approved rows neither', () => {
    render(
      <AdminContributorRegistrationsPanel
        initialRows={[reg(1), reg(2, { accessStatus: 'approved' }), reg(3, { accessStatus: 'rejected' })]}
      />
    );
    expect(within(card('Contributor 1')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Reject', 'Approve']);
    expect(within(card('Contributor 2')).queryAllByRole('button')).toHaveLength(0);
    expect(within(card('Contributor 3')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Approve']);
  });

  it('approving POSTs the registration id and flips the row to Approved', async () => {
    const { calls } = stubFetch(() => jsonResponse({ ok: true }));
    const user = userEvent.setup();
    render(<AdminContributorRegistrationsPanel initialRows={[reg(1)]} />);
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.getByText('Approved')).toBeInTheDocument());
    expect(calls).toEqual([
      { url: '/api/admin/contributor-registrations/approve', method: 'POST', body: { registration_id: 'reg-1' } },
    ]);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('rejecting flips the row to Rejected and keeps Approve available', async () => {
    const { calls } = stubFetch(() => jsonResponse({ ok: true }));
    const user = userEvent.setup();
    render(<AdminContributorRegistrationsPanel initialRows={[reg(1)]} />);
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(screen.getByText('Rejected')).toBeInTheDocument());
    expect(calls[0].url).toBe('/api/admin/contributor-registrations/reject');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Approve']);
  });

  it('shows the server error on failure and leaves status unchanged', async () => {
    stubFetch(() => jsonResponse({ error: 'Registration not found' }, 404));
    const user = userEvent.setup();
    render(<AdminContributorRegistrationsPanel initialRows={[reg(1)]} />);
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Registration not found')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('shows a connection error when the request cannot reach the server', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const user = userEvent.setup();
    render(<AdminContributorRegistrationsPanel initialRows={[reg(1)]} />);
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(
      await screen.findByText('Could not reject this registration. Check your connection and try again.')
    ).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
  });

  it('falls back to a generic error when the body is not JSON', async () => {
    stubFetch(() => new Response('<html>502</html>', { status: 502 }));
    const user = userEvent.setup();
    render(<AdminContributorRegistrationsPanel initialRows={[reg(1)]} />);
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('Could not reject this registration.')).toBeInTheDocument();
  });

  it('clears a previous error on the next attempt', async () => {
    let fail = true;
    stubFetch(() => (fail ? jsonResponse({ error: 'Boom' }, 500) : jsonResponse({ ok: true })));
    const user = userEvent.setup();
    render(<AdminContributorRegistrationsPanel initialRows={[reg(1)]} />);
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Boom')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.queryByText('Boom')).not.toBeInTheDocument());
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('disables both buttons of the row while a request is pending', async () => {
    const gate = deferred<Response>();
    const { fn } = stubFetch(() => gate.promise);
    const user = userEvent.setup();
    render(<AdminContributorRegistrationsPanel initialRows={[reg(1), reg(2)]} />);
    await user.click(within(card('Contributor 1')).getByRole('button', { name: 'Approve' }));
    const approving = within(card('Contributor 1')).getByRole('button', { name: 'Approving…' });
    expect(approving).toBeDisabled();
    expect(within(card('Contributor 1')).getByRole('button', { name: 'Reject' })).toBeDisabled();
    expect(within(card('Contributor 2')).getByRole('button', { name: 'Approve' })).toBeEnabled();
    await user.click(approving);
    expect(fn).toHaveBeenCalledTimes(1);
    gate.resolve(jsonResponse({ ok: true }));
    await waitFor(() => expect(within(card('Contributor 1')).getByText('Approved')).toBeInTheDocument());
  });

  // Regression: only the clicked action's button shows a busy label.
  it('while a Reject is in flight only Reject shows a busy label', async () => {
    const gate = deferred<Response>();
    stubFetch(() => gate.promise);
    const user = userEvent.setup();
    render(<AdminContributorRegistrationsPanel initialRows={[reg(1)]} />);
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.queryByRole('button', { name: 'Approving…' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rejecting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    gate.resolve(jsonResponse({ ok: true }));
  });

  it('paginates 10 per page', async () => {
    const rows = Array.from({ length: 11 }, (_, i) => reg(i + 1));
    const user = userEvent.setup();
    render(<AdminContributorRegistrationsPanel initialRows={rows} />);
    expect(screen.getByText('Showing 1–10 of 11')).toBeInTheDocument();
    expect(screen.queryByText('Contributor 11')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Contributor 11')).toBeInTheDocument();
  });

  it('exactly 10 registrations fit one page with no page controls', () => {
    render(<AdminContributorRegistrationsPanel initialRows={Array.from({ length: 10 }, (_, i) => reg(i + 1))} />);
    expect(screen.getByText('Showing 1–10 of 10')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  it('renders a very long description in full', () => {
    const long = 'Long description '.repeat(100).trim();
    render(<AdminContributorRegistrationsPanel initialRows={[reg(1, { pathwayDescription: long })]} />);
    expect(screen.getByText(long)).toBeInTheDocument();
  });
});
