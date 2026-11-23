import type { Redis } from '../infra/redis.js';
import type { QueueDepths } from '../schema/system-status.schema.js';
import { TELEMETRY_BUFFER_KEYS } from './event-buffer.dal.js';
import { NOTIFICATION_QUEUE_KEYS } from './notification-queue.dal.js';
import { execOrThrow } from './redis-exec.js';

/** How full each queue is, for the status report and /metrics. Read-only. */
export interface QueueDepthDal {
  readDepths: () => Promise<QueueDepths>;
}

export function createQueueDepthDal(redis: Redis): QueueDepthDal {
  return {
    async readDepths() {
      // One round trip; LLEN and ZCARD are O(1).
      const results = await execOrThrow(
        redis
          .pipeline()
          .llen(TELEMETRY_BUFFER_KEYS.buffer)
          .llen(TELEMETRY_BUFFER_KEYS.deadLetter)
          .llen(NOTIFICATION_QUEUE_KEYS.ready)
          .zcard(NOTIFICATION_QUEUE_KEYS.delayed)
          .llen(NOTIFICATION_QUEUE_KEYS.deadLetter),
      );
      const [buffer, telemetryDlq, ready, delayed, notificationsDlq] = results.map(Number);
      return {
        telemetryBuffer: buffer ?? 0,
        telemetryDeadLetter: telemetryDlq ?? 0,
        notificationsReady: ready ?? 0,
        notificationsDelayed: delayed ?? 0,
        notificationsDeadLetter: notificationsDlq ?? 0,
      };
    },
  };
}
