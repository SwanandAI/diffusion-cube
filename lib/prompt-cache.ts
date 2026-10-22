import type Anthropic from '@anthropic-ai/sdk';
import { PROMPT_CACHE_BREAK } from '@/lib/system-prompts';

// Prompt caching for /api/chat. The stable part of a system prompt (everything
// before PROMPT_CACHE_BREAK — corpus, framework, resources) is marked with an
// ephemeral cache breakpoint (5-minute TTL), so the next turn of the same
// conversation reads it from cache instead of paying for it again. A second
// breakpoint on the last message lets the conversation history be reused too.
// The text sent is exactly the builder's text with the marker removed.

// Multi-turn modes, where the cached prefix is reused within minutes. One-shot
// modes (documents, drafts, extraction) are left uncached: writing a cache
// entry costs 25% more than a plain read and they rarely repeat in 5 minutes.
const CACHED_MODES = new Set(['companion', 'library']);

export function cachesPrompt(mode: string): boolean {
  return CACHED_MODES.has(mode);
}

// The system prompt as the API expects it: plain text for an uncached mode;
// for a cached one, the stable part (with the breakpoint) followed by the
// per-turn part. A prompt with no marker is cached whole.
export function systemForMode(mode: string, prompt: string): string | Anthropic.TextBlockParam[] {
  const [stable, ...rest] = prompt.split(PROMPT_CACHE_BREAK);
  const perTurn = rest.join('');
  if (!cachesPrompt(mode)) return stable + perTurn;
  const blocks: Anthropic.TextBlockParam[] = [{ type: 'text', text: stable, cache_control: { type: 'ephemeral' } }];
  if (perTurn) blocks.push({ type: 'text', text: perTurn });
  return blocks;
}

// Marks the last message for caching (cached modes only), so the next turn
// reuses the whole conversation up to here. Never mutates the input.
export function messagesForMode(mode: string, messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (!cachesPrompt(mode) || messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  let content: Anthropic.MessageParam['content'];
  if (typeof last.content === 'string') {
    if (!last.content) return messages;
    content = [{ type: 'text', text: last.content, cache_control: { type: 'ephemeral' } }];
  } else if (last.content.length > 0) {
    const blocks = [...last.content];
    blocks[blocks.length - 1] = {
      ...blocks[blocks.length - 1],
      cache_control: { type: 'ephemeral' },
    } as Anthropic.ContentBlockParam;
    content = blocks;
  } else {
    return messages;
  }
  return [...messages.slice(0, -1), { ...last, content }];
}
