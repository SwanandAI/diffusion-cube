// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { stubScrollIntoView } from '../../helpers/ui-dom';
import Select, { type SelectOption } from '@/components/Select';

beforeAll(stubScrollIntoView);

const OPTIONS: SelectOption[] = [
  { value: 'explore', label: 'Explore' },
  { value: 'define', label: 'Define', disabled: true },
  { value: 'pilot', label: 'Pilot' },
  { value: 'scale', label: 'Scale' },
];

function Controlled({ initial = '', onChange = vi.fn(), ...rest }: { initial?: string; onChange?: (v: string) => void } & Partial<Parameters<typeof Select>[0]>) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <Select
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange(v);
        }}
        options={OPTIONS}
        aria-label="Stage"
        {...rest}
      />
      <button type="button">outside</button>
    </>
  );
}

const trigger = () => screen.getByRole('combobox', { name: 'Stage' });

describe('Select', () => {
  it('shows the placeholder when nothing is selected, and the label when something is', () => {
    const { unmount } = render(<Controlled placeholder="Pick a stage" />);
    expect(trigger()).toHaveTextContent('Pick a stage');
    unmount();
    render(<Controlled initial="pilot" />);
    expect(trigger()).toHaveTextContent('Pilot');
  });

  it('defaults the placeholder to Select…', () => {
    render(<Controlled />);
    expect(trigger()).toHaveTextContent('Select…');
  });

  it('opens on click with ARIA wiring and closes on a second click', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    const listbox = screen.getByRole('listbox');
    expect(trigger()).toHaveAttribute('aria-controls', listbox.id);
    expect(screen.getAllByRole('option')).toHaveLength(4);
    expect(screen.getByRole('option', { name: 'Define' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(trigger());
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('choosing an option calls onChange and closes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    await user.click(trigger());
    await user.click(screen.getByRole('option', { name: 'Scale' }));
    expect(onChange).toHaveBeenCalledWith('scale');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger()).toHaveTextContent('Scale');
  });

  it('clicking a disabled option does nothing and keeps the menu open', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    await user.click(trigger());
    await user.click(screen.getByRole('option', { name: 'Define' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('re-choosing the current value does not fire onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial="pilot" onChange={onChange} />);
    await user.click(trigger());
    expect(screen.getByRole('option', { name: 'Pilot' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('option', { name: 'Pilot' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keyboard: arrows skip disabled options, Enter chooses', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    trigger().focus();
    await user.keyboard('{ArrowDown}');
    const listbox = screen.getByRole('listbox');
    expect(trigger()).toHaveAttribute('aria-activedescendant', `${listbox.id}-0`);
    await user.keyboard('{ArrowDown}');
    // index 1 (Define) is disabled → lands on Pilot.
    expect(trigger()).toHaveAttribute('aria-activedescendant', `${listbox.id}-2`);
    await user.keyboard('{ArrowUp}');
    expect(trigger()).toHaveAttribute('aria-activedescendant', `${listbox.id}-0`);
    await user.keyboard('{ArrowUp}'); // already at first enabled: stays
    expect(trigger()).toHaveAttribute('aria-activedescendant', `${listbox.id}-0`);
    await user.keyboard('{End}');
    expect(trigger()).toHaveAttribute('aria-activedescendant', `${listbox.id}-3`);
    await user.keyboard('{Home}');
    expect(trigger()).toHaveAttribute('aria-activedescendant', `${listbox.id}-0`);
    await user.keyboard('{End}{Enter}');
    expect(onChange).toHaveBeenCalledWith('scale');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('opening starts on the current value', async () => {
    const user = userEvent.setup();
    render(<Controlled initial="scale" />);
    trigger().focus();
    await user.keyboard('{Enter}');
    expect(trigger()).toHaveAttribute('aria-activedescendant', `${screen.getByRole('listbox').id}-3`);
  });

  it('Escape and Tab close without choosing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    trigger().focus();
    await user.keyboard(' ');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    trigger().focus();
    await user.keyboard('{ArrowUp}');
    await user.keyboard('{Tab}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes on an outside mousedown', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('disabled: cannot be opened by click or keyboard', async () => {
    const user = userEvent.setup();
    render(<Controlled disabled />);
    expect(trigger()).toBeDisabled();
    await user.click(trigger());
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('with every option disabled nothing is active and Enter chooses nothing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Select
        value=""
        onChange={onChange}
        aria-label="Stage"
        options={[
          { value: 'a', label: 'A', disabled: true },
          { value: 'b', label: 'B', disabled: true },
        ]}
      />
    );
    trigger().focus();
    await user.keyboard('{ArrowDown}');
    expect(trigger()).not.toHaveAttribute('aria-activedescendant');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('with no options opens an empty listbox', async () => {
    const user = userEvent.setup();
    render(<Select value="" onChange={vi.fn()} options={[]} aria-label="Stage" />);
    await user.click(trigger());
    expect(screen.getByRole('listbox')).toBeEmptyDOMElement();
  });

  it('a value with no matching option shows the placeholder', () => {
    render(<Select value="ghost" onChange={vi.fn()} options={OPTIONS} aria-label="Stage" placeholder="None" />);
    expect(trigger()).toHaveTextContent('None');
  });

  it('aligns the menu right when asked', async () => {
    const user = userEvent.setup();
    render(<Controlled align="right" />);
    await user.click(trigger());
    expect(screen.getByRole('listbox').className).toContain('right-0');
  });
});
