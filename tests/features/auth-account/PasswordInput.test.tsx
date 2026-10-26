// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PasswordInput from '@/components/PasswordInput';

describe('PasswordInput', () => {
  it('starts hidden and toggles visibility', async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('passes input props through and the toggle never submits a form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onChange = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <PasswordInput aria-label="Password" name="pw" placeholder="••••" required onChange={onChange} />
      </form>
    );
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('name', 'pw');
    expect(input).toBeRequired();
    await user.type(input, 'hunter2');
    expect(onChange).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('respects disabled', () => {
    render(<PasswordInput aria-label="Password" disabled />);
    expect(screen.getByLabelText('Password')).toBeDisabled();
  });
});
