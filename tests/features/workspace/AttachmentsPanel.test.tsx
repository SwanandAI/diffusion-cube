// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/extract-text', () => ({ ATTACH_ACCEPT: '.pdf,.docx' }));

import AttachmentsPanel from '@/components/AttachmentsPanel';
import type { PendingAttachment } from '@/components/ChatPanel';

type Props = Parameters<typeof AttachmentsPanel>[0];

function renderPanel(props: Partial<Props> = {}) {
  const onAttachFiles = vi.fn();
  const onRemoveAttachment = vi.fn();
  const utils = render(
    <AttachmentsPanel attachments={[]} onAttachFiles={onAttachFiles} onRemoveAttachment={onRemoveAttachment} {...props} />
  );
  const dropzone = screen.getByText('📎 Attach files, or drag and drop').parentElement as HTMLElement;
  const input = utils.container.querySelector('input[type=file]') as HTMLInputElement;
  return { onAttachFiles, onRemoveAttachment, dropzone, input, ...utils };
}

function dataTransfer(files: File[], types = ['Files']) {
  return { files, types };
}

describe('AttachmentsPanel', () => {
  it('uses the default accept list, or the one given', () => {
    const { input, unmount } = renderPanel();
    expect(input).toHaveAttribute('accept', '.pdf,.docx');
    expect(input).toHaveAttribute('multiple');
    unmount();
    const { input: input2 } = renderPanel({ accept: '.pdf,.zip' });
    expect(input2).toHaveAttribute('accept', '.pdf,.zip');
  });

  it('forwards picked files', async () => {
    const user = userEvent.setup();
    const { input, onAttachFiles } = renderPanel();
    const files = [new File(['a'], 'a.pdf'), new File(['b'], 'b.docx')];
    await user.upload(input, files);
    expect(onAttachFiles).toHaveBeenCalledWith(files);
  });

  it('highlights while dragging files over and forwards dropped files', () => {
    const { dropzone, onAttachFiles } = renderPanel();
    const file = new File(['x'], 'drop.pdf');
    fireEvent.dragEnter(dropzone, { dataTransfer: dataTransfer([file]) });
    expect(dropzone.className).toContain('border-coral');
    fireEvent.drop(dropzone, { dataTransfer: dataTransfer([file]) });
    expect(dropzone.className).not.toContain('border-coral bg-coral-soft');
    expect(onAttachFiles).toHaveBeenCalledWith([file]);
  });

  it('does not highlight for a non-file drag (e.g. text)', () => {
    const { dropzone } = renderPanel();
    fireEvent.dragEnter(dropzone, { dataTransfer: dataTransfer([], ['text/plain']) });
    expect(dropzone.className).not.toContain('bg-coral-soft');
  });

  it('keeps the highlight across nested dragenter/leave pairs until the last leave', () => {
    const { dropzone } = renderPanel();
    const dt = dataTransfer([]);
    fireEvent.dragEnter(dropzone, { dataTransfer: dt });
    fireEvent.dragEnter(dropzone, { dataTransfer: dt });
    fireEvent.dragLeave(dropzone, { dataTransfer: dt });
    expect(dropzone.className).toContain('bg-coral-soft');
    fireEvent.dragLeave(dropzone, { dataTransfer: dt });
    expect(dropzone.className).not.toContain('bg-coral-soft');
    // Extra leaves never push the counter negative.
    fireEvent.dragLeave(dropzone, { dataTransfer: dt });
    fireEvent.dragEnter(dropzone, { dataTransfer: dt });
    expect(dropzone.className).toContain('bg-coral-soft');
  });

  it('an empty drop forwards nothing', () => {
    const { dropzone, onAttachFiles } = renderPanel();
    fireEvent.drop(dropzone, { dataTransfer: dataTransfer([]) });
    expect(onAttachFiles).not.toHaveBeenCalled();
  });

  it('lists staged attachments with their state; errors show the reason', async () => {
    const user = userEvent.setup();
    const attachments: PendingAttachment[] = [
      { id: '1', name: 'reading.pdf', state: 'reading' },
      { id: '2', name: 'ready.pdf', state: 'ready' },
      { id: '3', name: 'bad.exe', state: 'error', error: 'Unsupported file type' },
    ];
    const { onRemoveAttachment } = renderPanel({ attachments });
    expect(screen.getByText(/⏳ reading\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/📎 ready\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/⚠️ bad\.exe — Unsupported file type/)).toBeInTheDocument();
    const removes = screen.getAllByRole('button', { name: '✕' });
    expect(removes[0]).toBeDisabled();
    await user.click(removes[1]);
    expect(onRemoveAttachment).toHaveBeenCalledWith('2');
  });

  it('lists previously shared files once each', () => {
    renderPanel({ uploadedFileNames: ['plan.pdf', 'plan.pdf', 'notes.docx'] });
    expect(screen.getByText('Shared in this chat')).toBeInTheDocument();
    expect(screen.getAllByText(/✓ /)).toHaveLength(2);
    expect(screen.queryByText('Not stored')).not.toBeInTheDocument();
  });

  it('contributor: stored assets get a Download link, others say Not stored', () => {
    renderPanel({
      uploadedFileNames: ['checklist.xlsx', 'report.pdf'],
      viewableFiles: { 'checklist.xlsx': 'asset-abc' },
    });
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/api/toolkit-assets/asset-abc/download');
    expect(screen.getByText('Not stored')).toBeInTheDocument();
  });

  it('shows no lists when there is nothing staged or shared', () => {
    renderPanel();
    expect(screen.queryByText('Shared in this chat')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '✕' })).not.toBeInTheDocument();
  });
});
