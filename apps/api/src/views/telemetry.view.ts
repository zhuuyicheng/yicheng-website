import type { EventAccepted } from '../schema/analytics-event.schema.js';
import type { DataResponseBody } from './data.view.js';

export function renderEventAccepted(accepted: EventAccepted): DataResponseBody<EventAccepted> {
  return { data: { eventId: accepted.eventId } };
}
