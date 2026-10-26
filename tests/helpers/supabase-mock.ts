import { vi } from 'vitest';

// A fake Supabase client for route and lib tests. Every query builder chain
// (from().select().eq()...) is recorded as one QueryOp and resolves to what
// the test configured for that table — a fixed response, or a function of
// the op so one table can answer different queries differently.
//
//   const sb = createSupabaseMock({
//     user: { id: 'u1', email: 'a@b.c' },
//     tables: {
//       user_roles: (op) => (op.action === 'select' ? { data: [{ role: 'adopter' }] } : {}),
//     },
//   });
//   vi.mocked(createClient).mockResolvedValue(sb.client);
//   ...
//   expect(sb.ops('user_roles', 'insert')[0].payload).toEqual(...)

export type QueryAction = 'select' | 'insert' | 'update' | 'upsert' | 'delete';

export interface QueryOp {
  table: string;
  action: QueryAction;
  columns?: string;
  payload?: unknown;
  options?: unknown;
  // Each filter/modifier call in order, e.g. ['eq', 'user_id', 'u1'].
  filters: unknown[][];
  single?: 'single' | 'maybeSingle';
}

export interface MockResponse {
  data?: unknown;
  error?: { message: string; code?: string } | null;
  count?: number | null;
}

export type TableHandler = MockResponse | ((op: QueryOp) => MockResponse | undefined);

export interface MockUser {
  id: string;
  email?: string | null;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}

export interface SupabaseMockOptions {
  user?: MockUser | null;
  tables?: Record<string, TableHandler>;
  rpc?: Record<string, MockResponse | ((args: unknown) => MockResponse)>;
}

const FILTER_METHODS = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'not', 'or', 'match',
  'filter', 'contains', 'containedBy', 'order', 'limit', 'range', 'returns', 'textSearch', 'overlaps',
];

export function createSupabaseMock(options: SupabaseMockOptions = {}) {
  const queryOps: QueryOp[] = [];
  const tables = options.tables ?? {};
  let user = options.user ?? null;

  function resolve(op: QueryOp) {
    const handler = tables[op.table];
    const res = (typeof handler === 'function' ? handler(op) : handler) ?? {};
    return { data: res.data ?? null, error: res.error ?? null, count: res.count ?? null };
  }

  function builder(table: string) {
    const op: QueryOp = { table, action: 'select', filters: [] };
    let started = false;
    const b: Record<string, unknown> = {};
    const start = (action: QueryAction, payload?: unknown, opts?: unknown) => {
      // insert().select() keeps the insert as the op's action.
      if (!started || action !== 'select') {
        op.action = action;
        if (payload !== undefined) op.payload = payload;
        if (opts !== undefined) op.options = opts;
      }
      if (!started) queryOps.push(op);
      started = true;
      return b;
    };
    b.select = (columns?: string, opts?: unknown) => {
      op.columns = columns;
      return start('select', undefined, opts);
    };
    b.insert = (payload: unknown, opts?: unknown) => start('insert', payload, opts);
    b.update = (payload: unknown, opts?: unknown) => start('update', payload, opts);
    b.upsert = (payload: unknown, opts?: unknown) => start('upsert', payload, opts);
    b.delete = (opts?: unknown) => start('delete', undefined, opts);
    for (const m of FILTER_METHODS) {
      b[m] = (...args: unknown[]) => {
        op.filters.push([m, ...args]);
        return b;
      };
    }
    b.single = () => {
      op.single = 'single';
      return b;
    };
    b.maybeSingle = () => {
      op.single = 'maybeSingle';
      return b;
    };
    b.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolve(op)).then(onFulfilled, onRejected);
    return b;
  }

  const storageBucket = {
    createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://storage.test/signed' }, error: null })),
    createSignedUploadUrl: vi.fn(async () => ({
      data: { signedUrl: 'https://storage.test/upload', token: 'upload-token', path: 'p' },
      error: null,
    })),
    upload: vi.fn(async () => ({ data: { path: 'p' }, error: null })),
    download: vi.fn(async () => ({ data: new Blob(['file']), error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })),
    list: vi.fn(async () => ({ data: [], error: null })),
    info: vi.fn(async () => ({ data: { size: 4 }, error: null })),
  };

  const auth = {
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
    getSession: vi.fn(async () => ({ data: { session: user ? { user } : null }, error: null })),
    signInWithPassword: vi.fn(async () => ({ data: { user, session: {} }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    admin: {
      getUserById: vi.fn(async (id: string) => ({ data: { user: { id, email: `${id}@example.com` } }, error: null })),
      updateUserById: vi.fn(async (id: string) => ({ data: { user: { id } }, error: null })),
      deleteUser: vi.fn(async () => ({ data: {}, error: null })),
      listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })),
    },
  };

  const rpc = vi.fn(async (name: string, args: unknown) => {
    const handler = options.rpc?.[name];
    const res = (typeof handler === 'function' ? handler(args) : handler) ?? {};
    return { data: res.data ?? null, error: res.error ?? null };
  });

  const client = {
    from: vi.fn((table: string) => builder(table)),
    rpc,
    auth,
    storage: { from: vi.fn(() => storageBucket) },
  };

  return {
    // Typed loosely on purpose: the app's code only sees the methods it calls.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: client as any,
    auth,
    rpc,
    storageBucket,
    queryOps,
    ops: (table: string, action?: QueryAction) =>
      queryOps.filter((o) => o.table === table && (!action || o.action === action)),
    setUser: (next: MockUser | null) => {
      user = next;
    },
  };
}

export type SupabaseMock = ReturnType<typeof createSupabaseMock>;
