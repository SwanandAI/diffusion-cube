// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import LegalDocument from '@/components/LegalDocument';
import SiteHeader from '@/components/SiteHeader';
import { SUPPORT_EMAIL } from '@/lib/legal';

describe('LegalDocument', () => {
  it.each(['terms', 'privacy'] as const)('renders content/legal/%s.md with the support email filled in', async (file) => {
    render(await LegalDocument({ file, title: 'Legal page', versionLine: 'Version 1.0' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Legal page' })).toBeInTheDocument();
    expect(screen.getByText('Version 1.0')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('{{SUPPORT_EMAIL}}');
    const footer = within(screen.getByRole('navigation'));
    expect(footer.getByRole('link', { name: 'Terms of Use' })).toHaveAttribute('href', '/terms');
    expect(footer.getByRole('link', { name: 'Privacy Notice' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: /Back/ })).toHaveAttribute('href', 'https://100pathways.com/');
  });

  it('the terms mention the support address', async () => {
    render(await LegalDocument({ file: 'terms', title: 'Terms', versionLine: 'v' }));
    expect(document.body.textContent).toContain(SUPPORT_EMAIL);
  });

  it('rejects for a missing document', async () => {
    await expect(
      LegalDocument({ file: 'missing' as 'terms', title: 'x', versionLine: 'y' })
    ).rejects.toThrow(/ENOENT/);
  });
});

describe('SiteHeader', () => {
  it('shows the default Back link to 100pathways.com and no right-hand slot', () => {
    const { container } = render(<SiteHeader />);
    expect(screen.getByRole('link', { name: /Back/ })).toHaveAttribute('href', 'https://100pathways.com/');
    expect(screen.getByRole('link', { name: /100 Pathways/ })).toHaveAttribute('href', '/');
    expect(container.querySelector('.ml-auto')).toBeNull();
  });

  it('replaces Back and renders children when given', () => {
    render(
      <SiteHeader back={<a href="/custom">Custom back</a>}>
        <button type="button">Sign in</button>
      </SiteHeader>
    );
    expect(screen.queryByRole('link', { name: /^← Back$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Custom back' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});
