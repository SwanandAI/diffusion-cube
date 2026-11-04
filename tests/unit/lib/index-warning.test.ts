import { describe, expect, it } from 'vitest';
import { indexWarningText } from '@/components/AdminPathwaysPanel';

describe('indexWarningText', () => {
  it('is null when everything was indexed with vectors', () => {
    expect(indexWarningText([], true)).toBeNull();
    expect(indexWarningText(undefined, undefined)).toBeNull();
  });

  it('names each skipped unit and its reason', () => {
    expect(
      indexWarningText(
        [
          { unit: 3, reason: 'unknown sub-category "Z" for persona' },
          { unit: 7, reason: 'missing stage' },
        ],
        true
      )
    ).toBe(
      'Published. 2 lessons weren\'t indexed for search: Unit 3 (unknown sub-category "Z" for persona), Unit 7 (missing stage). Ask the contributor to fix their labels and send it for review again.'
    );
  });

  it('uses the singular for one unit', () => {
    expect(indexWarningText([{ unit: 1, reason: 'missing type' }], true)).toMatch(/^Published\. 1 lesson wasn't indexed/);
  });

  it('says when vectors could not be stored', () => {
    expect(indexWarningText([], false)).toBe(
      'Published. Search by meaning is unavailable for this pathway until it is published again (keyword search still works).'
    );
  });
});
