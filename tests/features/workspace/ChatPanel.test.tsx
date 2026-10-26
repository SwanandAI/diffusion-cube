// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Keeps pdfjs/mammoth/xlsx out of the test; ChatPanel only needs the accept list.
vi.mock('@/lib/extract-text', () => ({ ATTACH_ACCEPT: '.pdf,.docx,.txt' }));
vi.mock('@/components/ToolkitAssetCards', () => ({
  default: ({ ids }: { ids: string[] }) => <div data-testid="asset-cards">{ids.join(',')}</div>,
}));
vi.mock('@/components/AssetShareCard', () => ({
  default: ({ card, fileAvailable }: { card: { id: string }; fileAvailable: (f: string) => boolean }) => (
    <div data-testid="asset-share-card">
      {card.id}:{String(fileAvailable('a.pdf'))}
    </div>
  ),
}));

import ChatPanel, { type Message, type PendingAttachment } from '@/components/ChatPanel';
import { ANALYSIS_DOC_MARKER, EXEC_SUMMARY_MARKER, PATHWAY_DOC_MARKER } from '@/lib/grid-update';
import type { AssetShareActions } from '@/components/AssetShareCard';
import { stubScrollIntoView } from '../../helpers/ui-dom';

beforeAll(stubScrollIntoView);

type Props = Parameters<typeof ChatPanel>[0];

function renderPanel(props: Partial<Props> = {}) {
  const onSend = vi.fn();
  const utils = render(<ChatPanel messages={[]} onSend={onSend} loading={false} {...props} />);
  return { onSend, ...utils };
}

const textbox = () => screen.getByRole('textbox');
const sendButton = () => screen.getByRole('button', { name: 'Send' });

