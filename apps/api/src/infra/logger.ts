import type { FastifyBaseLogger } from 'fastify';
import { pino, type LoggerOptions } from 'pino';
import type { AppConfig } from '../config/env.js';

/** What every module logs with: the root Pino logger or a request's `request.log`. */
export type Logger = FastifyBaseLogger;

/** Root JSON logger; Fastify makes a child per request (with requestId). */
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
