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
 * The contact form (DESIGN.md §8.3): store the message, then queue the notification. The
 * worker sends it, so a slow webhook never slows the visitor.
 */
export interface ContactManager {
  submit: (request: ContactRequest, sender: ContactSender, log: Logger) => Promise<ContactAccepted>;
}

export interface ContactManagerDependencies {
  contactMessageDal: Pick<ContactMessageDal, 'insert'>;
  notificationQueueDal: Pick<NotificationQueueDal, 'enqueue'>;
  hashIp: IpHasher;
  metrics: Metrics;
  /** For tests. */
  now?: () => Date;
  newJobId?: () => string;
}

export function createContactManager(deps: ContactManagerDependencies): ContactManager {
  const { contactMessageDal, notificationQueueDal, hashIp, metrics } = deps;
  const { now = () => new Date(), newJobId = randomUUID } = deps;

  return {
    async submit(request, sender, log) {
      // 1. Postgres first: once stored, the message is safe. If Postgres is down, this is a 503.
      const stored = await contactMessageDal.insert({ ...request, ipHash: hashIp(sender.ip) });

      // 2. The job. Two datastores can't be written atomically, so this may fail now and then: the
      //    visitor still gets 202, and the reconciler queues messages left PENDING too long.
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