describe('ChatPanel — messages', () => {
  it('renders user and assistant bubbles, skipping hidden ones', () => {
    renderPanel({
      messages: [
        { role: 'user', content: 'How do I pilot voice AI?' },
        { role: 'assistant', content: 'internal note', hidden: true },
        { role: 'assistant', content: 'Start with a small district.' },
      ],
    });
    expect(screen.getByText('How do I pilot voice AI?')).toBeInTheDocument();
    expect(screen.getByText('Start with a small district.')).toBeInTheDocument();
    expect(screen.queryByText('internal note')).not.toBeInTheDocument();
  });

  it('shows displayContent instead of content (uploads)', () => {
    renderPanel({ messages: [{ role: 'user', content: 'FULL EXTRACTED TEXT', displayContent: '📄 report.pdf' }] });
    expect(screen.getByText('📄 report.pdf')).toBeInTheDocument();
    expect(screen.queryByText('FULL EXTRACTED TEXT')).not.toBeInTheDocument();
  });

  it('strips the legacy <cube_grid/> marker', () => {
    renderPanel({ messages: [{ role: 'assistant', content: 'Before<cube_grid/>After' }] });
    expect(screen.getByText('BeforeAfter')).toBeInTheDocument();
  });

  it('renders **bold** in plain messages', () => {
    renderPanel({ messages: [{ role: 'assistant', content: 'This is **important** stuff' }] });
    expect(screen.getByText('important').tagName).toBe('STRONG');
  });

  it('renders a notice bubble like any other assistant message', () => {
    renderPanel({ messages: [{ role: 'assistant', content: 'Something went wrong. Please try again.', notice: true }] });
    expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('handles a very long message without crashing', () => {
    const long = 'word '.repeat(5000).trim();
    renderPanel({ messages: [{ role: 'user', content: long }] });
    expect(screen.getByText(long)).toBeInTheDocument();
  });

  describe('accuracy disclaimer', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'first' },
      { role: 'assistant', content: 'second' },
    ];

    it('appears once, under the first assistant message', () => {
      renderPanel({ messages: msgs });
      expect(screen.getAllByText(/The Cube does not validate or guarantee its accuracy/)).toHaveLength(1);
      const firstBubble = screen.getByText('first').closest('div') as HTMLElement;
      expect(within(firstBubble).getByText('Note:')).toBeInTheDocument();
    });

    it('is hidden when hideAccuracyDisclaimer is set', () => {
      renderPanel({ messages: msgs, hideAccuracyDisclaimer: true });
      expect(screen.queryByText('Note:')).not.toBeInTheDocument();
    });

    it('does not appear with no assistant messages', () => {
      renderPanel({ messages: [{ role: 'user', content: 'hi' }] });
      expect(screen.queryByText('Note:')).not.toBeInTheDocument();
    });
  });

  describe('document cards and rich markdown', () => {
    it('renders a Pathway Document card for the contributor flow', async () => {
      const user = userEvent.setup();
      const onOpenPathwayDocument = vi.fn();
      renderPanel({
        onOpenPathwayDocument,
        messages: [{ role: 'assistant', content: `Here is your draft.\n${PATHWAY_DOC_MARKER}\nTake a look.` }],
      });
      expect(screen.getByText('Pathway Document')).toBeInTheDocument();
      expect(screen.getByText('Here is your draft.')).toBeInTheDocument();
      expect(screen.getByText('Take a look.')).toBeInTheDocument();
      expect(screen.queryByText(PATHWAY_DOC_MARKER)).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'View Pathway Document' }));
      expect(onOpenPathwayDocument).toHaveBeenCalledTimes(1);
    });

    it('does not render a doc card in a user message', () => {
      renderPanel({ onOpenPathwayDocument: vi.fn(), messages: [{ role: 'user', content: `x ${PATHWAY_DOC_MARKER}` }] });
      expect(screen.queryByRole('button', { name: 'View Pathway Document' })).not.toBeInTheDocument();
    });

    it('opens the analysis document or executive summary for the explorer flow', async () => {
      const user = userEvent.setup();
      const onOpenExplorerDocument = vi.fn();
      renderPanel({
        onOpenExplorerDocument,
        messages: [
          { role: 'assistant', content: ANALYSIS_DOC_MARKER },
          { role: 'assistant', content: EXEC_SUMMARY_MARKER },
        ],
      });
      await user.click(screen.getByRole('button', { name: 'View Analysis Document' }));
      await user.click(screen.getByRole('button', { name: 'View Executive Summary' }));
      expect(onOpenExplorerDocument.mock.calls).toEqual([['analysis'], ['plan']]);
    });

    it('renders headings, bullets, rules, links and nested emphasis in a rich message', () => {
      const content = [
        '## Next steps',
        '### Detail',
        '- First **bold** item',
        '- Second item',
        '---',
        'See [the guide](https://example.org/guide) or https://example.org/raw.',
        '*an italic line with a **bold name** inside*',
        PATHWAY_DOC_MARKER,
      ].join('\n');
      renderPanel({ onOpenPathwayDocument: vi.fn(), messages: [{ role: 'assistant', content }] });
      expect(screen.getByRole('heading', { level: 2, name: 'Next steps' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 3, name: 'Detail' })).toBeInTheDocument();
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
      expect(screen.getByText('bold').tagName).toBe('STRONG');
      expect(screen.getByRole('separator')).toBeInTheDocument();
      const guide = screen.getByRole('link', { name: 'the guide' });
      expect(guide).toHaveAttribute('href', 'https://example.org/guide');
      expect(guide).toHaveAttribute('target', '_blank');
      expect(guide).toHaveAttribute('rel', 'noopener noreferrer');
      // Trailing sentence punctuation is not swallowed into a bare URL.
      expect(screen.getByRole('link', { name: 'https://example.org/raw' })).toHaveAttribute('href', 'https://example.org/raw');
      const name = screen.getByText('bold name');
      expect(name.tagName).toBe('STRONG');
      expect(name.parentElement?.tagName).toBe('EM');
    });

    it('does not link non-http [label](url) syntax', () => {
      renderPanel({
        onOpenPathwayDocument: vi.fn(),
        messages: [{ role: 'assistant', content: `[click](javascript:alert(1)) ${PATHWAY_DOC_MARKER}` }],
      });
      expect(screen.queryByRole('link', { name: 'click' })).not.toBeInTheDocument();
    });
  });

  describe('sources', () => {
    const lookup = {
      'kisan-voice': {
        title: 'Kisan Voice',
        description: 'Voice advisory for farmers.',
        sector: 'Agriculture',
        stage: 'Scale',
        contributor: 'EkStep',
        timestamp: '2026-09-01',
      },
    };

    it('lists referenced pathways by title and falls back to the slug', () => {
      renderPanel({
        pathwayLookup: lookup,
        messages: [{ role: 'assistant', content: 'answer', pathwaysReferenced: ['kisan-voice', 'unknown-slug'] }],
      });
      expect(screen.getByText('Sources')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Kisan Voice/ })).toHaveTextContent('· EkStep');
      expect(screen.getByRole('button', { name: /unknown-slug/ })).toBeInTheDocument();
    });

    it('ignores pathwaysReferenced on a user message', () => {
      renderPanel({ messages: [{ role: 'user', content: 'q', pathwaysReferenced: ['kisan-voice'] }] });
      expect(screen.queryByText('Sources')).not.toBeInTheDocument();
    });

    it('opens a details popup and closes it via the close button or backdrop', async () => {
      const user = userEvent.setup();
      renderPanel({
        pathwayLookup: lookup,
        messages: [{ role: 'assistant', content: 'answer', pathwaysReferenced: ['kisan-voice'] }],
      });
      await user.click(screen.getByRole('button', { name: /Kisan Voice/ }));
      expect(screen.getByRole('heading', { name: 'Kisan Voice' })).toBeInTheDocument();
      expect(screen.getByText('Voice advisory for farmers.')).toBeInTheDocument();
      expect(screen.getByText('Scale')).toBeInTheDocument();
      expect(screen.getByText('2026-09-01')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('heading', { name: 'Kisan Voice' })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /Kisan Voice/ }));
      // Clicking inside the popup keeps it open.
      await user.click(screen.getByText('Voice advisory for farmers.'));
      expect(screen.getByRole('heading', { name: 'Kisan Voice' })).toBeInTheDocument();
      const backdrop = screen.getByRole('heading', { name: 'Kisan Voice' }).closest('.fixed') as HTMLElement;
      await user.click(backdrop);
      expect(screen.queryByRole('heading', { name: 'Kisan Voice' })).not.toBeInTheDocument();
    });

    it('a popup for an unknown slug shows the slug as the title', async () => {
      const user = userEvent.setup();
      renderPanel({ messages: [{ role: 'assistant', content: 'a', pathwaysReferenced: ['mystery'] }] });
      await user.click(screen.getByRole('button', { name: /mystery/ }));
      expect(screen.getByRole('heading', { name: 'mystery' })).toBeInTheDocument();
    });
  });

  it('renders toolkit asset download cards under an assistant message', () => {
    renderPanel({ messages: [{ role: 'assistant', content: 'a', toolkitAssetsReferenced: ['asset-1', 'asset-2'] }] });
    expect(screen.getByTestId('asset-cards')).toHaveTextContent('asset-1,asset-2');
  });

  describe('contributor cards', () => {
    it('hides card messages when their handlers are missing', () => {
      renderPanel({
        messages: [
          { role: 'assistant', content: '', resourceReview: { id: 'r', items: [], status: 'open', generateOnComplete: false } },
          { role: 'assistant', content: '', publishConsent: { id: 'p', status: 'pending' } },
          { role: 'assistant', content: '', assetShare: { id: 'a', items: [], status: 'open', noneInSection4: true } },
          {
            role: 'assistant',
            content: '',
            toolkitAssetConsent: { id: 't', status: 'pending', candidate: { source: { url: 'https://x.org' }, name: 'X' } },
          },
        ],
      });
      expect(screen.queryByText('Files other teams can reuse')).not.toBeInTheDocument();
      expect(screen.queryByText('Ready to send for review?')).not.toBeInTheDocument();
      expect(screen.queryByTestId('asset-share-card')).not.toBeInTheDocument();
      expect(screen.queryByText('X')).not.toBeInTheDocument();
    });

    it('routes the publish consent answer with the consent id', async () => {
      const user = userEvent.setup();
      const onPublishConsent = vi.fn(async () => ({ ok: true }));
      renderPanel({ onPublishConsent, messages: [{ role: 'assistant', content: '', publishConsent: { id: 'pc-9', status: 'pending' } }] });
      await user.click(screen.getByRole('button', { name: 'No, keep it as a private draft' }));
      expect(onPublishConsent).toHaveBeenCalledWith('pc-9', 'keep');
    });

    it('routes resource review actions with the review id', async () => {
      const user = userEvent.setup();
      const actions = {
        decide: vi.fn(async () => ({ ok: true })),
        attach: vi.fn(),
        link: vi.fn(() => ({ ok: true })),
        finish: vi.fn(),
        rememberFile: vi.fn(),
      };
      renderPanel({
        resourceReviewActions: actions,
        hasToolkitAssetFile: () => true,
        messages: [
          {
            role: 'assistant',
            content: '',
            resourceReview: {
              id: 'rr-7',
              status: 'open',
              generateOnComplete: false,
              items: [
                { key: 'file:a.pdf', name: 'A', status: 'pending', candidate: { source: { fileName: 'a.pdf' }, name: 'A' } },
              ],
            },
          },
        ],
      });
      await user.click(screen.getByRole('button', { name: 'Share' }));
      expect(actions.decide).toHaveBeenCalledWith('rr-7', 'file:a.pdf', true);
    });

    it('passes the asset card and file availability through', () => {
      renderPanel({
        assetShareActions: {} as AssetShareActions,
        hasToolkitAssetFile: (f) => f === 'a.pdf',
        messages: [{ role: 'assistant', content: '', assetShare: { id: 'as-1', items: [], status: 'open', noneInSection4: true } }],
      });
      expect(screen.getByTestId('asset-share-card')).toHaveTextContent('as-1:true');
    });

    it('legacy toolkit consent: file availability comes from hasToolkitAssetFile; answer carries the consent id', async () => {
      const user = userEvent.setup();
      const onToolkitAssetConsent = vi.fn(async () => ({ ok: true }));
      renderPanel({
        onToolkitAssetConsent,
        hasToolkitAssetFile: () => false,
        messages: [
          {
            role: 'assistant',
            content: '',
            toolkitAssetConsent: { id: 'tc-3', status: 'pending', candidate: { source: { fileName: 'f.xlsx' }, name: 'Sheet' } },
          },
        ],
      });
      expect(screen.getByRole('button', { name: 'Yes, share' })).toBeDisabled();
      await user.click(screen.getByRole('button', { name: 'No' }));
      expect(onToolkitAssetConsent).toHaveBeenCalledWith('tc-3', false);
    });
  });
});

