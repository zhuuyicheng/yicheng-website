import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type NodeEnv = 'development' | 'test' | 'production';

/** Where the worker sends "you have a new contact message" notifications. */
export type NotifierConfig = { driver: 'log' } | { driver: 'discord'; webhookUrl: string };

/** Typed configuration for the rest of the app. */
export interface AppConfig {
  nodeEnv: NodeEnv;
  /** `trustProxy`: take the visitor's IP from X-Forwarded-For. */
  server: { host: string; port: number; trustProxy: boolean };
  log: { level: LogLevel; pretty: boolean };
  postgres: { url: string; poolMax: number };
  redis: { url: string };
  cache: { ttlSeconds: number };
  telemetry: { bufferMaxLength: number; batchSize: number; flushIntervalMs: number };
  /** The worker's GET /metrics listens on `server.host` and this port (DESIGN.md §15.2). */
  worker: { metricsPort: number };
  /** GeoIP database files; `null` turns that lookup off. */
  ipLookup: { asnDbPath: string | null; locationDbPath: string | null };
  /** HMAC key for hashing IPs (rate-limit keys, `contact_messages.ip_hash`). */
  ipHash: { secret: string };
  /** At most `rateLimitMax` contact messages per sender per window. */
  contact: { rateLimitMax: number; rateLimitWindowSeconds: number };
  /** `maxAttempts` includes the first attempt. */
  notifications: { notifier: NotifierConfig; maxAttempts: number; backoffBaseMs: number };
  /** Browser origins allowed to call the API, e.g. `https://example.com`. */
  cors: { origins: string[] };
  /** If set, GET /metrics needs `Authorization: Bearer <token>`. */
  metrics: { token: string | null };
  /** Required by /api/v1/admin/*; `null` = those endpoints don't exist. */
  admin: { token: string | null };
  shutdown: { timeoutMs: number };
}

/** `https://example.com` is an origin; `https://example.com/` and `example.com` are not. */
function isOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
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
  // Strict on purpose: a typo must fail, not quietly mean false.
  TRUST_PROXY: z.stringbool().default(false),
  TELEMETRY_BUFFER_MAX_LENGTH: z.coerce.number().int().min(1).max(10_000_000).default(100_000),
  TELEMETRY_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(50),
  TELEMETRY_FLUSH_INTERVAL_MS: z.coerce.number().int().min(100).max(300_000).default(5_000),
  WORKER_METRICS_PORT: z.coerce.number().int().min(0).max(65_535).default(4001),
  GEOIP_ASN_DB_PATH: z.string().optional(),
  GEOIP_LOCATION_DB_PATH: z.string().optional(),
  // A secret, so no default: every environment picks its own.
  IP_HASH_SECRET: z
    .string({ error: 'is required' })
    .min(32, 'must be at least 32 characters (try: openssl rand -hex 32)'),
  CONTACT_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1_000).default(3),
  CONTACT_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(600),
  NOTIFIER_DRIVER: z.enum(['log', 'discord']).default('log'),
  // A secret: the URL holds the token that lets anyone post to the channel.
  DISCORD_WEBHOOK_URL: z.url({ protocol: /^https$/, error: 'must be an https:// URL' }).optional(),
  NOTIFY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  NOTIFY_BACKOFF_BASE_MS: z.coerce.number().int().min(10).max(60_000).default(5_000),
  // Comma-separated origins: scheme, host, port; no path.
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) => value.split(',').map((origin) => origin.trim()))
    .refine((origins) => origins.every(isOrigin), {
      message: 'must be comma-separated origins such as https://example.com (no path, no "/")',
    }),
  METRICS_TOKEN: z.string().min(16, 'must be at least 16 characters').optional(),
  // A secret: the /admin password and the web server's bearer token for /api/v1/admin/*.
  ADMIN_TOKEN: z
    .string()
    .min(32, 'must be at least 32 characters (try: openssl rand -hex 32)')
    .optional(),
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

/** Validates the environment. Throws a ConfigError listing every problem (never values). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const values = withoutEmptyValues(env);
  const result = envSchema.safeParse(values);
  const problems = result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);

  // Two-variable rules, checked here because a Zod refinement only runs once every field is
  // valid, and all problems should be reported at once.
  if (values.NOTIFIER_DRIVER === 'discord' && values.DISCORD_WEBHOOK_URL === undefined) {
    problems.push('DISCORD_WEBHOOK_URL: is required when NOTIFIER_DRIVER=discord');
  }

  if (!result.success || problems.length > 0) {
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
    worker: { metricsPort: vars.WORKER_METRICS_PORT },
    ipLookup: {
      asnDbPath: vars.GEOIP_ASN_DB_PATH ?? null,
      locationDbPath: vars.GEOIP_LOCATION_DB_PATH ?? null,
    },
    ipHash: { secret: vars.IP_HASH_SECRET },
    contact: {
      rateLimitMax: vars.CONTACT_RATE_LIMIT_MAX,
      rateLimitWindowSeconds: vars.CONTACT_RATE_LIMIT_WINDOW_SECONDS,
    },
    notifications: {
      // Always set for discord (checked above); the check is for TypeScript.
      notifier:
        vars.NOTIFIER_DRIVER === 'discord' && vars.DISCORD_WEBHOOK_URL !== undefined
          ? { driver: 'discord', webhookUrl: vars.DISCORD_WEBHOOK_URL }
          : { driver: 'log' },
      maxAttempts: vars.NOTIFY_MAX_ATTEMPTS,
      backoffBaseMs: vars.NOTIFY_BACKOFF_BASE_MS,
    },
    cors: { origins: vars.CORS_ORIGINS },
    metrics: { token: vars.METRICS_TOKEN ?? null },
    admin: { token: vars.ADMIN_TOKEN ?? null },
    shutdown: { timeoutMs: vars.SHUTDOWN_TIMEOUT_MS },
  };
}

/** For entrypoints: load config, or print the problems to stderr and exit 1 (no logger yet). */
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

/** `FOO=` counts as unset; otherwise `API_PORT=` would quietly become port 0. */
function withoutEmptyValues(env: NodeJS.ProcessEnv): Record<string, string> {
  const entries = Object.entries(env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && entry[1].trim() !== '',
  );
  return Object.fromEntries(entries);
}
