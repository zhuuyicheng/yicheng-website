import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type NodeEnv = 'development' | 'test' | 'production';

/** Typed, structured configuration consumed by the rest of the application. */
export interface AppConfig {
  nodeEnv: NodeEnv;
  /** `trustProxy`: honour X-Forwarded-For, so `request.ip` is the visitor behind a proxy. */
  server: { host: string; port: number; trustProxy: boolean };
  log: { level: LogLevel; pretty: boolean };
  postgres: { url: string; poolMax: number };
  redis: { url: string };
  cache: { ttlSeconds: number };
  telemetry: { bufferMaxLength: number; batchSize: number; flushIntervalMs: number };
  /** GeoIP database files; `null` = that lookup is disabled (its fields stay null). */
  ipLookup: { asnDbPath: string | null; locationDbPath: string | null };
  shutdown: { timeoutMs: number };
}

/** A required URL whose scheme must match `protocol` (e.g. postgres or redis). */
function requiredUrl(protocol: RegExp, expected: string) {
  return z.url({
    protocol,
    error: (issue) => (issue.input === undefined ? 'is required' : `must be a ${expected} URL`),
  });
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(0).max(65_535).default(4000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DATABASE_URL: requiredUrl(/^postgres(ql)?$/, 'postgres://'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_URL: requiredUrl(/^rediss?$/, 'redis://'),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(10_000),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(1).max(86_400).default(300),
  // Only "true"/"false" (and 1/0, yes/no, on/off): a typo must fail, not silently mean false.
  TRUST_PROXY: z.stringbool().default(false),
  TELEMETRY_BUFFER_MAX_LENGTH: z.coerce.number().int().min(1).max(10_000_000).default(100_000),
  TELEMETRY_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(50),
  TELEMETRY_FLUSH_INTERVAL_MS: z.coerce.number().int().min(100).max(300_000).default(5_000),
  GEOIP_ASN_DB_PATH: z.string().optional(),
  GEOIP_LOCATION_DB_PATH: z.string().optional(),
});

export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    const list = problems.map((problem) => `  - ${problem}`).join('\n');
    super(`Invalid environment configuration:\n${list}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/**
 * Validates environment variables and returns typed config.
 * Throws a ConfigError listing every problem at once (names and reasons, never values).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(withoutEmptyValues(env));

  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new ConfigError(problems);
  }

  const vars = result.data;
  return {
    nodeEnv: vars.NODE_ENV,
    server: { host: vars.API_HOST, port: vars.API_PORT, trustProxy: vars.TRUST_PROXY },
    log: { level: vars.LOG_LEVEL, pretty: vars.NODE_ENV === 'development' },
    postgres: { url: vars.DATABASE_URL, poolMax: vars.DATABASE_POOL_MAX },
    redis: { url: vars.REDIS_URL },
    cache: { ttlSeconds: vars.CACHE_TTL_SECONDS },
    telemetry: {
      bufferMaxLength: vars.TELEMETRY_BUFFER_MAX_LENGTH,
      batchSize: vars.TELEMETRY_BATCH_SIZE,
      flushIntervalMs: vars.TELEMETRY_FLUSH_INTERVAL_MS,
    },
    ipLookup: {
      asnDbPath: vars.GEOIP_ASN_DB_PATH ?? null,
      locationDbPath: vars.GEOIP_LOCATION_DB_PATH ?? null,
    },
    shutdown: { timeoutMs: vars.SHUTDOWN_TIMEOUT_MS },
  };
}

/**
 * For process entrypoints: load config, or print the problems and exit with code 1.
 * Runs before a logger exists, so it writes straight to stderr.
 */
export function loadConfigOrExit(): AppConfig {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Treats `FOO=` (empty or whitespace) as unset, so it falls back to the default or fails
 * as missing. Without this, `API_PORT=` would silently coerce to port 0.
 */
function withoutEmptyValues(env: NodeJS.ProcessEnv): Record<string, string> {
  const entries = Object.entries(env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && entry[1].trim() !== '',
  );
  return Object.fromEntries(entries);
}
