// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReusableAssetsPanel, { type ReusableAssetsActions } from '@/components/ReusableAssetsPanel';
import type { AssetShareItem, AssetShareState } from '@/lib/toolkit-assets';
import { deferred } from '../../helpers/ui-fork-http';

const ok = { ok: true };

function makeActions(over: Partial<ReusableAssetsActions> = {}): ReusableAssetsActions {
  return {
    stageFiles: vi.fn(() => ok),
    unstage: vi.fn(),
    rename: vi.fn(),
    describe: vi.fn(),
    remove: vi.fn(async () => ok),
    deleteAsset: vi.fn(async () => ok),
    confirmAll: vi.fn(async () => ok),
    ...over,
  };
}

const sharedFile: AssetShareItem = {
  key: 'row:checklist',
  name: 'Vendor checklist',
  fromSection4: true,
  shared: { assetId: 'asset-file', source: { fileName: 'checklist.pdf' } },
};
const sharedLink: AssetShareItem = {
  key: 'row:repo',
  name: 'Open-source repo',
  fromSection4: true,
  shared: { assetId: 'asset-link', source: { url: 'https://www.github.com/org/repo' } },
};
const noFile: AssetShareItem = { key: 'row:faq', name: 'FAQ deck', fromSection4: true };
const stagedNew: AssetShareItem = {
  key: 'new:file:guide.pdf',
  name: 'Ops guide',
  fromSection4: false,
  staged: { fileName: 'guide.pdf' },
  howItHelped: 'Onboarding',
};

function card(id: string, items: AssetShareItem[], over: Partial<AssetShareState> = {}): AssetShareState {
  return { id, items, status: 'open', noneInSection4: false, ...over };
}

function renderPanel(cards: AssetShareState[], actions = makeActions(), fileAvailable: (name: string) => boolean = () => true) {
  const onClose = vi.fn();
  const utils = render(
    <ReusableAssetsPanel cards={cards} fileAvailable={fileAvailable} actions={actions} onClose={onClose} />
  );
  return { ...utils, actions, onClose, user: userEvent.setup() };
}

const rowOf = (name: string) => screen.getByText(name, { selector: 'p' }).closest('li') as HTMLElement;

