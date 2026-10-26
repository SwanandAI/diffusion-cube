// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfirmDialog, { useConfirm } from '@/components/ConfirmDialog';

function renderDialog(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog title="Delete pathway?" confirmLabel="Delete" onConfirm={onConfirm} onCancel={onCancel} {...props}>
      This can&apos;t be undone.
    </ConfirmDialog>
  );
  return { onConfirm, onCancel };
}

describe('ConfirmDialog', () => {
  it('renders an accessible modal dialog portalled into body', () => {
    const { container } = render(
      <div id="host">
        <ConfirmDialog title="Sign out?" confirmLabel="Sign out" onConfirm={vi.fn()} onCancel={vi.fn()} />
      </div>
    );
    const dialog = screen.getByRole('dialog', { name: 'Sign out?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(container.querySelector('#host')).toBeEmptyDOMElement();
    expect(document.body).toContainElement(dialog);
  });

  it('shows the message, default Cancel label and custom confirm label', () => {
    renderDialog();
    expect(screen.getByText("This can't be undone.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('uses a custom cancel label', () => {
    renderDialog({ cancelLabel: 'Keep it' });
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeInTheDocument();
  });

  it('confirm and cancel buttons call their handlers', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Escape cancels', async () => {
    const user = userEvent.setup();
    const { onCancel } = renderDialog();
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('clicking the backdrop cancels but clicking inside the card does not', async () => {
    const user = userEvent.setup();
    const { onCancel } = renderDialog();
    await user.click(screen.getByText("This can't be undone."));
    expect(onCancel).not.toHaveBeenCalled();
    await user.click(screen.getByRole('dialog').parentElement!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('while busy: both buttons disabled, Escape and backdrop do nothing', async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirm } = renderDialog({ busy: true });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('dialog').parentElement!);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirmDisabled disables only the confirm button', () => {
    renderDialog({ confirmDisabled: true });
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('autofocuses the confirm button unless it is disabled', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus();
  });

  it('shows an error line when given', () => {
    renderDialog({ error: 'Wrong password' });
    expect(screen.getByText('Wrong password')).toBeInTheDocument();
  });

  it('uses the coral (danger) style when danger is set', () => {
    renderDialog({ danger: true });
    expect(screen.getByRole('button', { name: 'Delete' }).className).toContain('bg-coral');
  });

  it('removes its Escape listener on unmount', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { unmount } = render(
      <ConfirmDialog title="t" confirmLabel="ok" onConfirm={vi.fn()} onCancel={onCancel} />
    );
    unmount();
    await user.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
  });
});

function Harness({ onResult }: { onResult: (ok: boolean) => void }) {
  const { confirm, dialog } = useConfirm();
  return (
    <>
      <button
        type="button"
        onClick={async () => onResult(await confirm({ title: 'Really?', message: 'Gone for good', confirmLabel: 'Yes', danger: true }))}
      >
        Ask
      </button>
      {dialog}
    </>
  );
}

describe('useConfirm', () => {
  it('renders no dialog until confirm() is called', () => {
    const { result } = renderHook(() => useConfirm());
    expect(result.current.dialog).toBeNull();
  });

  it('resolves true on confirm and closes', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(screen.getByRole('dialog', { name: 'Really?' })).toBeInTheDocument();
    expect(screen.getByText('Gone for good')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onResult).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('resolves false on cancel', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onResult).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('resolves false on Escape', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await user.keyboard('{Escape}');
    expect(onResult).toHaveBeenCalledWith(false);
  });

  it('a second confirm() settles the first one as false', async () => {
    const { result } = renderHook(() => useConfirm());
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.confirm({ title: 'one', confirmLabel: 'ok' });
    });
    act(() => {
      second = result.current.confirm({ title: 'two', confirmLabel: 'ok' });
    });
    await expect(first).resolves.toBe(false);
    render(<>{result.current.dialog}</>);
    expect(screen.getByRole('dialog', { name: 'two' })).toBeInTheDocument();
    await act(async () => {
      screen.getByRole('button', { name: 'ok' }).click();
    });
    await expect(second).resolves.toBe(true);
  });
});
