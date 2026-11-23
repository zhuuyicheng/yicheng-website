import type { ContactMessageDal } from '../dal/contact-message.dal.js';
import type { EventBufferDal } from '../dal/event-buffer.dal.js';
import type { NotificationQueueDal } from '../dal/notification-queue.dal.js';
import type { Logger } from '../infra/logger.js';
import {
  bufferedEventSchema,
  deadLetteredEventSchema,
  type BufferedEvent,
} from '../schema/analytics-event.schema.js';
import type { ContactMessage } from '../schema/contact-message.schema.js';
import {
  deadLetteredJobSchema,
  notificationJobSchema,
  type NotificationJob,
} from '../schema/notification-job.schema.js';
import type {
  DeadLetter,
  QueueItem,
  QueueItems,
  QueueName,
  QueuedEvent,
  QueuedMessage,
} from '../schema/queue-items.schema.js';

/** An unreadable entry is shown by its first characters: enough to recognise it. */
export const RAW_PREVIEW_CHARS = 300;

/**
 * What waits in each Redis queue, for the owner's queue card on /admin (DESIGN.md §7.8): the
 * visits not saved yet, the contact messages you have not been told about, and why each dead
 * letter failed. Reading never takes anything out, so looking cannot change what the worker
 * does. A notification job holds ids only (§8.3), so its message is looked up in Postgres.
 */
export interface QueueItemsManager {
  getItems: (queue: QueueName, limit: number, log: Logger) => Promise<QueueItems>;
}

type Reader = (limit: number) => Promise<{ total: number; items: QueueItem[] }>;

export function createQueueItemsManager(deps: {
  bufferDal: Pick<EventBufferDal, 'peekBuffer' | 'peekDeadLetters'>;
  queueDal: Pick<NotificationQueueDal, 'peekReady' | 'peekDelayed' | 'peekDeadLetters'>;
  contactMessageDal: Pick<ContactMessageDal, 'findByIds'>;
  /** Injectable for tests. */
  now?: () => Date;
}): QueueItemsManager {
  const { bufferDal, queueDal, contactMessageDal, now = () => new Date() } = deps;

  /** Notification items, each with its message: one Postgres query for all of them. */
  async function withMessages(entries: readonly JobEntry[]): Promise<QueueItem[]> {
    const ids = new Set(entries.flatMap(({ job }) => (job === null ? [] : [job.messageId])));
    const found = await contactMessageDal.findByIds([...ids]);
    const messages = new Map(found.map((message) => [message.id, message]));
    return entries.map(({ job, raw, dueAtMs, deadLetter }) => {
      const message = job === null ? undefined : messages.get(job.messageId);
      return {
        kind: 'notification',
        attempt: job?.attempt ?? null,
        dueAt: dueAtMs === null ? null : new Date(dueAtMs).toISOString(),
        message: message === undefined ? null : toQueuedMessage(message),
        deadLetter,
        raw: job === null ? clip(raw) : null,
      };
    });
  }

  // A `Record`: a queue added to the contract without a reader here fails the typecheck.
  const readers: Record<QueueName, Reader> = {
    async telemetryBuffer(limit) {
      const peek = await bufferDal.peekBuffer(limit);
      return { total: peek.total, items: peek.entries.map(eventItem) };
    },
    async telemetryDeadLetter(limit) {
      const peek = await bufferDal.peekDeadLetters(limit);
      return { total: peek.total, items: peek.entries.map(deadLetteredEventItem) };
    },
    async notificationsReady(limit) {
      const peek = await queueDal.peekReady(limit);
      const entries = peek.entries.map((entry) => jobEntry(entry, null));
      return { total: peek.total, items: await withMessages(entries) };
    },
    async notificationsDelayed(limit) {
      const peek = await queueDal.peekDelayed(limit);
      const entries = peek.entries.map(({ entry, dueAtMs }) => jobEntry(entry, dueAtMs));
      return { total: peek.total, items: await withMessages(entries) };
    },
    async notificationsDeadLetter(limit) {
      const peek = await queueDal.peekDeadLetters(limit);
      return {
        total: peek.total,
        items: await withMessages(peek.entries.map(deadLetteredJobEntry)),
      };
    },
  };

  return {
    async getItems(queue, limit, log) {
      const { total, items } = await readers[queue](limit);
      // Entries the worker did not write (a dead letter's unreadable payload is expected).
      const unreadable = items.flatMap((item, index) =>
        item.raw !== null && item.deadLetter === null ? [index] : [],
      );
      if (unreadable.length > 0) {
        // Positions only: an entry may hold visitor data.
        log.warn({ queue, positions: unreadable }, 'unreadable queue entries shown as raw text');
      }
      return { queue, total, items, generatedAt: now().toISOString() };
    },
  };
}

