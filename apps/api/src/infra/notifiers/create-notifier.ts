import type { NotifierConfig } from '../../config/env.js';
import type { Logger } from '../logger.js';
import { createDiscordNotifier } from './discord.notifier.js';
import { createLogNotifier } from './log.notifier.js';
import type { Notifier } from './notifier.js';

/** The notifier NOTIFIER_DRIVER asks for. Called by the worker's composition root. */
export function createNotifier(config: NotifierConfig, logger: Logger): Notifier {
  switch (config.driver) {
    case 'log':
      return createLogNotifier(logger);
    case 'discord':
      return createDiscordNotifier({ webhookUrl: config.webhookUrl });
  }
}
