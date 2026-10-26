import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LEGAL_BACK_TARGETS,
  LEGAL_VERSION,
  PRIVACY_PATH,
  SUPPORT_EMAIL,
  TERMS_PATH,
  isLegalFrom,
  legalHref,
  withSupportEmail,
} from '@/lib/legal';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('constants', () => {
  it('exposes the version and page paths', () => {
    expect(LEGAL_VERSION).toMatch(/^\d+\.\d+$/);
    expect(TERMS_PATH).toBe('/terms');
    expect(PRIVACY_PATH).toBe('/privacy');
  });

  it('back targets are app-relative paths (no open redirect)', () => {
    for (const target of Object.values(LEGAL_BACK_TARGETS)) expect(target).toMatch(/^\/[^/]/);
  });
});

describe('isLegalFrom', () => {
  it.each(['signup', 'contribute'])('accepts %s', (value) => {
    expect(isLegalFrom(value)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['unknown', 'admin'],
    ['wrong case', 'Signup'],
    ['a URL', 'https://evil.example'],
    ['a number', 1],
    ['null', null],
    ['undefined', undefined],
    ['an object', { signup: true }],
  ])('rejects %s', (_label, value) => {
    expect(isLegalFrom(value)).toBe(false);
  });

  // Regression: inherited prototype keys (constructor, __proto__, …) are not valid targets.
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'rejects the inherited prototype key %j from ?from=',
    (value) => {
      expect(isLegalFrom(value)).toBe(false);
    }
  );
});

describe('legalHref', () => {
  it('appends the origin as ?from=', () => {
    expect(legalHref(TERMS_PATH, 'signup')).toBe('/terms?from=signup');
    expect(legalHref(PRIVACY_PATH, 'contribute')).toBe('/privacy?from=contribute');
  });
});

describe('withSupportEmail', () => {
  it('replaces every placeholder', () => {
    expect(withSupportEmail('Write to {{SUPPORT_EMAIL}} or {{SUPPORT_EMAIL}}.')).toBe(`Write to ${SUPPORT_EMAIL} or ${SUPPORT_EMAIL}.`);
  });

  it('leaves text without the placeholder alone', () => {
    expect(withSupportEmail('No contact here. {{OTHER}}')).toBe('No contact here. {{OTHER}}');
    expect(withSupportEmail('')).toBe('');
  });

  it('defaults the support address when NEXT_PUBLIC_SUPPORT_EMAIL is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_EMAIL', '');
    vi.resetModules();
    const legal = await import('@/lib/legal');
    expect(legal.SUPPORT_EMAIL).toBe('kamesh@ekstep.org');
  });

  it('uses NEXT_PUBLIC_SUPPORT_EMAIL when set', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_EMAIL', 'help@example.org');
    vi.resetModules();
    const legal = await import('@/lib/legal');
    expect(legal.withSupportEmail('Mail {{SUPPORT_EMAIL}}')).toBe('Mail help@example.org');
  });
});
