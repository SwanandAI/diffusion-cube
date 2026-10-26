import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Unit + route-handler tests run in node; component and client-hook tests opt
// into jsdom with a `// @vitest-environment jsdom` first line. Nothing here
// talks to a real Supabase, Anthropic, GitHub or SMTP — tests/setup.ts sets
// fake env vars and every external client is mocked per test.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname) },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['lib/**', 'app/**', 'components/**', 'proxy.ts'],
      reporter: ['text-summary', 'html'],
      reportsDirectory: 'tests/coverage',
    },
  },
});
