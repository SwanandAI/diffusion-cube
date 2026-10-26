// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { jsonResponse, stubFetch } from '../../helpers/ui-fork-http';
import OrganisationInput from '@/components/OrganisationInput';

const ORGS = [
  { id: 'o1', name: 'EkStep Foundation', canonical_role: 'Funder', url: 'https://ekstep.org' },
  { id: 'o2', name: 'EkStep Labs', canonical_role: null, url: null },
];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function flushDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}

function setup(value = '', results: unknown = ORGS, ok = true) {
  vi.useFakeTimers();
  const http = stubFetch(() => (ok ? jsonResponse(results) : jsonResponse({ error: 'x' }, 500)));
  const onChange = vi.fn();
  const utils = render(<OrganisationInput value={value} onChange={onChange} label="Your organisation" />);
  const input = screen.getByRole('textbox');
  return { ...http, onChange, input, ...utils };
}

describe('OrganisationInput', () => {
  it('shows the label and default placeholder', () => {
    setup();
    expect(screen.getByText('Your organisation')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Start typing…')).toBeInTheDocument();
  });

  it('does not search for an empty value', async () => {
    const { fn } = setup();
    await flushDebounce();
    expect(fn).not.toHaveBeenCalled();
  });

  it('typing reports free text immediately and searches after a 250ms debounce', async () => {
    const { fn, onChange, input } = setup();
    fireEvent.change(input, { target: { value: 'Ek' } });
    expect(onChange).toHaveBeenLastCalledWith('Ek');
    fireEvent.change(input, { target: { value: 'EkS' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(fn).not.toHaveBeenCalled();
    await flushDebounce();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toBe('/api/organisations?q=EkS');
    expect(screen.getByText('EkStep Foundation')).toBeInTheDocument();
    expect(screen.getByText('Funder')).toBeInTheDocument();
  });

  it('URL-encodes the query', async () => {
    const { fn, input } = setup();
    fireEvent.change(input, { target: { value: 'A&B Trust' } });
    await flushDebounce();
    expect(fn.mock.calls[0][0]).toBe('/api/organisations?q=A%26B%20Trust');
  });

  it('selecting a result reports name, role and url and closes the list', async () => {
    const { onChange, input } = setup();
    fireEvent.change(input, { target: { value: 'Ek' } });
    await flushDebounce();
    fireEvent.click(screen.getByText('EkStep Foundation'));
    expect(onChange).toHaveBeenLastCalledWith('EkStep Foundation', 'Funder', 'https://ekstep.org');
    expect(input).toHaveValue('EkStep Foundation');
    expect(screen.queryByText('EkStep Labs')).not.toBeInTheDocument();
  });

  it('a result with no role or url reports undefined for both', async () => {
    const { onChange, input } = setup();
    fireEvent.change(input, { target: { value: 'Ek' } });
    await flushDebounce();
    fireEvent.click(screen.getByText('EkStep Labs'));
    expect(onChange).toHaveBeenLastCalledWith('EkStep Labs', undefined, undefined);
  });

  it('a failed search shows no list', async () => {
    const { input } = setup('', ORGS, false);
    fireEvent.change(input, { target: { value: 'Ek' } });
    await flushDebounce();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('a thrown search clears results', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('offline');
    }));
    render(<OrganisationInput value="" onChange={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ek' } });
    await flushDebounce();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('clearing the box clears results', async () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'Ek' } });
    await flushDebounce();
    expect(screen.getByRole('list')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '   ' } });
    await flushDebounce();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('closes the list on an outside mousedown and reopens on focus', async () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'Ek' } });
    await flushDebounce();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    fireEvent.focus(input);
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('syncs to an external value change (form reset)', () => {
    const { rerender, input } = setup('Old Org');
    expect(input).toHaveValue('Old Org');
    rerender(<OrganisationInput value="" onChange={vi.fn()} />);
    expect(input).toHaveValue('');
  });
});
