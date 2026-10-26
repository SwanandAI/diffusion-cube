// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createSupabaseMock } from '../../helpers/supabase-mock';
import { jsonResponse, stubFetch } from '../../helpers/ui-fork-http';

// The workspace is a view over useAdoptionConversation (2.5k lines, its own
// tests elsewhere). Here the hook is replaced by a plain object each test
// shapes, so these tests cover only what the workspace itself decides:
// which screen, which header buttons, which panel, and which hook action a
// click reaches.
vi.mock('@/lib/adoption-conversation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/adoption-conversation')>();
  return { ...actual, useAdoptionConversation: vi.fn() };
});
vi.mock('@/lib/adoption-plan-pdf', () => ({ downloadPlanAsPdf: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import {
  EMPTY_EXPLORER_DOC,
  EMPTY_GRID,
  EMPTY_META,
  EMPTY_PATHWAY_DOC,
  useAdoptionConversation,
  type AdoptionConversation,
  type AdoptionMeta,
} from '@/lib/adoption-conversation';
import { createClient } from '@/lib/supabase/client';
import AdoptionWorkspace from '@/components/AdoptionWorkspace';
import type { Message, PendingAttachment } from '@/components/ChatPanel';
import type { DesignDocumentRow } from '@/lib/design-documents';

type Hook = ReturnType<typeof useAdoptionConversation>;

function makeHook(over: Partial<Hook> = {}): Hook {
  const ok = async () => ({ ok: true });
  const base = {
    conversation: null,
    loading: false,
    pendingAttachments: [] as PendingAttachment[],
    handleUserSend: vi.fn(async () => {}),
    handleAttachFiles: vi.fn(),
    removeAttachment: vi.fn(),
    hasToolkitAssetFile: vi.fn(() => true),
    rememberToolkitAssetFile: vi.fn(),
    answerToolkitAssetConsent: vi.fn(ok),
    decideResourceItem: vi.fn(ok),
    attachForResourceItem: vi.fn(),
    linkForResourceItem: vi.fn(() => ({ ok: true })),
    finishResourceReview: vi.fn(async () => {}),
    stageAssetFiles: vi.fn(() => ({ ok: true })),
    stageAssetLink: vi.fn(() => ({ ok: true })),
    takeSuggestedAssetFile: vi.fn(() => ({ ok: true })),
    unstageAsset: vi.fn(),
    renameAsset: vi.fn(),
    describeAsset: vi.fn(),
    removeSharedAsset: vi.fn(ok),
    confirmAssetCard: vi.fn(ok),
    confirmOpenAssetCards: vi.fn(ok),
    stageAssetFilesFromList: vi.fn(() => ({ ok: true })),
    deleteAsset: vi.fn(ok),
    reopenAssetCard: vi.fn(),
    requestPublishConsent: vi.fn(ok),
    answerPublishConsent: vi.fn(ok),
    toolkitAssetsVersion: 0,
    pathwayDoc: EMPTY_PATHWAY_DOC,
    pathwayPreview: null,
    openPathwayDocument: vi.fn(),
    closePathwayDocument: vi.fn(),
    selectPathwayDocVersion: vi.fn(),
    explorerDoc: EMPTY_EXPLORER_DOC,
    openExplorerDocument: vi.fn(),
    closeExplorerDocument: vi.fn(),
  };
  return { ...base, ...over } as unknown as Hook;
}

function conversation(meta: Partial<AdoptionMeta>, messages: Message[] = []): AdoptionConversation {
  return {
    id: 'conv-1',
    meta: { ...EMPTY_META, ...meta },
    grid: EMPTY_GRID,
    messages,
    updatedAt: '2026-10-01T00:00:00Z',
  };
}

function docRow(id: string, version: number, content = `# Draft v${version}`): DesignDocumentRow {
  return {
    id,
    design_id: 'conv-1',
    doc_type: 'draft',
    version_number: version,
    content_hash: 'h',
    content,
    created_at: '2026-10-01T00:00:00Z',
  };
}

let hook: Hook;
let fetchCalls: ReturnType<typeof stubFetch>['calls'];

function useHook(over: Partial<Hook> = {}) {
  hook = makeHook(over);
  vi.mocked(useAdoptionConversation).mockReturnValue(hook);
  return hook;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(createClient).mockReturnValue(createSupabaseMock().client);
  fetchCalls = stubFetch((call) =>
    call.url === '/api/wiki-pathways'
      ? jsonResponse([{ slug: 'kisan-voice', title: 'Kisan Voice', contributor: 'Digital Green' }])
      : undefined
  ).calls;
  useHook();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AdoptionWorkspace — before a conversation exists', () => {
  it('passes initial/pathwayId/callbacks to the hook and loads the pathway lookup once', async () => {
    const onCreated = vi.fn();
    render(<AdoptionWorkspace initial={null} pathwayId="p1" onCreated={onCreated} fixedFlow="explorer" />);
    expect(useAdoptionConversation).toHaveBeenCalledWith(
      expect.objectContaining({ initial: null, pathwayId: 'p1', onCreated })
    );
    await waitFor(() => expect(fetchCalls.filter((c) => c.url === '/api/wiki-pathways')).toHaveLength(1));
  });

  it('explorer welcome: Start is disabled until there is text, then sends with intent "open"', async () => {
    const user = userEvent.setup();
    render(<AdoptionWorkspace initial={null} fixedFlow="explorer" />);
    expect(screen.getByText('Analyse your own adoption')).toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'Start' });
    expect(start).toBeDisabled();
    await user.type(screen.getByPlaceholderText(/Describe your adoption, ask a question/), '  We run a voice bot  ');
    expect(start).toBeEnabled();
    await user.click(start);
    expect(hook.handleUserSend).toHaveBeenCalledWith('We run a voice bot', 'explorer', 'open');
    expect(screen.getByPlaceholderText(/Describe your adoption, ask a question/)).toHaveValue('');
  });

  it('explorer welcome: whitespace-only text cannot start', async () => {
    const user = userEvent.setup();
    render(<AdoptionWorkspace initial={null} fixedFlow="explorer" />);
    await user.type(screen.getByPlaceholderText(/Describe your adoption, ask a question/), '   ');
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('explorer welcome: Enter starts; Shift+Enter does not', async () => {
    const user = userEvent.setup();
    render(<AdoptionWorkspace initial={null} fixedFlow="explorer" />);
    const box = screen.getByPlaceholderText(/Describe your adoption, ask a question/);
    await user.type(box, 'hello{Shift>}{Enter}{/Shift}');
    expect(hook.handleUserSend).not.toHaveBeenCalled();
    await user.type(box, '{Enter}');
    expect(hook.handleUserSend).toHaveBeenCalledTimes(1);
  });

  it('explorer welcome: an attachment still reading blocks Start; a ready one alone allows it', async () => {
    const user = userEvent.setup();
    useHook({ pendingAttachments: [{ id: 'a1', name: 'plan.pdf', state: 'reading' }] });
    const { unmount } = render(<AdoptionWorkspace initial={null} fixedFlow="explorer" />);
    await user.type(screen.getByPlaceholderText(/Describe your adoption, ask a question/), 'text');
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    // A reading attachment can't be removed yet.
    expect(screen.getByRole('button', { name: '✕' })).toBeDisabled();
    unmount();

    useHook({ pendingAttachments: [{ id: 'a1', name: 'plan.pdf', state: 'ready' }] });
    render(<AdoptionWorkspace initial={null} fixedFlow="explorer" />);
    const start = screen.getByRole('button', { name: 'Start' });
    expect(start).toBeEnabled();
    await user.click(start);
    expect(hook.handleUserSend).toHaveBeenCalledWith('', 'explorer', 'open');
  });

  it('explorer welcome: shows an attachment error and lets it be removed', async () => {
    const user = userEvent.setup();
    useHook({ pendingAttachments: [{ id: 'a9', name: 'scan.pdf', state: 'error', error: 'No text layer' }] });
    render(<AdoptionWorkspace initial={null} fixedFlow="explorer" />);
    expect(screen.getByText(/scan\.pdf — No text layer/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '✕' }));
    expect(hook.removeAttachment).toHaveBeenCalledWith('a9');
  });

  it('explorer welcome: Start is disabled while the hook is loading', async () => {
    useHook({ loading: true });
    render(<AdoptionWorkspace initial={null} fixedFlow="explorer" />);
    expect(screen.getByPlaceholderText(/Describe your adoption, ask a question/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('explorer welcome: attaching files goes to the hook with the explorer flow', async () => {
    const user = userEvent.setup();
    const { container } = render(<AdoptionWorkspace initial={null} fixedFlow="explorer" />);
    const file = new File(['x'], 'brief.pdf');
    await user.upload(container.querySelector('input[type=file]') as HTMLInputElement, file);
    expect(hook.handleAttachFiles).toHaveBeenCalledWith([file], 'explorer', 'open');
  });

  it('contributor pre-chat: shows the opening message and sends with the contributor flow', async () => {
    const user = userEvent.setup();
    render(<AdoptionWorkspace initial={null} fixedFlow="contributor" />);
    expect(screen.getByText(/Please share your deployment documents/)).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('Ask, share, or think out loud…'), 'Our project{Enter}');
    expect(hook.handleUserSend).toHaveBeenCalledWith('Our project', 'contributor', '');
  });

  it('contributor pre-chat: Back links to /contribute without onBack, or calls onBack', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AdoptionWorkspace initial={null} fixedFlow="contributor" />);
    expect(screen.getByRole('link', { name: /Back/ })).toHaveAttribute('href', '/contribute');
    unmount();
    const onBack = vi.fn();
    render(<AdoptionWorkspace initial={null} fixedFlow="contributor" onBack={onBack} />);
    await user.click(screen.getByRole('button', { name: /Back/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it('contributor pre-chat: shows the joined pathway preview', () => {
    useHook({
      pathwayPreview: { title: 'Voice AI for Agriculture', sector: 'Agriculture', description: 'Advisory by phone' },
    } as Partial<Hook>);
    render(<AdoptionWorkspace initial={null} fixedFlow="contributor" />);
    expect(screen.getByRole('heading', { name: 'Voice AI for Agriculture' })).toBeInTheDocument();
    expect(screen.getByText('Advisory by phone')).toBeInTheDocument();
  });

  it('contributor pre-chat: Grid toggles the coverage panel', async () => {
    const user = userEvent.setup();
    render(<AdoptionWorkspace initial={null} fixedFlow="contributor" />);
    await user.click(screen.getByRole('button', { name: '▦ Grid' }));
    expect(screen.getByText('Coverage grid')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(screen.queryByText('Coverage grid')).not.toBeInTheDocument();
  });

  it('contributor pre-chat: Project files opens and closes the files popup', async () => {
    const user = userEvent.setup();
    render(<AdoptionWorkspace initial={null} fixedFlow="contributor" />);
    await user.click(screen.getByRole('button', { name: '📎 Project files' }));
    const close = screen.getByRole('button', { name: 'Close' });
    await user.click(close);
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('no fixed flow and no roles: tells the user to ask an admin', () => {
    render(<AdoptionWorkspace initial={null} />);
    expect(screen.getByText('Ask an admin to grant you Explorer or Contributor access to get started.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
  });

  it('no fixed flow and no roles: Enter does not send (no default flow)', async () => {
    const user = userEvent.setup();
    render(<AdoptionWorkspace initial={null} />);
    await user.type(screen.getByPlaceholderText('Describe your adoption, or drop a document…'), 'hi{Enter}');
    expect(hook.handleUserSend).not.toHaveBeenCalled();
  });

  it('no fixed flow, contributor role: "Contribute a pathway" sends with the contributor flow', async () => {
    const user = userEvent.setup();
    render(<AdoptionWorkspace initial={null} canContribute />);
    const btn = screen.getByRole('button', { name: 'Contribute a pathway' });
    expect(btn).toBeDisabled();
    await user.type(screen.getByPlaceholderText('Describe your adoption, or drop a document…'), 'draft');
    await user.click(btn);
    expect(hook.handleUserSend).toHaveBeenCalledWith('draft', 'contributor', '');
  });

  it('no fixed flow, explorer role: Enter sends with the explorer default flow', async () => {
    const user = userEvent.setup();
    render(<AdoptionWorkspace initial={null} canStrengthen canContribute />);
    await user.type(screen.getByPlaceholderText('Describe your adoption, or drop a document…'), 'q{Enter}');
    expect(hook.handleUserSend).toHaveBeenCalledWith('q', 'explorer', '');
  });
});

describe('AdoptionWorkspace — explorer conversation', () => {
  const explorerConv = conversation(
    { flow: 'explorer', intent: 'open', name: 'Kisan Voice', sector: 'Agriculture', geography: 'Odisha', summary: 'A phone line.' },
    [{ role: 'assistant', content: 'Hello there', pathwaysReferenced: ['kisan-voice'] }]
  );

  it('prepends the strengthen opening and renders the deployment header', async () => {
    useHook({ conversation: explorerConv });
    render(<AdoptionWorkspace initial={explorerConv} />);
    expect(screen.getByRole('heading', { name: 'Kisan Voice' })).toBeInTheDocument();
    expect(screen.getByText('Agriculture · Odisha')).toBeInTheDocument();
    expect(screen.getByText('A phone line.')).toBeInTheDocument();
    expect(screen.getByText('Hello there')).toBeInTheDocument();
    // Source chip uses the fetched lookup.
    expect(await screen.findByText('Kisan Voice', { selector: 'span' })).toBeInTheDocument();
  });

  it('collapses and expands the header details', async () => {
    const user = userEvent.setup();
    useHook({ conversation: explorerConv });
    render(<AdoptionWorkspace initial={explorerConv} />);
    const toggle = screen.getByRole('button', { expanded: true });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('A phone line.')).not.toBeInTheDocument();
  });

  it('shows "New adoption" when the deployment has no name yet', () => {
    const c = conversation({ flow: 'explorer', intent: 'open' });
    useHook({ conversation: c });
    render(<AdoptionWorkspace initial={c} />);
    expect(screen.getByRole('heading', { name: 'New adoption' })).toBeInTheDocument();
  });

  it('has no contributor-only buttons', () => {
    useHook({ conversation: explorerConv });
    render(<AdoptionWorkspace initial={explorerConv} />);
    expect(screen.queryByRole('button', { name: 'Reusable assets' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View Document' })).not.toBeInTheDocument();
  });

  it('offers Analysis/Summary only once each document exists, and opens the panel', async () => {
    const user = userEvent.setup();
    useHook({
      conversation: explorerConv,
      explorerDoc: { ...EMPTY_EXPLORER_DOC, analysis: { ...docRow('d1', 1, '# Analysis body'), doc_type: 'analysis' } },
    });
    render(<AdoptionWorkspace initial={explorerConv} />);
    expect(screen.queryByRole('button', { name: 'Executive Summary' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Analysis Document' }));
    expect(hook.openExplorerDocument).toHaveBeenCalledWith('analysis');
    expect(screen.getByRole('heading', { name: 'Analysis Document' })).toBeInTheDocument();
    expect(screen.getByText('Analysis body')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(hook.closeExplorerDocument).toHaveBeenCalled();
    expect(screen.queryByText('Analysis body')).not.toBeInTheDocument();
  });

  it('auto-opens the summary panel when the hook opens the plan document', () => {
    useHook({
      conversation: explorerConv,
      explorerDoc: {
        ...EMPTY_EXPLORER_DOC,
        summary: { ...docRow('d2', 1, '# Summary body'), doc_type: 'plan' },
        open: 'plan',
      },
    });
    render(<AdoptionWorkspace initial={explorerConv} />);
    expect(screen.getByRole('heading', { name: 'Executive Summary' })).toBeInTheDocument();
    expect(screen.getByText('Summary body')).toBeInTheDocument();
  });

  it('a back button with a custom label calls onBack', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    useHook({ conversation: explorerConv });
    render(<AdoptionWorkspace initial={explorerConv} onBack={onBack} backLabel="← All analyses" />);
    await user.click(screen.getByRole('button', { name: /All analyses/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it('sends chat messages straight to handleUserSend', async () => {
    const user = userEvent.setup();
    useHook({ conversation: explorerConv });
    render(<AdoptionWorkspace initial={explorerConv} />);
    await user.type(screen.getByPlaceholderText('Ask, share, or think out loud…'), 'next{Enter}');
    expect(hook.handleUserSend).toHaveBeenCalledWith('next');
  });
});

describe('AdoptionWorkspace — contributor conversation', () => {
  const cardMsg: Message = {
    role: 'assistant',
    content: '',
    assetShare: {
      id: 'card-1',
      status: 'open',
      noneInSection4: false,
      items: [{ key: 'row:checklist', name: 'Vendor checklist', fromSection4: true }],
    },
  };

  it('disables View Document and Reusable assets until there is something to show', () => {
    const c = conversation({ flow: 'contributor', name: 'Kisan Voice', pathwayId: 'p1' });
    useHook({ conversation: c });
    render(<AdoptionWorkspace initial={c} fixedFlow="contributor" />);
    expect(screen.getByRole('button', { name: 'View Document' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reusable assets' })).toBeDisabled();
  });

  it('opens the Reusable assets popup listing every asset card item', async () => {
    const user = userEvent.setup();
    const c = conversation({ flow: 'contributor', pathwayId: 'p1' }, [cardMsg]);
    useHook({ conversation: c });
    render(<AdoptionWorkspace initial={c} fixedFlow="contributor" />);
    await user.click(screen.getByRole('button', { name: 'Reusable assets' }));
    const heading = screen.getByRole('heading', { name: 'Reusable assets' });
    const popup = heading.closest('.flex.max-h-full') as HTMLElement;
    expect(within(popup).getByText('0 of 1')).toBeInTheDocument();
    await user.click(within(popup).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('heading', { name: 'Reusable assets' })).not.toBeInTheDocument();
  });

  it('auto-opens the document pane, labels it Draft, and Send for Review asks via the hook', async () => {
    const user = userEvent.setup();
    const c = conversation({ flow: 'contributor', name: 'Kisan Voice', pathwayId: 'p1' });
    useHook({
      conversation: c,
      pathwayDoc: {
        ...EMPTY_PATHWAY_DOC,
        content: '# Draft v2\n\nLatest body.',
        versionNumber: 2,
        versions: [docRow('v2', 2), docRow('v1', 1)],
        paneOpen: true,
      },
    });
    render(<AdoptionWorkspace initial={c} fixedFlow="contributor" />);
    expect(screen.getByRole('heading', { name: 'Pathway Document' })).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Latest body.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send for Review' }));
    expect(hook.requestPublishConsent).toHaveBeenCalled();
  });

  it('labels the latest assembled version Awaiting Review when review was requested', () => {
    const c = conversation({ flow: 'contributor', pathwayId: 'p1' });
    useHook({
      conversation: c,
      pathwayDoc: {
        ...EMPTY_PATHWAY_DOC,
        content: '# Doc',
        versionNumber: 1,
        versions: [docRow('v1', 1)],
        assembledDesignDocId: 'v1',
        reviewRequested: true,
        paneOpen: true,
      },
    });
    render(<AdoptionWorkspace initial={c} fixedFlow="contributor" />);
    expect(screen.getByText('Awaiting Review')).toBeInTheDocument();
  });

  it('labels the latest version Published when it is the published assembly', () => {
    const c = conversation({ flow: 'contributor', pathwayId: 'p1' });
    useHook({
      conversation: c,
      pathwayDoc: {
        ...EMPTY_PATHWAY_DOC,
        content: '# Doc',
        versionNumber: 1,
        versions: [docRow('v1', 1)],
        assembledDesignDocId: 'v1',
        publishedDesignDocId: 'v1',
        paneOpen: true,
      },
    });
    render(<AdoptionWorkspace initial={c} fixedFlow="contributor" />);
    expect(screen.getByText('Published')).toBeInTheDocument();
  });

  it('falls back to the pathway’s published content when this chat has no draft', async () => {
    const user = userEvent.setup();
    const c = conversation({ flow: 'contributor', pathwayId: 'p1' });
    useHook({
      conversation: c,
      pathwayDoc: { ...EMPTY_PATHWAY_DOC, pathwayPublishedContent: '# Live\n\nLive body.' },
    });
    render(<AdoptionWorkspace initial={c} fixedFlow="contributor" />);
    const view = screen.getByRole('button', { name: 'View Document' });
    expect(view).toBeEnabled();
    await user.click(view);
    expect(hook.openPathwayDocument).toHaveBeenCalled();
    expect(screen.getByText('Live body.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View Document' }));
    expect(hook.closePathwayDocument).toHaveBeenCalled();
  });

  it('offers only the latest and published versions in the picker', async () => {
    const user = userEvent.setup();
    const c = conversation({ flow: 'contributor', pathwayId: 'p1' });
    useHook({
      conversation: c,
      pathwayDoc: {
        ...EMPTY_PATHWAY_DOC,
        content: '# v3',
        versionNumber: 3,
        versions: [docRow('v3', 3), docRow('v2', 2), docRow('v1', 1)],
        publishedDesignDocId: 'v1',
        paneOpen: true,
      },
    });
    render(<AdoptionWorkspace initial={c} fixedFlow="contributor" />);
    await user.click(screen.getByRole('combobox', { name: 'Select version' }));
    const labels = screen.getAllByRole('option').map((o) => o.textContent?.split(' — ')[0]);
    expect(labels).toEqual(['v0.3 (latest)', 'v0.1 (published)']);
    await user.click(screen.getAllByRole('option')[1]);
    expect(hook.selectPathwayDocVersion).toHaveBeenCalledWith(1);
  });

  it('shows "Writing the pathway document…" while the draft is generating', () => {
    const c = conversation({ flow: 'contributor', pathwayId: 'p1' });
    useHook({ conversation: c, pathwayDoc: { ...EMPTY_PATHWAY_DOC, loading: true } });
    render(<AdoptionWorkspace initial={c} fixedFlow="contributor" />);
    expect(screen.getByText(/Writing the pathway document/)).toBeInTheDocument();
  });

  it('lists previously uploaded files in the Project files popup', async () => {
    const user = userEvent.setup();
    const c = conversation({ flow: 'contributor', pathwayId: 'p1' }, [
      { role: 'user', content: 'full text', displayContent: '📄 Uploaded **report.pdf**' },
    ]);
    useHook({ conversation: c });
    render(<AdoptionWorkspace initial={c} fixedFlow="contributor" />);
    await user.click(screen.getByRole('button', { name: '📎 Project files' }));
    expect(screen.getAllByText(/report\.pdf/).length).toBeGreaterThan(1);
  });
});
