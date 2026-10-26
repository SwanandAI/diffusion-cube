// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import WikiMarkdown from '@/components/WikiMarkdown';
import { FILE_COLUMN } from '@/lib/pathway-section4';

const ASSET = 'asset-11111111-1111-4111-8111-111111111111';

describe('WikiMarkdown', () => {
  it('renders headings, paragraphs, rules and bold', () => {
    render(<WikiMarkdown markdown={'# Title\n## Section\n### Sub\n\nLine one\nline two with **bold**\n\n---'} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Section' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Sub' })).toBeInTheDocument();
    // Consecutive lines join into one paragraph.
    expect(screen.getByText(/Line one line two with/)).toBeInTheDocument();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('renders unordered and ordered lists', () => {
    render(<WikiMarkdown markdown={'- a\n* b\n\n1. one\n2. two'} />);
    const lists = screen.getAllByRole('list');
    expect(lists[0].tagName).toBe('UL');
    expect(within(lists[0]).getAllByRole('listitem')).toHaveLength(2);
    expect(lists[1].tagName).toBe('OL');
    expect(within(lists[1]).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['one', 'two']);
  });

  it('renders a pipe table', () => {
    render(<WikiMarkdown markdown={'| Stage | Status |\n|---|:---:|\n| Pilot | Done |\n| Scale | Next |'} />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Stage', 'Status']);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });

  it('drops HTML comments (machine markers)', () => {
    const { container } = render(<WikiMarkdown markdown={`Text <!-- asset-id: ${ASSET} --> more`} />);
    expect(container.textContent).not.toContain('asset-id');
  });

  it('shows pathway cross-links as plain text by default', () => {
    render(<WikiMarkdown markdown="See [Other pathway](other-pathway.md)." />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText(/\[Other pathway\]\(other-pathway\.md\)/)).toBeInTheDocument();
  });

  it('links everything when links is on (legal pages)', () => {
    render(<WikiMarkdown links markdown="Read the [Privacy Notice](/privacy)." />);
    expect(screen.getByRole('link', { name: 'Privacy Notice' })).toHaveAttribute('href', '/privacy');
  });

  it('always links toolkit asset download routes and https links', () => {
    render(
      <WikiMarkdown
        markdown={`[Checklist](/api/toolkit-assets/${ASSET}/download) and [Preview](/api/toolkit-assets/${ASSET}/download?preview=1) and [Repo](https://github.com/org/x)`}
      />
    );
    const download = screen.getByRole('link', { name: 'Checklist' });
    expect(download).toHaveAttribute('href', `/api/toolkit-assets/${ASSET}/download`);
    expect(download).not.toHaveAttribute('target');
    expect(screen.getByRole('link', { name: 'Preview' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'Repo' })).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('never links javascript: or http: hrefs without links on', () => {
    render(<WikiMarkdown markdown="[x](javascript:alert(1)) [y](http://insecure.example)" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders the Section 4 file column as a download link', () => {
    const md = `| Asset | ${FILE_COLUMN} |\n|---|---|\n| Checklist | [checklist.xlsx](/api/toolkit-assets/${ASSET}/download) |\n| Tool | [github.com](https://github.com/org/tool) |\n| Plain | not a link |`;
    render(<WikiMarkdown markdown={md} />);
    expect(screen.getByRole('link', { name: 'checklist.xlsx' })).toHaveAttribute('href', `/api/toolkit-assets/${ASSET}/download`);
    expect(screen.getByRole('link', { name: 'github.com' })).toHaveAttribute('target', '_blank');
    expect(screen.getByText('not a link')).toBeInTheDocument();
  });

  it('renders nothing for empty markdown', () => {
    const { container } = render(<WikiMarkdown markdown="" />);
    expect(container.firstChild).toBeEmptyDOMElement();
  });
});