describe('ChatPanel — composer', () => {
  it('Send is disabled for empty or whitespace input', async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(sendButton()).toBeDisabled();
    await user.type(textbox(), '   ');
    expect(sendButton()).toBeDisabled();
  });

  it('sends trimmed text on click and clears the box', async () => {
    const user = userEvent.setup();
    const { onSend } = renderPanel();
    await user.type(textbox(), '  What about scale?  ');
    await user.click(sendButton());
    expect(onSend).toHaveBeenCalledWith('What about scale?');
    expect(textbox()).toHaveValue('');
  });

  it('Enter sends, Shift+Enter adds a newline', async () => {
    const user = userEvent.setup();
    const { onSend } = renderPanel();
    await user.type(textbox(), 'line one{Shift>}{Enter}{/Shift}line two');
    expect(onSend).not.toHaveBeenCalled();
    expect(textbox()).toHaveValue('line one\nline two');
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledWith('line one\nline two');
  });

  it('Enter on an empty box sends nothing', async () => {
    const user = userEvent.setup();
    const { onSend } = renderPanel();
    await user.click(textbox());
    await user.keyboard('{Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('while loading: textarea and Send disabled, Thinking… shown', () => {
    renderPanel({ loading: true });
    expect(textbox()).toBeDisabled();
    expect(sendButton()).toBeDisabled();
    expect(screen.getByText('Thinking…')).toBeInTheDocument();
  });

  it('shows Generating document… while a document is generating', () => {
    renderPanel({ loading: true, generatingDoc: true });
    expect(screen.getByText('Generating document…')).toBeInTheDocument();
    expect(screen.queryByText('Thinking…')).not.toBeInTheDocument();
  });

  it('shows the background draft note without blocking the composer', async () => {
    const user = userEvent.setup();
    const { onSend } = renderPanel({ writingDraft: true });
    expect(screen.getByText(/Writing the pathway document/)).toBeInTheDocument();
    await user.type(textbox(), 'keep going{Enter}');
    expect(onSend).toHaveBeenCalledWith('keep going');
  });

  it('uses a custom placeholder', () => {
    renderPanel({ placeholder: 'Describe your deployment…' });
    expect(screen.getByPlaceholderText('Describe your deployment…')).toBeInTheDocument();
  });

  describe('attachments', () => {
    const att = (state: PendingAttachment['state'], id = state): PendingAttachment => ({ id, name: `${id}.pdf`, state });

    it('blocks sending while an attachment is still reading, even with text', async () => {
      const user = userEvent.setup();
      const { onSend } = renderPanel({ pendingAttachments: [att('reading')] });
      await user.type(textbox(), 'Here is my report{Enter}');
      expect(sendButton()).toBeDisabled();
      expect(onSend).not.toHaveBeenCalled();
    });

    it('blocks sending while an attachment errored', async () => {
      const user = userEvent.setup();
      renderPanel({ pendingAttachments: [att('ready'), att('error')] });
      await user.type(textbox(), 'text');
      expect(sendButton()).toBeDisabled();
    });

    it('a ready attachment alone allows sending with empty text', async () => {
      const user = userEvent.setup();
      const { onSend } = renderPanel({ pendingAttachments: [att('ready')] });
      expect(sendButton()).toBeEnabled();
      await user.click(sendButton());
      expect(onSend).toHaveBeenCalledWith('');
    });

    it('shows chips with state icons; remove is disabled while reading', async () => {
      const user = userEvent.setup();
      const onRemoveAttachment = vi.fn();
      renderPanel({ pendingAttachments: [att('reading'), att('ready'), att('error')], onRemoveAttachment });
      expect(screen.getByText(/⏳ reading\.pdf/)).toBeInTheDocument();
      expect(screen.getByText(/📎 ready\.pdf/)).toBeInTheDocument();
      expect(screen.getByText(/⚠️ error\.pdf/)).toBeInTheDocument();
      const removes = screen.getAllByRole('button', { name: '✕' });
      expect(removes[0]).toBeDisabled();
      await user.click(removes[2]);
      expect(onRemoveAttachment).toHaveBeenCalledWith('error');
    });

    it('chips have no remove control without onRemoveAttachment', () => {
      renderPanel({ pendingAttachments: [att('ready')] });
      expect(screen.queryByRole('button', { name: '✕' })).not.toBeInTheDocument();
    });

    it('the composer attach button forwards picked files and uses the accept list', async () => {
      const user = userEvent.setup();
      const onAttachFiles = vi.fn();
      const { container } = renderPanel({ onAttachFiles, attachAccept: '.pdf,.xlsx' });
      const input = container.querySelector('input[type=file]') as HTMLInputElement;
      expect(input).toHaveAttribute('accept', '.pdf,.xlsx');
      const file = new File(['%PDF'], 'plan.pdf', { type: 'application/pdf' });
      await user.upload(input, file);
      expect(onAttachFiles).toHaveBeenCalledWith([file]);
    });

    it('no attach button without onAttachFiles; disabled while loading', () => {
      const { unmount } = renderPanel();
      expect(screen.queryByRole('button', { name: 'Attach files' })).not.toBeInTheDocument();
      unmount();
      renderPanel({ onAttachFiles: vi.fn(), loading: true });
      expect(screen.getByRole('button', { name: 'Attach files' })).toBeDisabled();
    });
  });
});
