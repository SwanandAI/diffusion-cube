// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssetShareCard, { type AssetShareActions } from '@/components/AssetShareCard';
import type { AssetShareItem, AssetShareState } from '@/lib/toolkit-assets';
import { deferred } from '../../helpers/ui-fork-http';

const ok = { ok: true };

function makeActions(over: Partial<AssetShareActions> = {}): AssetShareActions {
  return {
    stageFiles: vi.fn(() => ok),
    stageLink: vi.fn(() => ok),
    takeSuggested: vi.fn(() => ok),
    unstage: vi.fn(),
    rename: vi.fn(),
    describe: vi.fn(),
    remove: vi.fn(async () => ok),
    confirm: vi.fn(async () => ok),
    reopen: vi.fn(),
    ...over,
  };
}

function item(over: Partial<AssetShareItem> = {}): AssetShareItem {
  return { key: 'row:vendor checklist', name: 'Vendor checklist', fromSection4: true, ...over };
}

function card(over: Partial<AssetShareState> = {}): AssetShareState {
  return { id: 'card-1', items: [item()], status: 'open', noneInSection4: false, ...over };
}

function renderCard(c: AssetShareState, actions = makeActions(), fileAvailable = () => true) {
  const utils = render(<AssetShareCard card={c} fileAvailable={fileAvailable} actions={actions} />);
  return { ...utils, actions, user: userEvent.setup() };
}

const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