function eventItem(entry: string): QueueItem {
  const event = readEvent(entry);
  return { kind: 'event', event, deadLetter: null, raw: event === null ? clip(entry) : null };
}

function deadLetteredEventItem(entry: string): QueueItem {
  const deadLettered = deadLetteredEventSchema.safeParse(parseJson(entry));
  if (!deadLettered.success) {
    return { kind: 'event', event: null, deadLetter: null, raw: clip(entry) };
  }
  const { payload, reason, errorCode, errorMessage, failedAt } = deadLettered.data;
  const event = readEvent(payload); // `invalid_payload`: unreadable, so `raw` shows it
  return {
    kind: 'event',
    event,
    deadLetter: { reason, error: errorMessage, errorCode, failedAt },
    raw: event === null ? clip(payload) : null,
  };
}

/** A notification job as found in a queue, with whatever of it could be read. */
interface JobEntry {
  job: NotificationJob | null;
  /** The text holding the job: the queue entry, or a dead letter's `payload`. */
  raw: string;
  dueAtMs: number | null;
  deadLetter: DeadLetter | null;
}

function jobEntry(entry: string, dueAtMs: number | null): JobEntry {
  return { job: readJob(entry), raw: entry, dueAtMs, deadLetter: null };
}

function deadLetteredJobEntry(entry: string): JobEntry {
  const deadLettered = deadLetteredJobSchema.safeParse(parseJson(entry));
  if (!deadLettered.success) {
    return { job: null, raw: entry, dueAtMs: null, deadLetter: null };
  }
  const { payload, reason, error, failedAt } = deadLettered.data;
  return {
    job: readJob(payload),
    raw: payload,
    dueAtMs: null,
    deadLetter: { reason, error, errorCode: null, failedAt },
  };
}

function readEvent(text: string): QueuedEvent | null {
  const parsed = bufferedEventSchema.safeParse(parseJson(text));
  return parsed.success ? toQueuedEvent(parsed.data) : null;
}

function readJob(text: string): NotificationJob | null {
  const parsed = notificationJobSchema.safeParse(parseJson(text));
  return parsed.success ? parsed.data : null;
}

function toQueuedEvent(event: BufferedEvent): QueuedEvent {
  return {
    id: event.id,
    type: event.type,
    name: event.name,
    path: event.path,
    receivedAt: event.receivedAt,
    referrer: event.referrerHost,
    organization: event.network.organization,
    city: event.network.city,
    countryCode: event.network.countryCode,
    deviceType: event.device.type,
    browser: event.device.browser,
    os: event.device.os,
  };
}

function toQueuedMessage(message: ContactMessage): QueuedMessage {
  return {
    id: message.id,
    name: message.name,
    email: message.email,
    message: message.message,
    status: message.status,
    lastError: message.lastError,
    createdAt: message.createdAt.toISOString(),
  };
}

function clip(text: string): string {
  return text.length <= RAW_PREVIEW_CHARS ? text : `${text.slice(0, RAW_PREVIEW_CHARS)}…`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined; // fails the schema check, which reports it as unreadable
  }
}
