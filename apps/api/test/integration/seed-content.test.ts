import { spawn } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONTENT_CACHE_KEYS } from '../../src/repositories/content-cache.store.js';
import { createTestDependencies, type TestDependencies } from '../helpers/test-dependencies.js';
import { integrationTestEnv } from './test-env.js';

const API_ROOT = path.resolve(import.meta.dirname, '../..');

/** Runs the real `content:seed` CLI (with the real content/portfolio.json) against the test DBs. */
function runSeedCli(): Promise<number | null> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/seed-content.ts'], {
    cwd: API_ROOT,
    env: { ...process.env, ...integrationTestEnv },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return new Promise((resolve) => {
    child.once('exit', resolve);
  });
}

describe('content:seed CLI', () => {
  let deps: TestDependencies;

  beforeAll(async () => {
    deps = await createTestDependencies();
  });

  afterAll(async () => {
    await deps.close();
  });

  it('publishes portfolio.json, removes stale cache keys, and warms the cache', async () => {
    await deps.redis.flushdb();
    await deps.redis.set(CONTENT_CACHE_KEYS.project('deleted-project'), '{}');
    await deps.redis.set(CONTENT_CACHE_KEYS.projects, '[]');

    expect(await runSeedCli()).toBe(0);

    const profiles = await deps.postgres.query('SELECT 1 FROM profile');
    expect(profiles.rowCount).toBe(1);

    expect(await deps.redis.exists(CONTENT_CACHE_KEYS.project('deleted-project'))).toBe(0);
    const cachedProjects: unknown = JSON.parse(
      (await deps.redis.get(CONTENT_CACHE_KEYS.projects)) ?? '[]',
    );
    const projectCount = await deps.postgres.query('SELECT 1 FROM projects');
    expect(cachedProjects).toHaveLength(projectCount.rowCount ?? -1);
    expect(await deps.redis.exists(CONTENT_CACHE_KEYS.profile)).toBe(1);
  });
});
