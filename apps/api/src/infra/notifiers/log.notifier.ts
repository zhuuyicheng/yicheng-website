import type { Logger } from '../logger.js';
import type { Notifier } from './notifier.js';

/**
 * The development notifier: writes one log line instead of calling a real service, so the
 * whole pipeline runs without a Discord webhook. Never fails.
 *
 * It logs ids and sizes only, not the visitor's name, email or text (personal data stays out
 * of logs). Read the message itself in Postgres (docs/sql/contact.sql).
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
