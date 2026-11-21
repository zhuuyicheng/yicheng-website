/**
 * GET /api/v1/admin/system-status (DESIGN.md §7.7). The response is the public contract (the
 * web app's /admin dashboard parses it), so its schema lives in `@portfolio/shared`.
 */
export type { QueueDepths, SystemStatus } from '@portfolio/shared';
