import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createNotifier } from '../../../../src/infra/notifiers/create-notifier.js';
import { contactMessage } from '../../../helpers/contact-messages.js';

const logger = pino({ level: 'silent' });

describe('createNotifier', () => {
  it('builds the notifier NOTIFIER_DRIVER names', () => {
    expect(createNotifier({ driver: 'log' }, logger).driver).toBe('log');
    expect(
      createNotifier(
        { driver: 'discord', webhookUrl: 'https://discord.com/api/webhooks/1/x' },
        logger,
      ).driver,
    ).toBe('discord');
  });

  it('log notifier: always succeeds, so the pipeline runs without a webhook', async () => {
    await expect(createNotifier({ driver: 'log' }, logger).send(contactMessage())).resolves.toBe(
      undefined,
    );
  });
});
