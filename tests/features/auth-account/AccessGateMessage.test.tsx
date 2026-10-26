// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import AccessGateMessage from '@/components/AccessGateMessage';

describe('AccessGateMessage', () => {
  it('shows eyebrow, heading, body and a CTA link', () => {
    render(
      <AccessGateMessage
        eyebrow="Contribute"
        heading={<>Share your <em>pathway</em></>}
        body={'Sign in to contribute.\nIt takes a minute.'}
        cta={{ label: 'Sign in', href: '/login?next=/contribute' }}
      />
    );
    expect(screen.getByText('Contribute')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Share your pathway');
    expect(screen.getByText(/Sign in to contribute\./)).toHaveClass('whitespace-pre-wrap');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?next=/contribute');
  });

  it('omits the CTA when nothing is actionable yet', () => {
    render(<AccessGateMessage eyebrow="Analyse" heading="Awaiting approval" body="An admin will review your request." />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
