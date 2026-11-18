import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../../src/config/env.js';

const REQUIRED_ENV = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379/0',
  IP_HASH_SECRET: 'unit-test-ip-hash-secret-0123456789abcdef',
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
      server: { host: '0.0.0.0', port: 4000, trustProxy: false },
      log: { level: 'info', pretty: true },
      postgres: { url: REQUIRED_ENV.DATABASE_URL, poolMax: 10 },
      redis: { url: REQUIRED_ENV.REDIS_URL },
      cache: { ttlSeconds: 300 },
      telemetry: { bufferMaxLength: 100_000, batchSize: 50, flushIntervalMs: 5_000 },
      ipLookup: { asnDbPath: null, locationDbPath: null },
      ipHash: { secret: REQUIRED_ENV.IP_HASH_SECRET },
      contact: { rateLimitMax: 3, rateLimitWindowSeconds: 600 },
      notifications: { notifier: { driver: 'log' }, maxAttempts: 3, backoffBaseMs: 5_000 },
      shutdown: { timeoutMs: 10_000 },
    });
  });

  it('reads the contact rate limit, and refuses a short IP_HASH_SECRET', () => {
    const config = loadConfig({
      ...REQUIRED_ENV,
      CONTACT_RATE_LIMIT_MAX: '5',
      CONTACT_RATE_LIMIT_WINDOW_SECONDS: '60',
    });

    expect(config.contact).toEqual({ rateLimitMax: 5, rateLimitWindowSeconds: 60 });
    // A short secret is guessable, and then every IP hash can be reversed.
    expect(captureConfigError({ ...REQUIRED_ENV, IP_HASH_SECRET: 'too-short' }).problems).toEqual([
      'IP_HASH_SECRET: must be at least 32 characters (try: openssl rand -hex 32)',
    ]);
    expect(captureConfigError({ ...REQUIRED_ENV, CONTACT_RATE_LIMIT_MAX: '0' }).problems).toEqual([
      expect.stringMatching(/^CONTACT_RATE_LIMIT_MAX:/),
    ]);
  });

  it('reads the worker settings and the GeoIP database paths', () => {
    const config = loadConfig({
      ...REQUIRED_ENV,
      TELEMETRY_BATCH_SIZE: '200',
      TELEMETRY_FLUSH_INTERVAL_MS: '1000',
      GEOIP_ASN_DB_PATH: 'data/geoip/dbip-asn-lite.mmdb',
      GEOIP_LOCATION_DB_PATH: '/srv/geoip/city.mmdb',
    });

    expect(config.telemetry).toMatchObject({ batchSize: 200, flushIntervalMs: 1_000 });
    expect(config.ipLookup).toEqual({
      asnDbPath: 'data/geoip/dbip-asn-lite.mmdb',
      locationDbPath: '/srv/geoip/city.mmdb',
    });
    // A batch must fit in one INSERT; a 0 ms interval would spin the worker.
    expect(
      captureConfigError({
        ...REQUIRED_ENV,
        TELEMETRY_BATCH_SIZE: '5000',
        TELEMETRY_FLUSH_INTERVAL_MS: '0',
      }).problems,
    ).toEqual([
      expect.stringMatching(/^TELEMETRY_BATCH_SIZE:/),
      expect.stringMatching(/^TELEMETRY_FLUSH_INTERVAL_MS:/),
    ]);
  });

  it('reads the Discord notifier settings', () => {
    const config = loadConfig({
      ...REQUIRED_ENV,
      NOTIFIER_DRIVER: 'discord',
      DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/abc',
      NOTIFY_MAX_ATTEMPTS: '5',
      NOTIFY_BACKOFF_BASE_MS: '1000',
    });

    expect(config.notifications).toEqual({
      notifier: { driver: 'discord', webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
      maxAttempts: 5,
      backoffBaseMs: 1_000,
    });
  });

  it('requires DISCORD_WEBHOOK_URL for the discord driver, reported with every other problem', () => {
    const error = captureConfigError({
      ...REQUIRED_ENV,
      NOTIFIER_DRIVER: 'discord',
      NOTIFY_MAX_ATTEMPTS: '0',
    });

    expect(error.problems).toEqual([
      expect.stringMatching(/^NOTIFY_MAX_ATTEMPTS:/),
      'DISCORD_WEBHOOK_URL: is required when NOTIFIER_DRIVER=discord',
    ]);
  });

  it('refuses a webhook URL that is not https, without printing it', () => {
    const error = captureConfigError({
      ...REQUIRED_ENV,
      NOTIFIER_DRIVER: 'discord',
      DISCORD_WEBHOOK_URL: 'http://discord.com/api/webhooks/123/secret-token',
    });

    expect(error.problems).toEqual(['DISCORD_WEBHOOK_URL: must be an https:// URL']);
    expect(error.message).not.toContain('secret-token');
  });

  it('parses TRUST_PROXY strictly and the telemetry buffer cap as a number', () => {
    const config = loadConfig({
      ...REQUIRED_ENV,
      TRUST_PROXY: 'true',
      TELEMETRY_BUFFER_MAX_LENGTH: '500',
    });

    expect(config.server.trustProxy).toBe(true);
    expect(config.telemetry.bufferMaxLength).toBe(500);
    // A typo must not silently mean "false".
    expect(captureConfigError({ ...REQUIRED_ENV, TRUST_PROXY: 'ture' }).problems).toEqual([
      expect.stringMatching(/^TRUST_PROXY:/),
    ]);
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

    expect(error.problems).toEqual([
      'DATABASE_URL: is required',
      'REDIS_URL: is required',
      'IP_HASH_SECRET: is required',
    ]);
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
