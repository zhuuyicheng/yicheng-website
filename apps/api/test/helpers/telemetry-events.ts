import { randomUUID } from 'node:crypto';
import {
  unknownCampaign,
  unknownDevice,
  unknownNetwork,
  type BufferedEvent,
} from '../../src/schema/analytics-event.schema.js';

/** A valid Redis buffer entry, exactly as the API writes one. */
export function bufferedEventJson(overrides: Partial<BufferedEvent> = {}): string {
  const event: BufferedEvent = {
    id: randomUUID(),
    type: 'page_view',
    name: null,
    path: '/',
    referrerHost: null,
    sessionId: 'k3J9xQ2mP0aZ',
    visitorHash: 'a'.repeat(64),
    receivedAt: new Date().toISOString(),
    campaign: unknownCampaign(),
    device: unknownDevice(),
    network: unknownNetwork(),
    ipAddress: null,
    ...overrides,
  };
  return JSON.stringify(event);
}
