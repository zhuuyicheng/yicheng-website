import { randomUUID } from 'node:crypto';
import type { ContactMessageDal } from '../dal/contact-message.dal.js';
import type { NotificationQueueDal } from '../dal/notification-queue.dal.js';
import type { Logger } from '../infra/logger.js';
import {
  deadLetteredJobSchema,
  notificationJobSchema,
  type NotificationJob,
} from '../schema/notification-job.schema.js';
import type { ReplayOutcome } from './telemetry-dlq.manager.js';

/**
 * The notification dead-letter queue (DESIGN.md §8.3). A job lands there when notifying failed
 * for good, and its message is FAILED. After fixing the cause (a new webhook URL, Discord is
 * back), replaying reopens each message and queues a fresh job with a full set of attempts.
 */
export interface NotificationDlqManager {
  replay: (log: Logger) => Promise<ReplayOutcome>;
}

export function createNotificationDlqManager(deps: {
  queueDal: Pick<NotificationQueueDal, 'listDeadLetters' | 'replayDeadLetter'>;
  contactMessageDal: Pick<ContactMessageDal, 'reopenFailed'>;
  /** Injectable for tests. */
  now?: () => Date;
  newJobId?: () => string;
}): NotificationDlqManager {
  const { queueDal, contactMessageDal, now = () => new Date(), newJobId = randomUUID } = deps;

  return {
    async replay(log) {
      const entries = await queueDal.listDeadLetters();
      let replayed = 0;
      let unreadable = 0;

      for (const [index, entry] of entries.entries()) {
        const job = readDeadLetteredJob(entry);
        if (job === null) {
          // e.g. an `invalid_payload` dead letter: there is no job in it to replay.
          unreadable += 1;
          log.warn({ index }, 'unreadable DLQ entry left in place');
          continue;
        }

        // Reopen first: a fresh job for a message that is still FAILED would just be skipped.
        // A crash right after leaves it PENDING without a job, which the reconciler repairs.
        await contactMessageDal.reopenFailed(job.messageId);
        const freshJob: NotificationJob = {
          jobId: newJobId(),
          messageId: job.messageId,
          attempt: 1,
          enqueuedAt: now().toISOString(),
        };
        await queueDal.replayDeadLetter(entry, JSON.stringify(freshJob));
        replayed += 1;
      }

      return { replayed, unreadable };
    },
  };
}

/** The job inside a DLQ entry, or `null` if either layer is unreadable. */
function readDeadLetteredJob(entry: string): NotificationJob | null {
  const deadLetter = deadLetteredJobSchema.safeParse(parseJson(entry));
  if (!deadLetter.success) {
    return null;
  }
  const job = notificationJobSchema.safeParse(parseJson(deadLetter.data.payload));
  return job.success ? job.data : null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined; // fails the schema check, which reports it as unreadable
  }
}
