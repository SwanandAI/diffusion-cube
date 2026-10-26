// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorScreen from '@/components/ErrorScreen';

describe('ErrorScreen', () => {
  it('shows only the given title and message plus a link home', () => {
    render(<ErrorScreen title="Something went wrong" message="Please try again in a moment." />);
    expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByText('Please try again in a moment.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
  });

  it('renders a long message verbatim (no stack or error object is ever shown)', () => {
    const long = 'We could not load this page. '.repeat(30).trim();
    const { container } = render(<ErrorScreen title="Page not found" message={long} />);
    expect(screen.getByText(long)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Error:|at \w+ \(/);
  });
});
