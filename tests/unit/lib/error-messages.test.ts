import { describe, expect, it } from 'vitest';
import { GENERIC_ERROR_MESSAGE } from '@/lib/error-messages';

describe('GENERIC_ERROR_MESSAGE', () => {
  it("is the customer's exact wording", () => {
    expect(GENERIC_ERROR_MESSAGE).toBe('System encountered an error. Please try sometime later.');
  });

  it('leaks no technical detail', () => {
    expect(GENERIC_ERROR_MESSAGE).not.toMatch(/stack|exception|supabase|anthropic|sql|\d{3}/i);
  });
});
