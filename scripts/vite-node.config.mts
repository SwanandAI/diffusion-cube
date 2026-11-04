import path from 'node:path';
import { defineConfig } from 'vite';

// Lets scripts (run with vite-node) import app modules through the same
// "@/" alias the app and tests use. Used by `npm run seed:pathways`.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '..') },
  },
});
