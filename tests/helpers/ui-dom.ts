import { vi } from 'vitest';

// jsdom has no layout engine: Element.scrollIntoView is missing, and
// components that keep something in view (ChatPanel's bottom sentinel,
// Select's active option) call it from effects. Call from beforeAll.
export function stubScrollIntoView() {
  Element.prototype.scrollIntoView = vi.fn();
}
