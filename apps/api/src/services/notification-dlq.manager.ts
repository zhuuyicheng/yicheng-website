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
 * Replays notification dead letters (DESIGN.md §8.3) once the cause is fixed: reopens each
 * FAILED message and queues a fresh job with a full set of attempts.
 */
export interface NotificationDlqManager {
  replay: (log: Logger) => Promise<ReplayOutcome>;
}

export function createNotificationDlqManager(deps: {
  queueDal: Pick<NotificationQueueDal, 'listDeadLetters' | 'replayDeadLetter'>;
  contactMessageDal: Pick<ContactMessageDal, 'reopenFailed'>;
  /** For tests. */
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
          // e.g. `invalid_payload`: there's no job to replay.
          unreadable += 1;
          log.warn({ index }, 'unreadable DLQ entry left in place');
          continue;
        }

        // Reopen first: a job for a FAILED message would be skipped. A crash after this leaves
        // it PENDING without a job, which the reconciler repairs.
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

/** The job inside a DLQ entry, or `null` if unreadable. */
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
    return undefined; // the schema check then reports it unreadable
  }
}
