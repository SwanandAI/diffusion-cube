// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deferred, jsonResponse, stubFetch, type FetchCall } from '../../helpers/ui-fork-http';
import { stubScrollIntoView } from '../../helpers/ui-dom';
import PathwaySelector from '@/components/PathwaySelector';

beforeAll(stubScrollIntoView);

const PATHWAYS = [
  {
    id: 'pw-1',
    slug: 'kisan-voice',
    title: 'Kisan Voice',
    sector: 'Agriculture',
    description: 'Voice advisory for farmers',
    created_at: '2026-09-01T00:00:00Z',
    isContributor: false,
    isPublished: true,
  },
  {
    id: 'pw-2',
    slug: 'clinic-triage',
    title: 'Clinic Triage',
    sector: null,
    description: null,
    created_at: '2026-09-02T00:00:00Z',
    isContributor: true,
    isPublished: true,
  },
];

// Someone else's unpublished pathway — only their private draft exists, so
// there's nothing to join.
const DRAFT = {
  id: 'pw-3',
  slug: 'a4kiosk',
  title: 'A4kiosk',
  sector: 'Education',
  description: 'Kiosk printing for students',
  created_at: '2026-09-03T00:00:00Z',
  isContributor: false,
  isPublished: false,
};

type Handler = (call: FetchCall) => Response | Promise<Response> | undefined;

function setup(routes: Record<string, Handler> = {}, list: unknown = PATHWAYS) {
  const http = stubFetch((call) => {
    const key = `${call.method} ${call.url}`;
    if (routes[key]) return routes[key](call);
    if (key === 'GET /api/pathways') return jsonResponse(list);
    return undefined;
  });
  const onSelect = vi.fn();
  const onBack = vi.fn();
  const user = userEvent.setup();
  render(<PathwaySelector onSelect={onSelect} onBack={onBack} />);
  return { ...http, onSelect, onBack, user };
}

const combobox = () => screen.getByRole('combobox');
const createButton = () => screen.getByRole('button', { name: /Create and continue|Creating…|Checking…/ });

