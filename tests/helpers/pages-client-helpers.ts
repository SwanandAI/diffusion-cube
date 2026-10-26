import { vi } from 'vitest';

// Shared plumbing for tests/pages/client/* — client pages and components
// that live under app/. Nothing here talks to a real network or Supabase.

// ---- streaming /api/chat replies ------------------------------------------

export function streamResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

// A 200 reply whose body breaks off after the given chunks.
export function brokenStreamResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (i < chunks.length) return { done: false, value: enc.encode(chunks[i++]) };
          throw new Error('network reset');
        },
      }),
    },
  } as unknown as Response;
}

// ---- Supabase browser auth (the methods the login/account pages call) ----

type AuthResult = { data?: unknown; error?: { message: string; code?: string; status?: number } | null };

export function createAuthClientMock() {
  const ok = (data: unknown = {}): AuthResult => ({ data, error: null });
  const auth = {
    signInWithPassword: vi.fn(async (_args: { email: string; password: string }): Promise<AuthResult> =>
      ok({ user: { id: 'u1' }, session: { access_token: 't' } })
    ),
    signUp: vi.fn(async (_args: unknown): Promise<AuthResult> =>
      ok({ user: { id: 'u1', identities: [{ id: 'i1' }] }, session: null })
    ),
    resend: vi.fn(async (_args: unknown): Promise<AuthResult> => ok()),
    verifyOtp: vi.fn(async (_args: unknown): Promise<AuthResult> =>
      ok({ user: { id: 'u1' }, session: { access_token: 't' } })
    ),
    resetPasswordForEmail: vi.fn(async (_email: string): Promise<AuthResult> => ok()),
    updateUser: vi.fn(async (_args: unknown): Promise<AuthResult> => ok({ user: { id: 'u1' } })),
    signOut: vi.fn(async () => ({ error: null })),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { auth, client: { auth } as any };
}
