/**
 * @portfolio/shared: the API contract (DESIGN.md §3). Both the API and the web app import
 * these schemas, so the two cannot drift apart: change a field here, and the compiler points
 * at every place on either side that needs to follow.
 *
 * Only the public contract lives here. Internal shapes (buffered events, notification jobs,
 * dead letters, the content file) stay in apps/api/src/schema.
 */
export * from './contact.js';
export * from './content.js';
export * from './envelope.js';
export * from './events.js';
export * from './queue-items.js';
export * from './system-status.js';
export * from './visitors.js';
