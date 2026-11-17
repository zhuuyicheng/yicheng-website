import type { FastifyBaseLogger } from 'fastify';
import { pino, type LoggerOptions } from 'pino';
import type { AppConfig } from '../config/env.js';

/**
 * The logging interface every module depends on. Both the root Pino logger and Fastify's
 * per-request `request.log` (a child carrying the requestId) satisfy it.
 */
export type Logger = FastifyBaseLogger;

/** Root JSON logger. Fastify derives a per-request child logger (with requestId) from it. */
export function createLogger(config: Pick<AppConfig, 'log'>): Logger {
  const options: LoggerOptions = {
    level: config.log.level,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie'],
      censor: '[REDACTED]',
    },
  };

  if (config.log.pretty) {
    options.transport = {
      target: 'pino-pretty',
      options: { translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
    };
  }

  return pino(options);
}
