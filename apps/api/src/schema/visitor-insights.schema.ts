/**
 * GET /api/v1/admin/visitors (DESIGN.md §7.8). Request and response are the public contract
 * (the web app's /admin page sends and parses them), so they live in `@portfolio/shared`.
 */
export {
  visitorSummaryQuerySchema,
  type Visit,
  type VisitorSummary,
  type VisitorSummaryQuery,
} from '@portfolio/shared';