describe('AssetShareCard — open card', () => {
  it('lists Section 4 assets with an upload/link control each and a Confirm button', () => {
    renderCard(card({ items: [item(), item({ key: 'row:faq', name: 'FAQ deck' })] }));
    expect(screen.getByText(/These are the reusable assets in Section 4/)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(within(rowOf('Vendor checklist')).getByRole('button', { name: 'Upload file' })).toBeInTheDocument();
    expect(within(rowOf('FAQ deck')).getByRole('button', { name: 'Add link' })).toBeInTheDocument();
    expect(screen.getByText('Any other reusable asset?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });

  it('asks "do you have any?" when Section 4 lists none, with a "Nothing to share?" hint', () => {
    renderCard(card({ items: [], noneInSection4: true }));
    expect(screen.getByText(/Do you have any reusable assets/)).toBeInTheDocument();
    expect(screen.getByText('Add your assets')).toBeInTheDocument();
    expect(screen.getByText('Nothing to share? Just click Confirm.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('hides deleted items', () => {
    renderCard(card({ items: [item({ deleted: true }), item({ key: 'row:b', name: 'Kept asset' })] }));
    expect(screen.queryByText('Vendor checklist')).not.toBeInTheDocument();
    expect(screen.getByText('Kept asset')).toBeInTheDocument();
  });

  it('stages an uploaded file onto its row', async () => {
    const { user, actions } = renderCard(card());
    const file = new File(['x'], 'checklist.pdf', { type: 'application/pdf' });
    const input = rowOf('Vendor checklist').querySelector('input[type=file]') as HTMLInputElement;
    expect(input.multiple).toBe(false);
    await user.upload(input, file);
    expect(actions.stageFiles).toHaveBeenCalledWith('card-1', 'row:vendor checklist', [file]);
  });

  it('shows a staging error returned for an uploaded file', async () => {
    const actions = makeActions({ stageFiles: vi.fn(() => ({ ok: false, error: 'ZIP files are not allowed.' })) });
    const { user } = renderCard(card(), actions);
    const input = rowOf('Vendor checklist').querySelector('input[type=file]') as HTMLInputElement;
    await user.upload(input, new File(['x'], 'a.zip'));
    expect(await screen.findByText('ZIP files are not allowed.')).toBeInTheDocument();
  });

  it('extra files go to stageFiles with a null item key (multiple allowed)', async () => {
    const { user, actions } = renderCard(card({ items: [] }));
    const box = screen.getByText('Any other reusable asset?').parentElement!;
    const input = box.querySelector('input[type=file]') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    const files = [new File(['a'], 'a.pdf'), new File(['b'], 'b.pdf')];
    await user.upload(input, files);
    expect(actions.stageFiles).toHaveBeenCalledWith('card-1', null, files);
  });

  it('adds a link via the link box; Add is disabled while empty', async () => {
    const { user, actions } = renderCard(card());
    const row = rowOf('Vendor checklist');
    await user.click(within(row).getByRole('button', { name: 'Add link' }));
    const add = within(row).getByRole('button', { name: 'Add' });
    expect(add).toBeDisabled();
    await user.type(within(row).getByPlaceholderText('https://…'), 'https://example.org/x');
    await user.click(add);
    expect(actions.stageLink).toHaveBeenCalledWith('card-1', 'row:vendor checklist', 'https://example.org/x');
    // Link box closes on success.
    expect(within(row).queryByPlaceholderText('https://…')).not.toBeInTheDocument();
  });

  it('keeps the link box open and shows the error for a rejected link', async () => {
    const actions = makeActions({ stageLink: vi.fn(() => ({ ok: false, error: 'Use an https:// link.' })) });
    const { user } = renderCard(card({ items: [] }), actions);
    const box = screen.getByText('Any other reusable asset?').parentElement!;
    await user.click(within(box).getByRole('button', { name: 'Add link' }));
    await user.type(within(box).getByPlaceholderText('https://…'), 'http://insecure.test{Enter}');
    expect(actions.stageLink).toHaveBeenCalledWith('card-1', null, 'http://insecure.test');
    expect(within(box).getByText('Use an https:// link.')).toBeInTheDocument();
    expect(within(box).getByPlaceholderText('https://…')).toHaveValue('http://insecure.test');
  });

  it('Cancel closes the link box without staging', async () => {
    const { user, actions } = renderCard(card());
    const row = rowOf('Vendor checklist');
    await user.click(within(row).getByRole('button', { name: 'Add link' }));
    await user.click(within(row).getByRole('button', { name: 'Cancel' }));
    expect(within(row).getByRole('button', { name: 'Upload file' })).toBeInTheDocument();
    expect(actions.stageLink).not.toHaveBeenCalled();
  });

  it('offers the already-uploaded suggested file', async () => {
    const { user, actions } = renderCard(card({ items: [item({ suggestedFile: 'checklist-v2.pdf' })] }));
    await user.click(screen.getByRole('button', { name: 'Use the file you already uploaded: checklist-v2.pdf' }));
    expect(actions.takeSuggested).toHaveBeenCalledWith('card-1', 'row:vendor checklist');
  });

  it('shows a staged file with Change (Section 4 row) and unstages it', async () => {
    const { user, actions } = renderCard(card({ items: [item({ staged: { fileName: 'checklist.pdf' } })] }));
    const row = rowOf('Vendor checklist');
    expect(within(row).getByText('checklist.pdf')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Upload file' })).not.toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Change' }));
    expect(actions.unstage).toHaveBeenCalledWith('card-1', 'row:vendor checklist');
  });

  it('shows a staged link by its domain', () => {
    renderCard(card({ items: [item({ staged: { url: 'https://www.example.org/tool' } })] }));
    expect(screen.getByText('example.org')).toBeInTheDocument();
  });

  it('asks to re-select a staged file no longer held in memory', async () => {
    const { user, actions } = renderCard(
      card({ items: [item({ staged: { fileName: 'checklist.pdf' } })] }),
      makeActions(),
      () => false
    );
    const row = rowOf('Vendor checklist');
    expect(within(row).getByRole('button', { name: 'Select the file again' })).toBeInTheDocument();
    const file = new File(['x'], 'checklist.pdf');
    await user.upload(row.querySelector('input[type=file]') as HTMLInputElement, file);
    expect(actions.stageFiles).toHaveBeenCalledWith('card-1', 'row:vendor checklist', [file]);
  });

  it('lets the contributor title and describe an asset they added', async () => {
    const added = item({ key: 'new:file:x.pdf', name: '', fromSection4: false, staged: { fileName: 'x.pdf' } });
    const { user, actions } = renderCard(card({ items: [added] }));
    await user.type(screen.getByPlaceholderText('What is this asset called?'), 'Z');
    expect(actions.rename).toHaveBeenCalledWith('card-1', 'new:file:x.pdf', 'Z');
    await user.type(screen.getByRole('textbox', { name: /What is it used for\?/ }), 'T');
    expect(actions.describe).toHaveBeenCalledWith('card-1', 'new:file:x.pdf', 'T');
    // An added asset's staged file is removed, not "changed".
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('a Section 4 row is not renamable', () => {
    renderCard(card());
    expect(screen.queryByPlaceholderText('What is this asset called?')).not.toBeInTheDocument();
  });

  it('shows the per-item error carried on the state', () => {
    renderCard(card({ items: [item({ error: 'Upload failed — try again.' })] }));
    expect(screen.getByText('Upload failed — try again.')).toBeInTheDocument();
  });
});

describe('AssetShareCard — shared items', () => {
  const shared = item({
    key: 'new:url:https://x.org',
    name: 'Ward training video',
    fromSection4: false,
    shared: { assetId: 'asset-1', source: { url: 'https://x.org/v' } },
    reuseCondition: 'Use where wards route complaints.',
  });

  it('shows the shared badge, source and reuse condition, and no upload controls', () => {
    renderCard(card({ items: [shared] }));
    const row = rowOf('Ward training video');
    expect(within(row).getByText('Shared · public after approval')).toBeInTheDocument();
    expect(within(row).getByText('x.org')).toBeInTheDocument();
    expect(within(row).getByText('Reuse condition: Use where wards route complaints.')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Upload file' })).not.toBeInTheDocument();
    expect(within(row).queryByPlaceholderText('What is this asset called?')).not.toBeInTheDocument();
  });

  it('Remove calls the action and shows Removing… disabled until it settles', async () => {
    const pending = deferred<{ ok: boolean; error?: string }>();
    const actions = makeActions({ remove: vi.fn(() => pending.promise) });
    const { user } = renderCard(card({ items: [shared] }), actions);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const busy = screen.getByRole('button', { name: 'Removing…' });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(actions.remove).toHaveBeenCalledTimes(1);
    expect(actions.remove).toHaveBeenCalledWith('card-1', 'new:url:https://x.org');
    pending.resolve({ ok: false, error: 'Could not remove.' });
    expect(await screen.findByText('Could not remove.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();
  });
});

describe('AssetShareCard — confirm', () => {
  it('confirms the card', async () => {
    const { user, actions } = renderCard(card());
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(actions.confirm).toHaveBeenCalledWith('card-1');
  });

  it('while confirming: Sharing… disabled, row and extra controls locked, no double submit', async () => {
    const pending = deferred<{ ok: boolean; error?: string }>();
    const actions = makeActions({ confirm: vi.fn(() => pending.promise) });
    const { user } = renderCard(card(), actions);
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    const busy = screen.getByRole('button', { name: 'Sharing…' });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(actions.confirm).toHaveBeenCalledTimes(1);
    // Row controls disappear (row is closed while confirming) …
    expect(within(rowOf('Vendor checklist')).queryByRole('button', { name: 'Upload file' })).not.toBeInTheDocument();
    // … and the "any other" controls are disabled.
    expect(screen.getByRole('button', { name: 'Upload files' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add link' })).toBeDisabled();
    pending.resolve(ok);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled());
  });

  it('shows the confirm error and re-enables Confirm', async () => {
    const actions = makeActions({ confirm: vi.fn(async () => ({ ok: false, error: 'Upload failed for 1 file.' })) });
    const { user } = renderCard(card(), actions);
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Upload failed for 1 file.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });

  it('shows no error text when a failure carries none', async () => {
    const actions = makeActions({ confirm: vi.fn(async () => ({ ok: false })) });
    const { user, container } = renderCard(card(), actions);
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled());
    expect(container.querySelector('.text-coral')).toBeNull();
  });
});

describe('AssetShareCard — confirmed card', () => {
  it('shows Confirmed., Not shared for unshared rows, and no controls', () => {
    renderCard(card({ status: 'confirmed' }));
    expect(screen.getByText('Confirmed.')).toBeInTheDocument();
    expect(screen.getByText('Not shared')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload file' })).not.toBeInTheDocument();
  });

  it('Add more assets reopens the card', async () => {
    const { user, actions } = renderCard(card({ status: 'confirmed' }));
    await user.click(screen.getByRole('button', { name: 'Add more assets' }));
    expect(actions.reopen).toHaveBeenCalledWith('card-1');
  });
});