async function fillNew(user: ReturnType<typeof userEvent.setup>, title = 'Voice AI for Extension', description = 'Farmers call an IVR line', sector = 'Agriculture') {
  if (title) await user.type(screen.getByPlaceholderText(/Voice AI for Agricultural Extension/), title);
  if (description) await user.type(screen.getByPlaceholderText(/What was built/), description);
  if (sector) await user.type(screen.getByPlaceholderText(/Agriculture, Health/), sector);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PathwaySelector — existing pathways', () => {
  it('loads pathways and labels sector and existing membership', async () => {
    const { user } = setup();
    await waitFor(() => expect(combobox()).toBeEnabled());
    expect(combobox()).toHaveTextContent('Select a pathway…');
    await user.click(combobox());
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Kisan Voice — Agriculture', 'Clinic Triage (already contributing)']);
  });

  it('shows Loading… and a disabled picker while loading', () => {
    const gate = deferred<Response>();
    stubFetch(() => gate.promise);
    render(<PathwaySelector onSelect={vi.fn()} onBack={vi.fn()} />);
    expect(combobox()).toBeDisabled();
    expect(combobox()).toHaveTextContent('Loading…');
    gate.resolve(jsonResponse([]));
  });

  it('offers only published pathways — unpublished drafts are left out', async () => {
    const { user } = setup({}, [...PATHWAYS, DRAFT]);
    await waitFor(() => expect(combobox()).toBeEnabled());
    await user.click(combobox());
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Kisan Voice — Agriculture', 'Clinic Triage (already contributing)']);
  });

  it('with no published pathways the picker is disabled and invites starting a new one', async () => {
    setup({}, [DRAFT]);
    await waitFor(() => expect(combobox()).toHaveTextContent('No published pathways yet — start a new one below'));
    expect(combobox()).toBeDisabled();
  });

  it('shows an error when the list fails to load', async () => {
    setup({ 'GET /api/pathways': () => jsonResponse({ error: 'x' }, 500) });
    expect(await screen.findByText('Could not load pathways. Try again.')).toBeInTheDocument();
  });

  it('Continue is disabled until a pathway is picked', async () => {
    setup();
    await waitFor(() => expect(combobox()).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Continue →' })).toBeDisabled();
  });

  it('continuing with a pathway already joined selects it without a join call', async () => {
    const { user, calls, onSelect } = setup();
    await waitFor(() => expect(combobox()).toBeEnabled());
    await user.click(combobox());
    await user.click(screen.getByRole('option', { name: /Clinic Triage/ }));
    await user.click(screen.getByRole('button', { name: 'Continue →' }));
    expect(onSelect).toHaveBeenCalledWith('pw-2');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('continuing with a new pathway joins it first, then selects it', async () => {
    const { user, calls, onSelect } = setup({ 'POST /api/pathways/pw-1/join': () => jsonResponse({ ok: true }) });
    await waitFor(() => expect(combobox()).toBeEnabled());
    await user.click(combobox());
    await user.click(screen.getByRole('option', { name: /Kisan Voice/ }));
    await user.click(screen.getByRole('button', { name: 'Continue →' }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('pw-1'));
    expect(calls.find((c) => c.url === '/api/pathways/pw-1/join')?.body).toEqual({});
  });

  it('shows the join error and does not select', async () => {
    const { user, onSelect } = setup({
      'POST /api/pathways/pw-1/join': () => jsonResponse({ error: 'Your contributor registration is pending.' }, 403),
    });
    await waitFor(() => expect(combobox()).toBeEnabled());
    await user.click(combobox());
    await user.click(screen.getByRole('option', { name: /Kisan Voice/ }));
    await user.click(screen.getByRole('button', { name: 'Continue →' }));
    expect(await screen.findByText('Your contributor registration is pending.')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Continue →' })).toBeEnabled();
  });

  it('shows a network error when the join call throws', async () => {
    const { user } = setup({
      'POST /api/pathways/pw-1/join': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await waitFor(() => expect(combobox()).toBeEnabled());
    await user.click(combobox());
    await user.click(screen.getByRole('option', { name: /Kisan Voice/ }));
    await user.click(screen.getByRole('button', { name: 'Continue →' }));
    expect(await screen.findByText('Could not reach the server. Try again.')).toBeInTheDocument();
  });

  // The server answered, so this is a failed join, not an unreachable server.
  it('shows "Could not join" (not a network error) when the join error body is not JSON', async () => {
    const { user, onSelect } = setup({
      'POST /api/pathways/pw-1/join': () => new Response('<html>Bad gateway</html>', { status: 502 }),
    });
    await waitFor(() => expect(combobox()).toBeEnabled());
    await user.click(combobox());
    await user.click(screen.getByRole('option', { name: /Kisan Voice/ }));
    await user.click(screen.getByRole('button', { name: 'Continue →' }));
    expect(await screen.findByText('Could not join pathway.')).toBeInTheDocument();
    expect(screen.queryByText('Could not reach the server. Try again.')).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('while joining: Joining… shown and Continue/picker disabled', async () => {
    const gate = deferred<Response>();
    const { user } = setup({ 'POST /api/pathways/pw-1/join': () => gate.promise });
    await waitFor(() => expect(combobox()).toBeEnabled());
    await user.click(combobox());
    await user.click(screen.getByRole('option', { name: /Kisan Voice/ }));
    await user.click(screen.getByRole('button', { name: 'Continue →' }));
    expect(screen.getByText('Joining pathway…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Joining…' })).toBeDisabled();
    expect(combobox()).toBeDisabled();
    gate.resolve(jsonResponse({ ok: true }));
    await waitFor(() => expect(screen.queryByText('Joining pathway…')).not.toBeInTheDocument());
  });

  it('Back calls onBack', async () => {
    const { user, onBack } = setup();
    await user.click(screen.getByRole('button', { name: '← Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('PathwaySelector — creating a pathway (check-similar flow)', () => {
  it('Create is disabled until title, description and sector are all filled', async () => {
    const { user } = setup();
    expect(createButton()).toBeDisabled();
    await fillNew(user, 'Title', 'Desc', '');
    expect(createButton()).toBeDisabled();
    await user.type(screen.getByPlaceholderText(/Agriculture, Health/), '   ');
    expect(createButton()).toBeDisabled();
    await user.type(screen.getByPlaceholderText(/Agriculture, Health/), 'Health');
    expect(createButton()).toBeEnabled();
  });

  it('no similar match: checks, creates with trimmed fields, joins and selects the new pathway', async () => {
    const { user, calls, onSelect } = setup({
      'POST /api/pathways/check-similar': () => jsonResponse({ matchId: null }),
      'POST /api/pathways': () => jsonResponse({ id: 'pw-new' }),
      'POST /api/pathways/pw-new/join': () => jsonResponse({ ok: true }),
    });
    await waitFor(() => expect(combobox()).toBeEnabled());
    await fillNew(user, '  Voice AI  ', ' Farmers call ', ' Agriculture ');
    await user.click(createButton());
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('pw-new'));
    const posts = calls.filter((c) => c.method === 'POST').map((c) => c.url);
    expect(posts).toEqual(['/api/pathways/check-similar', '/api/pathways', '/api/pathways/pw-new/join']);
    const expected = { title: 'Voice AI', sector: 'Agriculture', description: 'Farmers call' };
    expect(calls[1].body).toEqual(expected);
    expect(calls[2].body).toEqual(expected);
  });

  it('a similar match is suggested instead of creating; joining it selects that pathway', async () => {
    const { user, calls, onSelect } = setup({
      'POST /api/pathways/check-similar': () => jsonResponse({ matchId: 'pw-1' }),
      'POST /api/pathways/pw-1/join': () => jsonResponse({ ok: true }),
    });
    await waitFor(() => expect(combobox()).toBeEnabled());
    await fillNew(user);
    await user.click(createButton());
    expect(await screen.findByText(/Did you mean/)).toHaveTextContent('Did you mean Kisan Voice (Agriculture)?');
    expect(createButton()).toBeDisabled();
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/pathways')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Join that one instead' }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('pw-1'));
  });

  it('joining a suggested pathway already joined skips the join call', async () => {
    const { user, calls, onSelect } = setup({
      'POST /api/pathways/check-similar': () => jsonResponse({ matchId: 'pw-2' }),
    });
    await waitFor(() => expect(combobox()).toBeEnabled());
    await fillNew(user);
    await user.click(createButton());
    expect(await screen.findByText(/Did you mean/)).toHaveTextContent('Did you mean Clinic Triage? Joining');
    await user.click(screen.getByRole('button', { name: 'Join that one instead' }));
    expect(onSelect).toHaveBeenCalledWith('pw-2');
    expect(calls.some((c) => c.url.endsWith('/join'))).toBe(false);
  });

  it('"genuinely different" creates anyway', async () => {
    const { user, calls, onSelect } = setup({
      'POST /api/pathways/check-similar': () => jsonResponse({ matchId: 'pw-1' }),
      'POST /api/pathways': () => jsonResponse({ id: 'pw-new' }),
      'POST /api/pathways/pw-new/join': () => jsonResponse({ ok: true }),
    });
    await waitFor(() => expect(combobox()).toBeEnabled());
    await fillNew(user);
    await user.click(createButton());
    await user.click(await screen.findByRole('button', { name: 'No, this is genuinely different' }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('pw-new'));
    expect(calls.filter((c) => c.url === '/api/pathways/check-similar')).toHaveLength(1);
  });

  it('editing any field clears the suggestion and re-checks on the next create', async () => {
    const { user, calls } = setup({
      'POST /api/pathways/check-similar': () => jsonResponse({ matchId: 'pw-1' }),
    });
    await waitFor(() => expect(combobox()).toBeEnabled());
    await fillNew(user);
    await user.click(createButton());
    await screen.findByText(/Did you mean/);
    await user.type(screen.getByPlaceholderText(/Agriculture, Health/), 's');
    expect(screen.queryByText(/Did you mean/)).not.toBeInTheDocument();
    expect(createButton()).toBeEnabled();
    await user.click(createButton());
    await screen.findByText(/Did you mean/);
    expect(calls.filter((c) => c.url === '/api/pathways/check-similar')).toHaveLength(2);
  });

  // A curated library pathway has no pathways row, so it can be viewed but
  // not joined.
  describe('a curated match', () => {
    const CURATED = { matchId: null, curatedMatch: { slug: 'mahavistaar', title: 'MahaVISTAAR', sector: 'Agriculture' } };

    it('points at the library pathway instead of offering a join, and creates nothing', async () => {
      const { user, calls, onSelect } = setup({
        'POST /api/pathways/check-similar': () => jsonResponse(CURATED),
      });
      await waitFor(() => expect(combobox()).toBeEnabled());
      await fillNew(user);
      await user.click(createButton());
      expect(await screen.findByText(/already in the library/)).toHaveTextContent(
        'This looks like MahaVISTAAR (Agriculture), which is already in the library.'
      );
      const view = screen.getByRole('link', { name: 'View that pathway' });
      expect(view).toHaveAttribute('href', '/wiki/mahavistaar');
      expect(view).toHaveAttribute('target', '_blank');
      expect(screen.queryByRole('button', { name: 'Join that one instead' })).not.toBeInTheDocument();
      expect(createButton()).toBeDisabled();
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/pathways')).toBe(false);
      expect(calls.some((c) => c.url.endsWith('/join'))).toBe(false);
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('"genuinely different" creates and joins the new pathway', async () => {
      const { user, calls, onSelect } = setup({
        'POST /api/pathways/check-similar': () => jsonResponse(CURATED),
        'POST /api/pathways': () => jsonResponse({ id: 'pw-new' }),
        'POST /api/pathways/pw-new/join': () => jsonResponse({ ok: true }),
      });
      await waitFor(() => expect(combobox()).toBeEnabled());
      await fillNew(user);
      await user.click(createButton());
      await user.click(await screen.findByRole('button', { name: 'No, this is genuinely different' }));
      await waitFor(() => expect(onSelect).toHaveBeenCalledWith('pw-new'));
      expect(calls.filter((c) => c.url === '/api/pathways/check-similar')).toHaveLength(1);
    });

    it('editing a field clears it and re-checks on the next create', async () => {
      const { user, calls } = setup({
        'POST /api/pathways/check-similar': () => jsonResponse(CURATED),
      });
      await waitFor(() => expect(combobox()).toBeEnabled());
      await fillNew(user);
      await user.click(createButton());
      await screen.findByText(/already in the library/);
      await user.type(screen.getByPlaceholderText(/Agriculture, Health/), 's');
      expect(screen.queryByText(/already in the library/)).not.toBeInTheDocument();
      expect(createButton()).toBeEnabled();
      await user.click(createButton());
      await screen.findByText(/already in the library/);
      expect(calls.filter((c) => c.url === '/api/pathways/check-similar')).toHaveLength(2);
    });
  });

  it('a match id not in the loaded list falls through to creating', async () => {
    const { user, onSelect } = setup({
      'POST /api/pathways/check-similar': () => jsonResponse({ matchId: 'pw-unknown' }),
      'POST /api/pathways': () => jsonResponse({ id: 'pw-new' }),
      'POST /api/pathways/pw-new/join': () => jsonResponse({ ok: true }),
    });
    await waitFor(() => expect(combobox()).toBeEnabled());
    await fillNew(user);
    await user.click(createButton());
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('pw-new'));
  });

  it('a failing similarity check does not block creating', async () => {
    const { user, onSelect } = setup({
      'POST /api/pathways/check-similar': () => jsonResponse({ error: 'LLM down' }, 500),
      'POST /api/pathways': () => jsonResponse({ id: 'pw-new' }),
      'POST /api/pathways/pw-new/join': () => jsonResponse({ ok: true }),
    });
    await waitFor(() => expect(combobox()).toBeEnabled());
    await fillNew(user);
    await user.click(createButton());
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('pw-new'));
  });

  it('a thrown similarity check does not block creating', async () => {
    const { user, onSelect } = setup({
      'POST /api/pathways/check-similar': () => {
        throw new TypeError('offline');
      },
      'POST /api/pathways': () => jsonResponse({ id: 'pw-new' }),
      'POST /api/pathways/pw-new/join': () => jsonResponse({ ok: true }),
    });
    await waitFor(() => expect(combobox()).toBeEnabled());
    await fillNew(user);
    await user.click(createButton());
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('pw-new'));
  });

  it('shows Checking… and disables Create while the check runs', async () => {
    const gate = deferred<Response>();
    const { user, calls } = setup({ 'POST /api/pathways/check-similar': () => gate.promise });
    await waitFor(() => expect(combobox()).toBeEnabled());
    await fillNew(user);
    await user.click(createButton());
    expect(screen.getByText('Checking for similar pathways…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Checking…' }));
    expect(calls.filter((c) => c.url === '/api/pathways/check-similar')).toHaveLength(1);
    gate.resolve(jsonResponse({ matchId: 'pw-1' }));
    await screen.findByText(/Did you mean/);
  });

  it('shows the create error and does not select', async () => {
    const { user, onSelect } = setup({
      'POST /api/pathways/check-similar': () => jsonResponse({ matchId: null }),
      'POST /api/pathways': () => jsonResponse({ error: 'A pathway with that title already exists.' }, 409),
    });
    await waitFor(() => expect(combobox()).toBeEnabled());
    await fillNew(user);
    await user.click(createButton());
    expect(await screen.findByText('A pathway with that title already exists.')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    expect(createButton()).toBeEnabled();
  });

  it('shows a generic error when create returns a non-JSON body', async () => {
    const { user } = setup({
      'POST /api/pathways/check-similar': () => jsonResponse({ matchId: null }),
      'POST /api/pathways': () => new Response('<html>', { status: 502 }),
    });
    await waitFor(() => expect(combobox()).toBeEnabled());
    await fillNew(user);
    await user.click(createButton());
    expect(await screen.findByText('Could not create pathway. Try again.')).toBeInTheDocument();
  });
});
