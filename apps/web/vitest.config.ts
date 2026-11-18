import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the web app's logic (src/lib): pure functions, no browser, no network.
 * Components are exercised by running the site (DATA-TOOLS.md §7.4).
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
