// Fakes for the parts of the Anthropic SDK the routes touch:
// messages.stream (async-iterable of stream events + finalMessage()) and
// messages.create (a Message). The SDK module itself is mocked per test file
// with vi.mock — see tests/api/chat.test.ts for the pattern:
//
//   const anthropic = vi.hoisted(() => ({ create: vi.fn(), stream: vi.fn() }));
//   vi.mock('@anthropic-ai/sdk', () => ({
//     default: class { messages = { create: anthropic.create, stream: anthropic.stream }; },
//   }));

export const FAKE_USAGE = {
  input_tokens: 120,
  output_tokens: 34,
  cache_read_input_tokens: 100,
  cache_creation_input_tokens: 7,
};

export interface FakeStreamOptions {
  // Throw this after yielding `failAfter` text chunks (mid-stream failure).
  error?: Error;
  failAfter?: number;
  model?: string;
}

// A stream that yields each string as a text_delta, interleaved with a
// non-text event the route must skip.
export function fakeStream(chunks: string[], options: FakeStreamOptions = {}) {
  const { error, failAfter = chunks.length, model = 'claude-sonnet-4-6' } = options;
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'message_start', message: {} };
      for (let i = 0; i < chunks.length; i++) {
        if (error && i === failAfter) throw error;
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{' } };
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunks[i] } };
      }
      if (error && failAfter >= chunks.length) throw error;
      yield { type: 'message_stop' };
    },
    finalMessage: async () => ({ model, usage: FAKE_USAGE, content: [{ type: 'text', text: chunks.join('') }] }),
  };
}

export function fakeTextMessage(text: string, model = 'claude-sonnet-4-6') {
  return { model, usage: FAKE_USAGE, content: [{ type: 'text', text }] };
}

export function fakeToolUseMessage(input: unknown, model = 'claude-sonnet-4-6') {
  return {
    model,
    usage: FAKE_USAGE,
    content: [{ type: 'tool_use', id: 'toolu_1', name: 'report_match', input }],
  };
}

// Lets fire-and-forget work (after() fallbacks, .then() inserts) settle.
export async function flushAsync(rounds = 10) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}
