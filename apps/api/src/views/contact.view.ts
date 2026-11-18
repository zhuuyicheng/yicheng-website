import type { ContactAccepted } from '../schema/contact-message.schema.js';
import type { DataResponseBody } from './data.view.js';

/** Only the id and status: the visitor already knows what they wrote. */
export function renderContactAccepted(
  accepted: ContactAccepted,
): DataResponseBody<ContactAccepted> {
  return { data: { id: accepted.id, status: accepted.status } };
}
