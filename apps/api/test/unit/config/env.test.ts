import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../../src/config/env.js';

const REQUIRED_ENV = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379/0',
};

function captureConfigError(env: NodeJS.ProcessEnv): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected loadConfig to throw a ConfigError');
}

describe('loadConfig', () => {
  it('applies defaults when only required variables are set', () => {
    const config = loadConfig(REQUIRED_ENV);

    expect(config).toEqual({
      nodeEnv: 'development',
      server: { host: '0.0.0.0', port: 4000 },
      log: { level: 'info', pretty: true },
      postgres: { url: REQUIRED_ENV.DATABASE_URL, poolMax: 10 },
      redis: { url: REQUIRED_ENV.REDIS_URL },
      cache: { ttlSeconds: 300 },
      shutdown: { timeoutMs: 10_000 },
    });
  });

  it('coerces numeric variables from strings', () => {
    const config = loadConfig({
      ...REQUIRED_ENV,
      API_PORT: '8080',
      DATABASE_POOL_MAX: '3',
      CACHE_TTL_SECONDS: '60',
    });

    expect(config.server.port).toBe(8080);
    expect(config.postgres.poolMax).toBe(3);
    expect(config.cache.ttlSeconds).toBe(60);
  });

  it('treats empty values as unset instead of coercing them to 0', () => {
    const config = loadConfig({ ...REQUIRED_ENV, API_PORT: '', LOG_LEVEL: '  ' });

    expect(config.server.port).toBe(4000);
    expect(config.log.level).toBe('info');
  });

  it('only enables pretty logs in development', () => {
    expect(loadConfig({ ...REQUIRED_ENV, NODE_ENV: 'production' }).log.pretty).toBe(false);
    expect(loadConfig({ ...REQUIRED_ENV, NODE_ENV: 'test' }).log.pretty).toBe(false);
  });

  it('reports every missing required variable at once', () => {
    const error = captureConfigError({});

    expect(error.problems).toEqual(['DATABASE_URL: is required', 'REDIS_URL: is required']);
  });

  it('rejects URLs with the wrong scheme', () => {
    const error = captureConfigError({ ...REQUIRED_ENV, DATABASE_URL: 'mysql://localhost/db' });

    expect(error.problems).toEqual(['DATABASE_URL: must be a postgres:// URL']);
  });

  it('rejects out-of-range and malformed values', () => {
    const error = captureConfigError({
      ...REQUIRED_ENV,
      API_PORT: '70000',
      LOG_LEVEL: 'verbose',
      CACHE_TTL_SECONDS: '0',
    });

    expect(error.problems).toHaveLength(3);
    expect(error.problems[0]).toMatch(/^API_PORT:/);
    expect(error.problems[1]).toMatch(/^LOG_LEVEL:/);
    expect(error.problems[2]).toMatch(/^CACHE_TTL_SECONDS:/);
  });

  it('never includes variable values in the error message', () => {
    const error = captureConfigError({
      ...REQUIRED_ENV,
      DATABASE_URL: 'mysql://admin:super-secret@db/prod',
    });

    expect(error.message).not.toContain('super-secret');
  });
});
