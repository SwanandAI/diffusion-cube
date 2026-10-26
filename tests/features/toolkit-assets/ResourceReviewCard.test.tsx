// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deferred } from '../../helpers/ui-fork-http';
import ResourceReviewCard from '@/components/ResourceReviewCard';
import type { ResourceReviewItem, ResourceReviewState } from '@/lib/toolkit-assets';

type Result = { ok: boolean; error?: string };

const FILE_ITEM: ResourceReviewItem = {
  key: 'file:checklist.xlsx',
  name: 'Vendor checklist',
  status: 'pending',
  candidate: { source: { fileName: 'checklist.xlsx' }, name: 'Vendor checklist', purpose: 'Scores vendors' },
};
const LINK_ITEM: ResourceReviewItem = {
  key: 'url:https://www.example.org/tool',
  name: 'IVR tool',
  status: 'pending',
  candidate: { source: { url: 'https://www.example.org/tool' }, name: 'IVR tool' },
};
const MENTION_ITEM: ResourceReviewItem = {
  key: 'mention:training-deck',
  name: 'Training deck',
  status: 'pending',
  mentionedIn: 'report.pdf',
};

function review(items: ResourceReviewItem[], over: Partial<ResourceReviewState> = {}): ResourceReviewState {
  return { id: 'rr-1', items, status: 'open', generateOnComplete: false, ...over };
}

function setup(state: ResourceReviewState, opts: { busy?: boolean; available?: boolean; decide?: (k: string, s: boolean) => Promise<Result>; link?: (k: string | null, u: string) => Result } = {}) {
  const props = {
    onRememberFile: vi.fn(),
    onDecide: vi.fn(opts.decide ?? (async () => ({ ok: true }))),
    onAttach: vi.fn(),
    onLink: vi.fn(opts.link ?? (() => ({ ok: true }))),
    onFinish: vi.fn(),
    fileAvailable: vi.fn(() => opts.available ?? true),
  };
  render(<ResourceReviewCard review={state} busy={opts.busy ?? false} {...props} />);
  return props;
}

const itemRow = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

