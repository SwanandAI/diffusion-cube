// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deferred, jsonResponse, stubFetch } from '../../helpers/ui-fork-http';

vi.mock('@/lib/contributor-registration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/contributor-registration')>();
  return { ...actual, submitContributorRegistration: vi.fn() };
});

import { PATHWAY_ROLES, submitContributorRegistration } from '@/lib/contributor-registration';
import ContributorRegistrationGate from '@/components/ContributorRegistrationGate';

const ORGS = [{ id: 'o1', name: 'Digital Green', canonical_role: 'Funder', url: 'https://digitalgreen.org' }];

let fetchCalls: ReturnType<typeof stubFetch>['calls'];

beforeEach(() => {
  // jsdom has no layout; Select scrolls its active option into view.
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(submitContributorRegistration).mockResolvedValue({ ok: true });
  fetchCalls = stubFetch((call) => (call.url.startsWith('/api/organisations') ? jsonResponse(ORGS) : undefined)).calls;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderGate(over: Partial<Parameters<typeof ContributorRegistrationGate>[0]> = {}) {
  const onRegistered = vi.fn();
  render(
    <ContributorRegistrationGate
      userId="user-1"
      userName="Asha Rao"
      userEmail="asha@example.org"
      userOrganisation="Acme Agri"
      onRegistered={onRegistered}
      {...over}
    />
  );
  return { onRegistered, user: userEvent.setup() };
}

async function start(over: Partial<Parameters<typeof ContributorRegistrationGate>[0]> = {}) {
  const r = renderGate(over);
  await r.user.click(screen.getByRole('button', { name: 'Click here to register' }));
  return r;
}

describe('ContributorRegistrationGate', () => {
  it('starts on an intro screen and shows the form only after "Click here to register"', async () => {
    const { user } = renderGate();
    expect(screen.queryByRole('button', { name: 'Register' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Click here to register' }));
    expect(screen.getByRole('button', { name: 'Register' })).toBeInTheDocument();
  });

  it('prefills the organisation and defaults role and sharing level', async () => {
    await start();
    expect(screen.getByPlaceholderText('Start typing…')).toHaveValue('Acme Agri');
    expect(screen.getByRole('combobox')).toHaveTextContent(PATHWAY_ROLES[0]);
    expect(screen.getByRole('radio', { name: /Don't share my contact details/ })).toBeChecked();
  });

  it('keeps Register disabled until the terms are accepted', async () => {
    const { user } = await start();
    const register = screen.getByRole('button', { name: 'Register' });
    expect(register).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    expect(register).toBeEnabled();
    await user.click(screen.getByRole('checkbox'));
    expect(register).toBeDisabled();
  });

  it('links the Terms of Use in a new tab', async () => {
    await start();
    const links = screen.getAllByRole('link', { name: 'Terms of Use' });
    expect(links.length).toBe(2);
    for (const a of links) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a.getAttribute('href')).toMatch(/^\/terms/);
    }
  });

  it('submits every field and calls onRegistered', async () => {
    const { user, onRegistered } = await start();
    await user.type(screen.getByLabelText('Organisation website — optional'), 'https://acme.example');
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Funder' }));
    await user.type(screen.getByLabelText('Pathway description'), 'Voice advisory for farmers');
    await user.click(screen.getByRole('radio', { name: /Share my name and email/ }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => expect(onRegistered).toHaveBeenCalledTimes(1));
    expect(submitContributorRegistration).toHaveBeenCalledWith('user-1', {
      organisationName: 'Acme Agri',
      organisationUrl: 'https://acme.example',
      pathwayRole: 'Funder',
      pocName: 'Asha Rao',
      pocEmail: 'asha@example.org',
      pathwayDescription: 'Voice advisory for farmers',
      termsAccepted: true,
      sharingLevel: 'name_and_email',
    });
  });

  it('does not submit while the required description is empty', async () => {
    const { user, onRegistered } = await start();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Register' }));
    expect(submitContributorRegistration).not.toHaveBeenCalled();
    expect(onRegistered).not.toHaveBeenCalled();
  });

  it('picking a known organisation fills its canonical role and website', async () => {
    const { user } = await start({ userOrganisation: '' });
    await user.type(screen.getByPlaceholderText('Start typing…'), 'Digi');
    await user.click(await screen.findByRole('button', { name: /Digital Green/ }, { timeout: 2000 }));
    expect(screen.getByPlaceholderText('Start typing…')).toHaveValue('Digital Green');
    expect(screen.getByRole('combobox')).toHaveTextContent('Funder');
    expect(screen.getByLabelText('Organisation website — optional')).toHaveValue('https://digitalgreen.org');
    expect(fetchCalls.some((c) => c.url === '/api/organisations?q=Digi')).toBe(true);
  });

  it('shows Submitting… and disables Register while pending (no double submit)', async () => {
    const pending = deferred<{ ok: true } | { ok: false; error: string }>();
    vi.mocked(submitContributorRegistration).mockReturnValue(pending.promise);
    const { user, onRegistered } = await start();
    await user.type(screen.getByLabelText('Pathway description'), 'x');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Register' }));
    const busy = screen.getByRole('button', { name: 'Submitting…' });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(submitContributorRegistration).toHaveBeenCalledTimes(1);
    pending.resolve({ ok: true });
    await waitFor(() => expect(onRegistered).toHaveBeenCalled());
  });

  it('shows the error and re-enables Register on failure', async () => {
    vi.mocked(submitContributorRegistration).mockResolvedValue({ ok: false, error: 'You have already registered.' });
    const { user, onRegistered } = await start();
    await user.type(screen.getByLabelText('Pathway description'), 'x');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Register' }));
    expect(await screen.findByText('You have already registered.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register' })).toBeEnabled();
    expect(onRegistered).not.toHaveBeenCalled();
  });
});
