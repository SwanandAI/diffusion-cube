'use client';

// Mic button for every chat composer — dictates into the composer's text via
// the browser's Web Speech API (no server round-trip, no API key). Words
// stream into the box live as they're recognised, appended after whatever
// was already typed. Renders nothing where the API is missing (Firefox), so
// composers can include it unconditionally.
//
// Dictation stops on its own when the composer's value changes from outside
// (the user types, or a send clears the box), when `disabled` flips on, or
// when the button unmounts — so a send never gets refilled by a late result.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { showToast } from '@/lib/toast';

// Minimal typings — SpeechRecognition isn't in TypeScript's lib.dom, and
// Chrome/Safari still ship it under the webkit prefix.
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}
interface SpeechRecognitionEventLike {
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Support never changes after load, so there's nothing to subscribe to; the
// server snapshot (false) keeps the first client render hydration-safe.
const noopSubscribe = () => () => {};

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export default function VoiceInputButton({ value, onChange, disabled, className }: Props) {
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => getRecognitionCtor() !== null,
    () => false
  );
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Last value this button wrote — anything else arriving in `value` while
  // listening is an outside edit, which ends dictation.
  const lastWrittenRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => () => stopListening(), []);

  useEffect(() => {
    if (listening && lastWrittenRef.current !== null && value !== lastWrittenRef.current) stopListening();
  }, [value, listening]);

  useEffect(() => {
    if (disabled) stopListening();
  }, [disabled]);

  function stopListening() {
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      recognitionRef.current = null;
    }
    lastWrittenRef.current = null;
    setListening(false);
  }

  function startListening() {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    const prefix = value && !/\s$/.test(value) ? `${value} ` : value;
    const recognition = new Ctor();
    recognition.lang = navigator.language || 'en-US';
    // Android Chrome repeats earlier phrases in e.results when continuous is
    // on, so there each tap dictates a single utterance instead.
    recognition.continuous = !/Android/i.test(navigator.userAgent);
    recognition.interimResults = true;

    recognition.onresult = (e) => {
      // e.results holds the whole session's results
      // (final + still-interim), so rebuild the full transcript each time.
      let transcript = '';
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      const next = prefix + transcript.trimStart();
      lastWrittenRef.current = next;
      onChangeRef.current(next);
    };
    recognition.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        showToast('Microphone access is blocked — allow it in your browser to use voice typing.', 'error');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        showToast('Voice typing stopped unexpectedly. Please try again.', 'error');
      }
    };
    // Browsers end the session themselves after a stretch of silence.
    recognition.onend = () => {
      recognitionRef.current = null;
      lastWrittenRef.current = null;
      setListening(false);
    };

    recognitionRef.current = recognition;
    lastWrittenRef.current = value;
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      lastWrittenRef.current = null;
    }
  }

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={listening ? stopListening : startListening}
      disabled={disabled}
      aria-label={listening ? 'Stop voice typing' : 'Start voice typing'}
      aria-pressed={listening}
      title={listening ? 'Stop voice typing' : 'Voice typing'}
      className={`relative flex shrink-0 items-center justify-center rounded-full transition disabled:opacity-40 ${
        listening ? 'bg-coral/10 text-coral' : 'text-ink-soft hover:bg-paper-dim hover:text-coral'
      } ${className ?? 'h-11 w-11'}`}
    >
      {listening && <span className="absolute inset-0 animate-ping rounded-full bg-coral/20" aria-hidden />}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
