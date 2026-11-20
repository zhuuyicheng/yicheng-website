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
 * Telemetry ingestion (DESIGN.md §8.2). Accepting an event only appends it to a Redis list;
 * the worker writes it to Postgres later, so a slow or down database never slows a visitor.
 */
export interface TelemetryManager {
  ingest: (event: EventRequest, visitor: Visitor, log: Logger) => Promise<EventAccepted>;
}

export interface TelemetryManagerDependencies {
  /** Ingestion only ever appends; claiming and acknowledging belong to the flusher. */
  bufferDal: Pick<EventBufferDal, 'enqueue'>;
  saltDal: TelemetrySaltDal;
  visitorDetails: VisitorDetailsManager;
  metrics: Metrics;
  bufferMaxLength: number;
  /** Injectable for tests. */
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

  // Remembers today's salt, so Redis is asked once per day per process, not per event.
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
          throw error; // a bug, not an outage: let it surface as a 500
        }
        // No in-memory fallback on purpose: events held in this process would be lost on a
        // crash, and the client can simply retry. DESIGN.md §9.
        reject('redis_unavailable', log);
        throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, UNAVAILABLE_MESSAGE, { cause: error });
      }

      if (!accepted) {
        // The worker is not keeping up (or not running). Refusing is better than letting
        // Redis run out of memory.
        reject('buffer_full', log);
        throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, UNAVAILABLE_MESSAGE);
      }

      metrics.telemetryEventsIngested.inc({ type: request.type });
      return { eventId };
    },
  };
}

/** `/projects/x?utm_source=y#top` → `/projects/x`. Query strings can carry personal data. */
export function stripQueryAndFragment(path: string): string {
  const end = path.search(/[?#]/);
  return end === -1 ? path : path.slice(0, end);
}

/** `https://news.ycombinator.com/item?id=1` → `news.ycombinator.com`. */
export function hostOf(referrer: string | null | undefined): string | null {
  return referrer ? new URL(referrer).hostname : null;
}

/**
 * sha256 of salt, IP and user agent. The same visitor gives the same hash all day (so unique
 * visitors can be counted) but a different one tomorrow (so nobody can be tracked across
 * days), and the hash cannot be reversed to the IP. The newline separators keep the parts
 * unambiguous ("1.2.3.4" + "5x" must not equal "1.2.3.45" + "x"); headers cannot contain one.
 */
/**
 * The address as Postgres INET will accept it, or null. `request.ip` is normally a valid
 * IPv4 or IPv6 address; anything else would fail the whole batch insert in the worker.
 */
export function storableIp(ip: string): string | null {
  return isIP(ip) === 0 ? null : ip;
}

export function hashVisitor(salt: string, visitor: Pick<Visitor, 'ip' | 'userAgent'>): string {
  return createHash('sha256').update(`${salt}\n${visitor.ip}\n${visitor.userAgent}`).digest('hex');
}
