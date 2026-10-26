// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

vi.mock('@/lib/toast', () => ({ showToast: vi.fn() }));

import { showToast } from '@/lib/toast';
import VoiceInputButton from '@/components/VoiceInputButton';

type ResultList = Array<{ isFinal: boolean; 0: { transcript: string } }>;

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  static failStart = false;
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((e: { results: ResultList }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(() => {
    if (FakeRecognition.failStart) throw new Error('already started');
  });
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
  emit(...phrases: string[]) {
    act(() => this.onresult?.({ results: phrases.map((t) => ({ isFinal: true, 0: { transcript: t } })) }));
  }
}

function Composer({ initial = '', disabled = false }: { initial?: string; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <textarea aria-label="composer" value={value} onChange={(e) => setValue(e.target.value)} />
      <VoiceInputButton value={value} onChange={setValue} disabled={disabled} />
    </>
  );
}

const composer = () => screen.getByRole('textbox', { name: 'composer' });
const latest = () => FakeRecognition.instances[FakeRecognition.instances.length - 1];

beforeEach(() => {
  FakeRecognition.instances = [];
  FakeRecognition.failStart = false;
  vi.mocked(showToast).mockClear();
  vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VoiceInputButton', () => {
  it('renders nothing where the Web Speech API is missing', () => {
    vi.unstubAllGlobals();
    const { container } = render(<VoiceInputButton value="" onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('prefers the unprefixed SpeechRecognition', async () => {
    const unprefixed = vi.fn(function (this: FakeRecognition) {
      return new FakeRecognition();
    });
    vi.stubGlobal('SpeechRecognition', unprefixed);
    const user = userEvent.setup();
    render(<Composer />);
    await user.click(screen.getByRole('button', { name: 'Start voice typing' }));
    expect(unprefixed).toHaveBeenCalledTimes(1);
  });

  it('starts listening with interim results and streams the transcript into the box', async () => {
    const user = userEvent.setup();
    render(<Composer />);
    await user.click(screen.getByRole('button', { name: 'Start voice typing' }));
    const rec = latest();
    expect(rec.start).toHaveBeenCalled();
    expect(rec.interimResults).toBe(true);
    expect(rec.continuous).toBe(true);
    expect(screen.getByRole('button', { name: 'Stop voice typing' })).toHaveAttribute('aria-pressed', 'true');
    rec.emit('hello');
    expect(composer()).toHaveValue('hello');
    rec.emit('hello', ' world');
    expect(composer()).toHaveValue('hello world');
  });

  it('appends after existing text with a single space', async () => {
    const user = userEvent.setup();
    render(<Composer initial="Typed already" />);
    await user.click(screen.getByRole('button', { name: 'Start voice typing' }));
    latest().emit('  and spoken');
    expect(composer()).toHaveValue('Typed already and spoken');
  });

  it('does not double the space when the text already ends in whitespace', async () => {
    const user = userEvent.setup();
    render(<Composer initial="Typed " />);
    await user.click(screen.getByRole('button', { name: 'Start voice typing' }));
    latest().emit('more');
    expect(composer()).toHaveValue('Typed more');
  });

  it('the stop button aborts and ignores late results', async () => {
    const user = userEvent.setup();
    render(<Composer />);
    await user.click(screen.getByRole('button', { name: 'Start voice typing' }));
    const rec = latest();
    await user.click(screen.getByRole('button', { name: 'Stop voice typing' }));
    expect(rec.abort).toHaveBeenCalled();
    expect(rec.onresult).toBeNull();
    expect(screen.getByRole('button', { name: 'Start voice typing' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('an outside edit (the user types) stops dictation', async () => {
    const user = userEvent.setup();
    render(<Composer />);
    await user.click(screen.getByRole('button', { name: 'Start voice typing' }));
    const rec = latest();
    rec.emit('dictated');
    await user.type(composer(), '!');
    expect(rec.abort).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Start voice typing' })).toBeInTheDocument();
  });

  it('becoming disabled stops dictation', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Composer />);
    await user.click(screen.getByRole('button', { name: 'Start voice typing' }));
    const rec = latest();
    rerender(<Composer disabled />);
    expect(rec.abort).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Start voice typing' })).toBeDisabled();
  });

  it('unmounting aborts an active session', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Composer />);
    await user.click(screen.getByRole('button', { name: 'Start voice typing' }));
    const rec = latest();
    unmount();
    expect(rec.abort).toHaveBeenCalled();
  });

  it('the browser ending the session resets the button', async () => {
    const user = userEvent.setup();
    render(<Composer />);
    await user.click(screen.getByRole('button', { name: 'Start voice typing' }));
    act(() => latest().onend?.());
    expect(screen.getByRole('button', { name: 'Start voice typing' })).toBeInTheDocument();
  });

  it.each([
    ['not-allowed', 'Microphone access is blocked — allow it in your browser to use voice typing.'],
    ['service-not-allowed', 'Microphone access is blocked — allow it in your browser to use voice typing.'],
    ['network', 'Voice typing stopped unexpectedly. Please try again.'],
  ])('error %s shows a toast', async (error, message) => {
    const user = userEvent.setup();
    render(<Composer />);
    await user.click(screen.getByRole('button', { name: 'Start voice typing' }));
    act(() => latest().onerror?.({ error }));
    expect(showToast).toHaveBeenCalledWith(message, 'error');
  });

  it.each(['no-speech', 'aborted'])('error %s is silent', async (error) => {
    const user = userEvent.setup();
    render(<Composer />);
    await user.click(screen.getByRole('button', { name: 'Start voice typing' }));
    act(() => latest().onerror?.({ error }));
    expect(showToast).not.toHaveBeenCalled();
  });

  it('a start() that throws leaves the button idle', async () => {
    FakeRecognition.failStart = true;
    const user = userEvent.setup();
    render(<Composer />);
    await user.click(screen.getByRole('button', { name: 'Start voice typing' }));
    expect(screen.getByRole('button', { name: 'Start voice typing' })).toHaveAttribute('aria-pressed', 'false');
  });
});