describe('ResourceReviewCard', () => {
  it('says nothing was found when there are no items, and offers the extra-share box', () => {
    setup(review([]));
    expect(screen.getByText(/We didn't find any reusable files/)).toBeInTheDocument();
    expect(screen.getByText('Anything else to share?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
  });

  it('lists items with source labels and counts undecided ones', () => {
    setup(review([FILE_ITEM, LINK_ITEM, MENTION_ITEM]));
    expect(screen.getByText(/Choose Share or Don't share for each one/)).toBeInTheDocument();
    expect(within(itemRow('Vendor checklist')).getByText('checklist.xlsx')).toBeInTheDocument();
    expect(within(itemRow('Vendor checklist')).getByText('Scores vendors')).toBeInTheDocument();
    expect(within(itemRow('IVR tool')).getByText('example.org')).toBeInTheDocument();
    expect(within(itemRow('Training deck')).getByText('Named in report.pdf, but not attached')).toBeInTheDocument();
    expect(screen.getByText('3 left to decide.')).toBeInTheDocument();
    expect(screen.queryByText('Anything else to share?')).not.toBeInTheDocument();
  });

  it('a mention from the user message says so', () => {
    setup(review([{ ...MENTION_ITEM, mentionedIn: '' }]));
    expect(screen.getByText('Named in your message, but not attached')).toBeInTheDocument();
  });

  it('Share and Don\'t share call onDecide with the item key', async () => {
    const user = userEvent.setup();
    const props = setup(review([FILE_ITEM, LINK_ITEM]));
    await user.click(within(itemRow('Vendor checklist')).getByRole('button', { name: 'Share' }));
    await user.click(within(itemRow('IVR tool')).getByRole('button', { name: "Don't share" }));
    expect(props.onDecide.mock.calls).toEqual([
      ['file:checklist.xlsx', true],
      ['url:https://www.example.org/tool', false],
    ]);
  });

  it('shows a per-item error when deciding fails', async () => {
    const user = userEvent.setup();
    setup(review([FILE_ITEM]), { decide: async () => ({ ok: false, error: 'Storage is full' }) });
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(await within(itemRow('Vendor checklist')).findByText('Storage is full')).toBeInTheDocument();
  });

  it('disables an item while its decision is in flight and ignores a double click', async () => {
    const gate = deferred<Result>();
    const user = userEvent.setup();
    const props = setup(review([FILE_ITEM]), { decide: () => gate.promise });
    await user.click(screen.getByRole('button', { name: 'Share' }));
    const sharing = screen.getByRole('button', { name: 'Sharing…' });
    expect(sharing).toBeDisabled();
    expect(screen.getByRole('button', { name: "Don't share" })).toBeDisabled();
    await user.click(sharing);
    expect(props.onDecide).toHaveBeenCalledTimes(1);
    gate.resolve({ ok: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled());
  });

  it('warns about possibly sensitive content on a pending item', () => {
    setup(review([{ ...FILE_ITEM, candidate: { ...FILE_ITEM.candidate!, sensitiveNote: 'Contains farmer phone numbers.' } }]));
    expect(screen.getByText(/This may contain personal or private data: Contains farmer phone numbers\./)).toBeInTheDocument();
  });

  it.each([
    ['shared', 'Shared · public after approval'],
    ['declined', 'Not shared'],
    ['background', 'Used for the pathway only'],
  ] as const)('a %s item shows its badge and no actions', (status, badge) => {
    setup(review([{ ...FILE_ITEM, status }]));
    expect(within(itemRow('Vendor checklist')).getByText(badge)).toBeInTheDocument();
    expect(within(itemRow('Vendor checklist')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('an item waiting for its check shows a checking note', () => {
    setup(review([{ ...MENTION_ITEM, attachedSource: { fileName: 'deck.pptx' } }]));
    expect(screen.getByText('Checking the file…')).toBeInTheDocument();
  });

  describe('file no longer in memory', () => {
    it('asks to reselect and only accepts the same file name', async () => {
      const user = userEvent.setup();
      const props = setup(review([FILE_ITEM]), { available: false });
      expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
      const row = itemRow('Vendor checklist');
      expect(within(row).getByRole('button', { name: 'Select the file again to share it' })).toBeInTheDocument();
      const input = row.querySelector('input[type=file]') as HTMLInputElement;

      await user.upload(input, new File(['x'], 'other.xlsx'));
      expect(within(row).getByText('Choose the same file: checklist.xlsx')).toBeInTheDocument();
      expect(props.onRememberFile).not.toHaveBeenCalled();

      const right = new File(['x'], 'checklist.xlsx');
      await user.upload(input, right);
      expect(props.onRememberFile).toHaveBeenCalledWith(right);
      expect(within(row).getByRole('button', { name: 'Share' })).toBeInTheDocument();
      expect(within(row).queryByText(/Choose the same file/)).not.toBeInTheDocument();
    });
  });

  describe('mentioned but not attached', () => {
    it('offers attaching a file, a link, or declining', async () => {
      const user = userEvent.setup();
      const props = setup(review([MENTION_ITEM]));
      const row = itemRow('Training deck');
      const file = new File(['deck'], 'training.pptx');
      await user.upload(row.querySelector('input[type=file]') as HTMLInputElement, file);
      expect(props.onAttach).toHaveBeenCalledWith('mention:training-deck', [file]);
      await user.click(within(row).getByRole('button', { name: "Don't share" }));
      expect(props.onDecide).toHaveBeenCalledWith('mention:training-deck', false);
    });

    it('adds a link; an invalid link shows the returned error and keeps the field', async () => {
      const user = userEvent.setup();
      const link = vi
        .fn<(k: string | null, u: string) => Result>()
        .mockReturnValueOnce({ ok: false, error: 'Use an https:// link.' })
        .mockReturnValueOnce({ ok: true });
      const props = setup(review([MENTION_ITEM]), { link });
      const row = itemRow('Training deck');
      await user.click(within(row).getByRole('button', { name: 'Add a link' }));
      const add = within(row).getByRole('button', { name: 'Add' });
      expect(add).toBeDisabled();
      const field = within(row).getByPlaceholderText('https://…');
      await user.type(field, 'http://insecure.example');
      await user.click(add);
      expect(within(row).getByText('Use an https:// link.')).toBeInTheDocument();
      expect(field).toHaveValue('http://insecure.example');
      await user.clear(field);
      await user.type(field, 'https://slides.example.org/deck{Enter}');
      expect(props.onLink).toHaveBeenLastCalledWith('mention:training-deck', 'https://slides.example.org/deck');
      expect(within(row).queryByPlaceholderText('https://…')).not.toBeInTheDocument();
      expect(within(row).queryByText('Use an https:// link.')).not.toBeInTheDocument();
    });

    it('Cancel closes the link field', async () => {
      const user = userEvent.setup();
      setup(review([MENTION_ITEM]));
      await user.click(screen.getByRole('button', { name: 'Add a link' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByPlaceholderText('https://…')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add the file' })).toBeInTheDocument();
    });

    it('disables attach and link while a companion turn is running', () => {
      setup(review([MENTION_ITEM]), { busy: true });
      expect(screen.getByRole('button', { name: 'Add the file' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Add a link' })).toBeDisabled();
    });
  });

  describe('all decided', () => {
    const decided = [{ ...FILE_ITEM, status: 'shared' as const }];

    it('offers adding more files (multiple) and Done', async () => {
      const user = userEvent.setup();
      const props = setup(review(decided));
      expect(screen.queryByText(/left to decide/)).not.toBeInTheDocument();
      const box = screen.getByText('Anything else to share?').parentElement as HTMLElement;
      const input = box.querySelector('input[type=file]') as HTMLInputElement;
      expect(input).toHaveAttribute('multiple');
      const a = new File(['a'], 'a.pdf');
      const b = new File(['b'], 'b.pdf');
      await user.upload(input, [a, b]);
      expect(props.onAttach).toHaveBeenCalledWith(null, [a, b]);
      await user.click(within(box).getByRole('button', { name: 'Add a link' }));
      await user.type(within(box).getByPlaceholderText('https://…'), 'https://x.org{Enter}');
      expect(props.onLink).toHaveBeenCalledWith(null, 'https://x.org');
      await user.click(within(box).getByRole('button', { name: 'Done' }));
      expect(props.onFinish).toHaveBeenCalledTimes(1);
    });

    it('legacy reviews label Done as drafting the pathway', () => {
      setup(review(decided, { generateOnComplete: true }));
      expect(screen.getByRole('button', { name: 'Done — draft my pathway' })).toBeInTheDocument();
    });

    it('Done is disabled while busy', () => {
      setup(review(decided), { busy: true });
      expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
    });
  });

  it('a completed review says All done and offers no actions', () => {
    setup(review([FILE_ITEM], { status: 'complete' }));
    expect(screen.getByText('All done.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
