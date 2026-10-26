// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PathwayFrontmatterBlock from '@/components/PathwayFrontmatterBlock';

describe('PathwayFrontmatterBlock', () => {
  it('renders title, joined meta, description and tags', () => {
    render(
      <PathwayFrontmatterBlock
        fm={{ title: 'Kisan Voice', stage: 'Pilot', sector: 'Agriculture', location: 'Maharashtra', description: 'Voice advisory', tags: ['voice', 'ivr'] }}
      />
    );
    expect(screen.getByRole('heading', { name: 'Kisan Voice' })).toBeInTheDocument();
    expect(screen.getByText('Pilot · Agriculture · Maharashtra')).toBeInTheDocument();
    expect(screen.getByText('Voice advisory')).toBeInTheDocument();
    expect(screen.getByText('voice')).toBeInTheDocument();
    expect(screen.getByText('ivr')).toBeInTheDocument();
  });

  it('skips missing fields', () => {
    const { container } = render(<PathwayFrontmatterBlock fm={{ sector: 'Health', tags: [] }} />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByText('Health')).toBeInTheDocument();
    expect(container.querySelectorAll('span')).toHaveLength(0);
  });
});
