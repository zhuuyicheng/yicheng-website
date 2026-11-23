import path from 'node:path';
import { defineConfig } from 'vitest/config';

/** Web logic (src/lib) only: no browser, no network. Components are checked by running the site. */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
