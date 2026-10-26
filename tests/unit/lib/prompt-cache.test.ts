import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { cachesPrompt, messagesForMode, systemForMode } from '@/lib/prompt-cache';
import { PROMPT_CACHE_BREAK } from '@/lib/system-prompts';

const EPHEMERAL = { type: 'ephemeral' };

describe('cachesPrompt', () => {
  it.each(['companion', 'library'])('caches the multi-turn mode %s', (mode) => {
    expect(cachesPrompt(mode)).toBe(true);
  });

  it.each(['pathway-draft', 'analysis-doc', 'executive-summary', 'extract-insights', 'asset-reuse', '', 'COMPANION', 'constructor'])(
    'does not cache %j',
    (mode) => {
      expect(cachesPrompt(mode)).toBe(false);
    }
  );
});

describe('systemForMode', () => {
  const prompt = `STABLE CORPUS${PROMPT_CACHE_BREAK}PER TURN`;

  it('splits a cached prompt into a cached stable block and a plain per-turn block', () => {
    expect(systemForMode('companion', prompt)).toEqual([
      { type: 'text', text: 'STABLE CORPUS', cache_control: EPHEMERAL },
      { type: 'text', text: 'PER TURN' },
    ]);
  });

  it('caches a prompt with no marker whole', () => {
    expect(systemForMode('library', 'whole prompt')).toEqual([
      { type: 'text', text: 'whole prompt', cache_control: EPHEMERAL },
    ]);
  });

  it('omits the per-turn block when nothing follows the marker', () => {
    expect(systemForMode('companion', `stable${PROMPT_CACHE_BREAK}`)).toEqual([
      { type: 'text', text: 'stable', cache_control: EPHEMERAL },
    ]);
  });

  it('returns plain text with the marker removed for an uncached mode', () => {
    expect(systemForMode('pathway-draft', prompt)).toBe('STABLE CORPUSPER TURN');
  });

  it('returns uncached text untouched when there is no marker', () => {
    expect(systemForMode('analysis-doc', 'abc')).toBe('abc');
  });

  it('never leaks the marker (or its NUL bytes) into what is sent, even with several markers', () => {
    const twice = `a${PROMPT_CACHE_BREAK}b${PROMPT_CACHE_BREAK}c`;
    const cached = systemForMode('companion', twice) as Anthropic.TextBlockParam[];
    expect(cached.map((b) => b.text)).toEqual(['a', 'bc']);
    expect(systemForMode('asset-reuse', twice)).toBe('abc');
    for (const text of [...cached.map((b) => b.text), systemForMode('asset-reuse', twice) as string]) {
      expect(text).not.toContain('\u0000');
    }
  });
});

describe('messagesForMode', () => {
  it('returns the same array untouched for an uncached mode', () => {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: 'hi' }];
    expect(messagesForMode('pathway-draft', messages)).toBe(messages);
  });

  it('returns an empty conversation as-is', () => {
    const messages: Anthropic.MessageParam[] = [];
    expect(messagesForMode('companion', messages)).toBe(messages);
  });

  it('turns a string last message into a cached text block', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'last' },
    ];
    const out = messagesForMode('companion', messages);
    expect(out.slice(0, 2)).toEqual(messages.slice(0, 2));
    expect(out[2]).toEqual({ role: 'user', content: [{ type: 'text', text: 'last', cache_control: EPHEMERAL }] });
  });

  it('marks only the last block of an array last message', () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          { type: 'text', text: 'what is this?' },
        ],
      },
    ];
    const out = messagesForMode('library', messages);
    const blocks = out[0].content as Anthropic.ContentBlockParam[];
    expect(blocks[0]).not.toHaveProperty('cache_control');
    expect(blocks[1]).toEqual({ type: 'text', text: 'what is this?', cache_control: EPHEMERAL });
  });

  it('never mutates the input', () => {
    const last: Anthropic.MessageParam = { role: 'user', content: [{ type: 'text', text: 'x' }] };
    const messages = [last];
    const snapshot = structuredClone(messages);
    const out = messagesForMode('companion', messages);
    expect(messages).toEqual(snapshot);
    expect(out).not.toBe(messages);
    expect(out[0]).not.toBe(last);
  });

  it('leaves an empty-string last message alone (an empty cached text block would be rejected)', () => {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: '' }];
    expect(messagesForMode('companion', messages)).toBe(messages);
  });

  it('leaves an empty content array alone', () => {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: [] }];
    expect(messagesForMode('companion', messages)).toBe(messages);
  });
});
