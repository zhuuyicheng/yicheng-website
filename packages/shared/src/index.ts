/**
 * The API contract (DESIGN.md §3), imported by both the API and the web app so they can't
 * drift apart. Internal shapes stay in apps/api/src/schema.
 */
export * from './contact.js';
export * from './content.js';
export * from './envelope.js';
export * from './events.js';
export * from './queue-items.js';
export * from './system-status.js';
export * from './visitors.js';
