// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { sessionMock, routeOps } from '../../helpers/routes-auth';
import type { SupabaseMock, TableHandler } from '../../helpers/supabase-mock';
import { requestState, stubProps } from '../../helpers/pages-server-mocks';

vi.mock('next/navigation', async () => (await import('../../helpers/pages-server-mocks')).navigationModule());
vi.mock('next/headers', async () => (await import('../../helpers/pages-server-mocks')).headersModule());
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/components/AppShell', async () => ({
  default: (await import('../../helpers/pages-server-mocks')).propsStub('AppShell'),
}));
vi.mock('@/components/SignOutButton', async () => ({
  default: (await import('../../helpers/pages-server-mocks')).propsStub('SignOutButton'),
}));

import { createClient } from '@/lib/supabase/server';
import AppLayout from '@/app/(app)/layout';

const ADOPTIONS = [
  { id: 'd2', meta: { name: 'Newer', flow: 'analyse' }, updated_at: '2026-10-02T00:00:00Z' },
  { id: 'd1', meta: null, updated_at: '2026-10-01T00:00:00Z' },
];

let sb: SupabaseMock;

function as(user: { id: string; email?: string } | null, roles: string[], designs: TableHandler = { data: ADOPTIONS }) {
  sb = sessionMock(user, roles, { designs });
  vi.mocked(createClient).mockResolvedValue(sb.client);
}

async function renderLayout() {
  return render(await AppLayout({ children: <p>page body</p> }));
}

interface ShellProps {
  email: string | null;
  adoptions: unknown[];
  isAdmin: boolean;
}

beforeEach(() => {
  requestState.email = 'user@example.com';
});

describe('app/(app)/layout.tsx', () => {
  describe('zero roles (pending approval)', () => {
    it('shows the Awaiting approval screen with a sign-out button and never the shell or the page', async () => {
      as({ id: 'u1', email: 'user@example.com' }, []);
      await renderLayout();
      expect(screen.getByRole('heading', { name: 'Awaiting approval' })).toBeInTheDocument();
      expect(screen.getByText(/hasn.t been approved yet/)).toBeInTheDocument();
      expect(screen.getByTestId('SignOutButton')).toBeInTheDocument();
      expect(screen.getByText('100 Pathways')).toBeInTheDocument(); // SiteHeader
      expect(screen.queryByTestId('AppShell')).not.toBeInTheDocument();
      expect(screen.queryByText('page body')).not.toBeInTheDocument();
    });

    it('does not load adoptions for a pending account', async () => {
      as({ id: 'u1' }, []);
      await renderLayout();
      expect(sb.ops('designs')).toHaveLength(0);
    });

    it('an env-listed admin email with zero role rows is still held at the approval screen', async () => {
      // The gate is hasAnyRole only; ADMIN_EMAILS doesn't bypass it. Every
      // real account has 'adopter' (migration 0039), so this is a guard path.
      requestState.email = 'env-admin@example.com';
      as({ id: 'u1', email: 'env-admin@example.com' }, []);
      await renderLayout();
      expect(screen.getByRole('heading', { name: 'Awaiting approval' })).toBeInTheDocument();
    });

    it('an anonymous visitor (no session, so no role rows) gets the same screen', async () => {
      requestState.email = null;
      as(null, []);
      await renderLayout();
      expect(screen.getByRole('heading', { name: 'Awaiting approval' })).toBeInTheDocument();
    });
  });

  describe('approved (holds a role)', () => {
    it('wraps the page in AppShell with the forwarded email, adoptions and isAdmin=false for an adopter', async () => {
      as({ id: 'u1', email: 'user@example.com' }, ['adopter']);
      await renderLayout();
      const shell = screen.getByTestId('AppShell');
      expect(stubProps<ShellProps>(shell)).toEqual({ email: 'user@example.com', adoptions: ADOPTIONS, isAdmin: false });
      expect(shell).toHaveTextContent('page body');
      expect(screen.queryByText('Awaiting approval')).not.toBeInTheDocument();
    });

    it('lists the caller\'s adoptions newest first', async () => {
      as({ id: 'u1' }, ['adopter']);
      await renderLayout();
      const [designs] = sb.ops('designs', 'select');
      expect(designs.columns).toBe('id, meta, updated_at');
      expect(designs.filters).toEqual([['order', 'updated_at', { ascending: false }]]);
    });

    it('isAdmin=true for an ADMIN_EMAILS address without an admin role row (no admin role lookup)', async () => {
      requestState.email = 'Env-Admin@Example.com';
      as({ id: 'u1' }, ['adopter']);
      await renderLayout();
      expect(stubProps<ShellProps>(screen.getByTestId('AppShell')).isAdmin).toBe(true);
      const adminLookups = sb.ops('user_roles').filter((o) => o.filters.some((f) => f[0] === 'eq' && f[2] === 'admin'));
      expect(adminLookups).toHaveLength(0);
    });

    it('isAdmin=true for a user holding the admin role', async () => {
      as({ id: 'u1' }, ['adopter', 'admin']);
      await renderLayout();
      expect(stubProps<ShellProps>(screen.getByTestId('AppShell')).isAdmin).toBe(true);
    });

    it('a pathway_contributor without admin is not an admin', async () => {
      as({ id: 'u1' }, ['adopter', 'pathway_contributor']);
      await renderLayout();
      expect(stubProps<ShellProps>(screen.getByTestId('AppShell')).isAdmin).toBe(false);
    });

    it('passes email=null when proxy forwarded no header, and still resolves admin by role', async () => {
      requestState.email = null;
      as({ id: 'u1' }, ['admin']);
      await renderLayout();
      expect(stubProps<ShellProps>(screen.getByTestId('AppShell'))).toMatchObject({ email: null, isAdmin: true });
    });

    it('falls back to an empty adoptions list when the designs query errors', async () => {
      as({ id: 'u1' }, ['adopter'], { error: { message: 'boom' } });
      await renderLayout();
      expect(stubProps<ShellProps>(screen.getByTestId('AppShell')).adoptions).toEqual([]);
    });

    it('falls back to an empty adoptions list when there are none', async () => {
      as({ id: 'u1' }, ['adopter'], { data: [] });
      await renderLayout();
      expect(stubProps<ShellProps>(screen.getByTestId('AppShell')).adoptions).toEqual([]);
    });

    it('makes no writes', async () => {
      as({ id: 'u1' }, ['adopter']);
      await renderLayout();
      expect(routeOps(sb).every((o) => o.action === 'select')).toBe(true);
    });
  });
});
