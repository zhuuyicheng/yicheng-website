import type { Logger } from '../logger.js';
import type { Notifier } from './notifier.js';

/**
 * For development: one log line instead of a real service. Logs ids and sizes only, no
 * personal data; read the message in Postgres (docs/sql/contact.sql).
 */
export function createLogNotifier(logger: Logger): Notifier {
  return {
    driver: 'log',

    send(message) {
      logger.info(
        { messageId: message.id, messageLength: message.message.length },
        'new contact message (log notifier: set NOTIFIER_DRIVER=discord to really send it)',
      );
      return Promise.resolve();
    },
  };
}
