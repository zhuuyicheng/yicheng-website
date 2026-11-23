import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { EventBufferDal } from '../dal/event-buffer.dal.js';
import type { TelemetrySaltDal } from '../dal/telemetry-salt.dal.js';
import { AppError, ErrorCode } from '../errors/app-error.js';
import type { Logger } from '../infra/logger.js';
import type { Metrics, TelemetryRejectReason } from '../infra/metrics.js';
import { isTransientDatastoreError } from '../infra/transient-error.js';
import type {
  BufferedEvent,
  EventAccepted,
  EventRequest,
} from '../schema/analytics-event.schema.js';
import type { Visitor, VisitorDetailsManager } from './visitor-details.manager.js';

/**
 * Telemetry ingestion (DESIGN.md §8.2): only appends to a Redis list; the worker writes to
 * Postgres later, so a slow database never slows a visitor.
 */
export interface TelemetryManager {
  ingest: (event: EventRequest, visitor: Visitor, log: Logger) => Promise<EventAccepted>;
}

export interface TelemetryManagerDependencies {
  /** Ingestion only appends; claiming belongs to the flusher. */
  bufferDal: Pick<EventBufferDal, 'enqueue'>;
  saltDal: TelemetrySaltDal;
  visitorDetails: VisitorDetailsManager;
  metrics: Metrics;
  bufferMaxLength: number;
  /** For tests. */
  now?: () => Date;
  newEventId?: () => string;
  newSalt?: () => string;
}

const UNAVAILABLE_MESSAGE = 'Telemetry is temporarily unavailable. Please retry shortly.';

export function createTelemetryManager(deps: TelemetryManagerDependencies): TelemetryManager {
  const {
    bufferDal,
    saltDal,
    visitorDetails,
    metrics,
    bufferMaxLength,
    now = () => new Date(),
    newEventId = randomUUID,
    newSalt = () => randomBytes(32).toString('hex'),
  } = deps;

  // Today's salt, so Redis is asked once a day per process, not per event.
  let saltOfTheDay: { date: string; salt: string } | null = null;

  async function dailySalt(at: Date): Promise<string> {
    const date = at.toISOString().slice(0, 10); // UTC day, e.g. "2026-11-17"
    if (saltOfTheDay?.date !== date) {
      saltOfTheDay = { date, salt: await saltDal.getOrCreate(date, newSalt()) };
    }
    return saltOfTheDay.salt;
  }

  function reject(reason: TelemetryRejectReason, log: Logger): void {
    metrics.telemetryEventsRejected.inc({ reason });
    log.warn({ reason }, 'telemetry event rejected');
  }

  return {
    async ingest(request, visitor, log) {
      const receivedAt = now();
      const eventId = newEventId();

      let accepted: boolean;
      try {
        const salt = await dailySalt(receivedAt);
        const event: BufferedEvent = {
          id: eventId,
          type: request.type,
          name: request.name ?? null,
          path: stripQueryAndFragment(request.path),
          referrerHost: hostOf(request.referrer),
          sessionId: request.sessionId,
          visitorHash: hashVisitor(salt, visitor),
          receivedAt: receivedAt.toISOString(),
          ...visitorDetails.describe(request, visitor), // campaign, device, network
          ipAddress: storableIp(visitor.ip),
        };
        accepted = await bufferDal.enqueue(JSON.stringify(event), bufferMaxLength);
      } catch (error) {
        if (!isTransientDatastoreError(error)) {
          throw error; // a bug, not an outage: a 500
        }
        // No in-memory fallback: a crash would lose them, and the client can retry (DESIGN.md §9).
        reject('redis_unavailable', log);
        throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, UNAVAILABLE_MESSAGE, { cause: error });
      }

      if (!accepted) {
        // The worker isn't keeping up (or running). Better to refuse than run Redis out of memory.
        reject('buffer_full', log);
        throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, UNAVAILABLE_MESSAGE);
      }

      metrics.telemetryEventsIngested.inc({ type: request.type });
      return { eventId };
    },
  };
}

/** `/page?utm_source=y#top` → `/page`: query strings can carry personal data. */
export function stripQueryAndFragment(path: string): string {
  const end = path.search(/[?#]/);
  return end === -1 ? path : path.slice(0, end);
}

/** `https://news.ycombinator.com/item?id=1` → `news.ycombinator.com`. */
export function hostOf(referrer: string | null | undefined): string | null {
  return referrer ? new URL(referrer).hostname : null;
}

/** The IP if Postgres INET accepts it, else null (a bad one would fail the whole batch). */
export function storableIp(ip: string): string | null {
  return isIP(ip) === 0 ? null : ip;
}

/**
 * sha256(salt, IP, user agent): the same all day (unique visitors), different tomorrow, and
 * irreversible. Newlines keep the parts unambiguous; headers can't contain one.
 */
export function hashVisitor(salt: string, visitor: Pick<Visitor, 'ip' | 'userAgent'>): string {
  return createHash('sha256').update(`${salt}\n${visitor.ip}\n${visitor.userAgent}`).digest('hex');
}
