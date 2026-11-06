import path from 'node:path';
import { defineConfig } from 'vite';

// Like scripts/vite-node.config.mts (two levels up), plus two swaps so an eval run reads the
// database but never writes to it: lib/ai-usage.ts and lib/errors.ts resolve
// to the console-only stubs next to this file. Used by `npm run eval:answers`.
const root = path.resolve(__dirname, '../../..');

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/lib\/ai-usage$/, replacement: path.join(__dirname, 'stubs/ai-usage.ts') },
      { find: /^@\/lib\/errors$/, replacement: path.join(__dirname, 'stubs/errors.ts') },
      { find: /^@\//, replacement: `${root}/` },
    ],
  },
});
