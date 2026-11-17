import { defineConfig } from 'vitest/config';
import { integrationTestEnv } from './test/integration/test-env.js';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          globalSetup: ['test/integration/global-setup.ts'],
          env: integrationTestEnv,
          // Files share one database and one Redis DB, so run them one at a time.
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
    ],
  },
});