describe('ReusableAssetsPanel', () => {
  it('shows the empty state with no rows and no footer when there are no cards', () => {
    renderPanel([]);
    expect(screen.getByText('No reusable assets yet')).toBeInTheDocument();
    expect(screen.queryByText(/shared$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add a new asset/ })).not.toBeInTheDocument();
  });

  it('shows the empty state but still the Add button when the latest card has no items', () => {
    renderPanel([card('c1', [])]);
    expect(screen.getByText('No reusable assets yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add a new asset' })).toBeInTheDocument();
  });

  it('flattens every card’s non-deleted items and counts shared ones', () => {
    renderPanel([
      card('c1', [sharedFile, { ...noFile, deleted: true }]),
      card('c2', [sharedLink, noFile]),
    ]);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
  });

  it('labels status per row: Shared / No file / Not confirmed / File lost', () => {
    renderPanel(
      [card('c1', [sharedFile, noFile, stagedNew, { ...noFile, key: 'row:lost', name: 'Lost one', staged: { fileName: 'lost.pdf' } }])],
      makeActions(),
      (name) => name !== 'lost.pdf'
    );
    expect(within(rowOf('Vendor checklist')).getByText('Shared')).toBeInTheDocument();
    expect(within(rowOf('FAQ deck')).getByText('No file')).toBeInTheDocument();
    expect(within(screen.getByDisplayValue('Ops guide').closest('li')!).getByText('Not confirmed')).toBeInTheDocument();
    const lost = rowOf('Lost one');
    expect(within(lost).getByText('File lost')).toBeInTheDocument();
    expect(within(lost).getByText('lost.pdf — select the file again')).toBeInTheDocument();
    // A lost Section 4 file can be added again.
    expect(within(lost).getByRole('button', { name: /Add/ })).toBeInTheDocument();
  });

  it('shared file downloads; shared link opens in a new tab', () => {
    renderPanel([card('c1', [sharedFile, sharedLink])]);
    const dl = within(rowOf('Vendor checklist')).getByRole('link', { name: /Download/ });
    expect(dl).toHaveAttribute('href', '/api/toolkit-assets/asset-file/download');
    expect(dl).toHaveAttribute('download');
    const open = within(rowOf('Open-source repo')).getByRole('link', { name: /Open link/ });
    expect(open).toHaveAttribute('target', '_blank');
    expect(within(rowOf('Open-source repo')).getByText('github.com')).toBeInTheDocument();
  });

  it('Close calls onClose', async () => {
    const { user, onClose } = renderPanel([card('c1', [noFile])]);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Add on a row stages a file onto that card and item', async () => {
    const { user, actions } = renderPanel([card('c1', [noFile])]);
    const file = new File(['x'], 'faq.pptx');
    await user.upload(rowOf('FAQ deck').querySelector('input[type=file]') as HTMLInputElement, file);
    expect(actions.stageFiles).toHaveBeenCalledWith('c1', 'row:faq', [file]);
  });

  it('shows a row-level staging error', async () => {
    const actions = makeActions({ stageFiles: vi.fn(() => ({ ok: false, error: 'File is over 25 MB.' })) });
    const { user } = renderPanel([card('c1', [noFile])], actions);
    await user.upload(rowOf('FAQ deck').querySelector('input[type=file]') as HTMLInputElement, new File(['x'], 'big.pdf'));
    expect(within(rowOf('FAQ deck')).getByText('File is over 25 MB.')).toBeInTheDocument();
  });

  it('a new asset goes onto the latest card with a null item key', async () => {
    const { user, actions, container } = renderPanel([card('c1', [noFile]), card('c2', [])]);
    const footerInput = Array.from(container.querySelectorAll('input[type=file]')).find(
      (i) => (i as HTMLInputElement).multiple
    ) as HTMLInputElement;
    const files = [new File(['a'], 'a.pdf'), new File(['b'], 'b.pdf')];
    await user.upload(footerInput, files);
    expect(actions.stageFiles).toHaveBeenCalledWith('c2', null, files);
  });

  it('shows the footer staging error', async () => {
    const actions = makeActions({ stageFiles: vi.fn(() => ({ ok: false, error: 'Unsupported file type.' })) });
    const { user, container } = renderPanel([card('c1', [])], actions);
    const input = container.querySelector('input[type=file][multiple]') as HTMLInputElement;
    await user.upload(input, new File(['a'], 'a.exe'));
    expect(screen.getByText('Unsupported file type.')).toBeInTheDocument();
  });

  it('a staged new asset asks for its title and use; edits call rename/describe', async () => {
    const { user, actions } = renderPanel([card('c1', [stagedNew])]);
    const title = screen.getByPlaceholderText('What is this asset called?');
    expect(title).toHaveValue('Ops guide');
    await user.type(title, 's');
    expect(actions.rename).toHaveBeenCalledWith('c1', 'new:file:guide.pdf', 'Ops guides');
    const use = screen.getByRole('textbox', { name: /What is it used for\?/ });
    expect(use).toHaveValue('Onboarding');
    await user.type(use, '!');
    expect(actions.describe).toHaveBeenCalledWith('c1', 'new:file:guide.pdf', 'Onboarding!');
  });

  it('Remove on a staged asset unstages it', async () => {
    const { user, actions } = renderPanel([card('c1', [stagedNew])]);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(actions.unstage).toHaveBeenCalledWith('c1', 'new:file:guide.pdf');
  });

  it('Remove on a shared asset shows Removing… disabled and then any error', async () => {
    const pending = deferred<{ ok: boolean; error?: string }>();
    const actions = makeActions({ remove: vi.fn(() => pending.promise) });
    const { user } = renderPanel([card('c1', [sharedFile])], actions);
    const row = rowOf('Vendor checklist');
    await user.click(within(row).getByRole('button', { name: 'Remove' }));
    expect(within(row).getByRole('button', { name: 'Removing…' })).toBeDisabled();
    // Delete is locked while a remove is in flight.
    expect(within(row).getByRole('button', { name: 'Delete Vendor checklist' })).toBeDisabled();
    await user.click(within(row).getByRole('button', { name: 'Removing…' }));
    expect(actions.remove).toHaveBeenCalledTimes(1);
    pending.resolve({ ok: false, error: 'Could not remove that file.' });
    expect(await within(row).findByText('Could not remove that file.')).toBeInTheDocument();
  });

  it('Delete asks first; Cancel backs out without deleting', async () => {
    const { user, actions } = renderPanel([card('c1', [noFile])]);
    const row = rowOf('FAQ deck');
    await user.click(within(row).getByRole('button', { name: 'Delete FAQ deck' }));
    expect(within(row).getByText(/Delete this asset\? It is removed from Section 4/)).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Cancel' }));
    expect(actions.deleteAsset).not.toHaveBeenCalled();
    expect(within(row).getByRole('button', { name: 'Delete FAQ deck' })).toBeInTheDocument();
  });

  it('deleting a shared asset warns its file is deleted, then calls deleteAsset once', async () => {
    const pending = deferred<{ ok: boolean; error?: string }>();
    const actions = makeActions({ deleteAsset: vi.fn(() => pending.promise) });
    const { user } = renderPanel([card('c1', [sharedFile])], actions);
    const row = rowOf('Vendor checklist');
    await user.click(within(row).getByRole('button', { name: 'Delete Vendor checklist' }));
    expect(within(row).getByText(/Its file is deleted and removed from Section 4/)).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    const busy = within(row).getByRole('button', { name: 'Deleting…' });
    expect(busy).toBeDisabled();
    expect(within(row).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.click(busy);
    expect(actions.deleteAsset).toHaveBeenCalledTimes(1);
    expect(actions.deleteAsset).toHaveBeenCalledWith('c1', 'row:checklist');
    pending.resolve(ok);
  });

  it('a failed delete closes the question and shows the error', async () => {
    const actions = makeActions({ deleteAsset: vi.fn(async () => ({ ok: false, error: 'Delete failed.' })) });
    const { user } = renderPanel([card('c1', [noFile])], actions);
    const row = rowOf('FAQ deck');
    await user.click(within(row).getByRole('button', { name: 'Delete FAQ deck' }));
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(await within(row).findByText('Delete failed.')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Delete FAQ deck' })).toBeEnabled();
  });

  it('shows Confirm and the consent note only when something is staged', () => {
    const { unmount } = renderPanel([card('c1', [sharedFile, noFile])]);
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Anything you share here is public/)).not.toBeInTheDocument();
    unmount();
    renderPanel([card('c1', [stagedNew])]);
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByText(/Anything you share here is public/)).toBeInTheDocument();
  });

  it('Confirm shares everything, locking controls while pending (no double submit)', async () => {
    const pending = deferred<{ ok: boolean; error?: string }>();
    const actions = makeActions({ confirmAll: vi.fn(() => pending.promise) });
    const { user } = renderPanel([card('c1', [stagedNew, noFile])], actions);
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    const busy = screen.getByRole('button', { name: 'Sharing…' });
    expect(busy).toBeDisabled();
    expect(screen.getByRole('button', { name: '+ Add a new asset' })).toBeDisabled();
    expect(screen.getByPlaceholderText('What is this asset called?')).toBeDisabled();
    expect(within(rowOf('FAQ deck')).getByRole('button', { name: /Add/ })).toBeDisabled();
    await user.click(busy);
    expect(actions.confirmAll).toHaveBeenCalledTimes(1);
    pending.resolve(ok);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled());
  });

  it('shows the Confirm error', async () => {
    const actions = makeActions({ confirmAll: vi.fn(async () => ({ ok: false, error: 'Sharing failed.' })) });
    const { user } = renderPanel([card('c1', [stagedNew])], actions);
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Sharing failed.')).toBeInTheDocument();
  });

  it('shows the per-item error carried on the state', () => {
    renderPanel([card('c1', [{ ...noFile, error: 'Upload failed.' }])]);
    expect(screen.getByText('Upload failed.')).toBeInTheDocument();
  });

  it('truncates a very long name visually but keeps the full text as a title', () => {
    const long = 'A'.repeat(300);
    renderPanel([card('c1', [{ ...noFile, name: long }])]);
    const p = screen.getByText(long);
    expect(p).toHaveAttribute('title', long);
    expect(p.className).toContain('line-clamp-2');
  });
});
