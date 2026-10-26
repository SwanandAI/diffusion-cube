import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';

// Fake values only — .env.local is never loaded into tests, so no test can
// reach the real Supabase project, Anthropic, GitHub or SMTP.
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  ANTHROPIC_API_KEY: 'test-anthropic-key',
  ADMIN_EMAILS: 'env-admin@example.com',
  RATE_LIMIT_SALT: 'test-salt',
  GITHUB_TOKEN: 'test-github-token',
  GITHUB_REPO: 'example/repo',
  GITHUB_BRANCH: 'main',
});

// Routes log every expected 4xx; keep test output readable. Re-applied before
// each test because restoreMocks (vitest.config.mts) undoes spies after it.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  // Component tests run in jsdom; unmount anything they rendered.
  if (typeof document !== 'undefined') {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
  }
});
