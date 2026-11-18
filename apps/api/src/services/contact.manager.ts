import { randomUUID } from 'node:crypto';
import type { ContactMessageDal } from '../dal/contact-message.dal.js';
import type { NotificationQueueDal } from '../dal/notification-queue.dal.js';
import type { IpHasher } from '../infra/ip-hash.js';
import type { Logger } from '../infra/logger.js';
import type { Metrics } from '../infra/metrics.js';
import type { ContactAccepted, ContactRequest } from '../schema/contact-message.schema.js';
import type { NotificationJob } from '../schema/notification-job.schema.js';

/** Who sent the message, as far as the server can tell. */
export interface ContactSender {
  ip: string;
}

/**
 * The contact form (DESIGN.md §8.3): store the message, then queue a job that tells the site
 * owner about it. The worker sends the notification, so a slow webhook never slows the visitor.
 */
export interface ContactManager {
  submit: (request: ContactRequest, sender: ContactSender, log: Logger) => Promise<ContactAccepted>;
}

export interface ContactManagerDependencies {
  contactMessageDal: Pick<ContactMessageDal, 'insert'>;
  notificationQueueDal: Pick<NotificationQueueDal, 'enqueue'>;
  hashIp: IpHasher;
  metrics: Metrics;
  /** Injectable for tests. */
  now?: () => Date;
  newJobId?: () => string;
}

export function createContactManager(deps: ContactManagerDependencies): ContactManager {
  const { contactMessageDal, notificationQueueDal, hashIp, metrics } = deps;
  const { now = () => new Date(), newJobId = randomUUID } = deps;

  return {
    async submit(request, sender, log) {
      // 1. Postgres first: once this succeeds, the message is safe, whatever happens next.
      //    If Postgres is down this throws, and the error handler answers 503.
      const stored = await contactMessageDal.insert({ ...request, ipHash: hashIp(sender.ip) });

      // 2. Then the job. Two datastores cannot be written atomically, so a failure here is
      //    expected now and then. The visitor still gets 202 (their message IS saved), and the
      //    reconciler in the worker queues every message left PENDING for too long.
      const job: NotificationJob = {
        jobId: newJobId(),
        messageId: stored.id,
        attempt: 1,
        enqueuedAt: now().toISOString(),
      };
      try {
        await notificationQueueDal.enqueue(JSON.stringify(job));
      } catch (error) {
        metrics.notificationEnqueueFailures.inc();
        log.error(
          { err: error, messageId: stored.id },
          'contact message saved but not queued; the reconciler will queue it',
        );
      }

      return { id: stored.id, status: stored.status };
    },
  };
}
