import {
  systemStatusSchema,
  visitorSummarySchema,
  type SystemStatus,
  type VisitorSummary,
} from '@portfolio/shared';
import { z } from 'zod';
import { ApiUnavailableError } from './api';
import { adminToken, serverApiBaseUrl } from './config';

/**
 * The owner's API reads (/api/v1/admin/*, DESIGN.md §7.8), made by the Next.js server with
 * ADMIN_TOKEN as the bearer token. Server code only (the /admin page and its route): the
 * token never goes to the browser.
 */
async function getOwnerData<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>> {
  const token = adminToken();
  if (token === undefined) {
    throw new ApiUnavailableError(path, new Error('ADMIN_TOKEN is not set'));
  }

  let response: Response;
  try {
    response = await fetch(`${serverApiBaseUrl()}${path}`, {
      cache: 'no-store',
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    });
  } catch (error) {
    throw new ApiUnavailableError(path, error);
  }
  if (!response.ok) {
    throw new ApiUnavailableError(path, new Error(`HTTP ${String(response.status)}`));
  }
  const envelope = z.object({ data: z.unknown() }).parse(await response.json());
  return schema.parse(envelope.data);
}

export function getVisitorSummary(days: number): Promise<VisitorSummary> {
  return getOwnerData(`/api/v1/admin/visitors?days=${String(days)}`, visitorSummarySchema);
}

export function getSystemStatus(): Promise<SystemStatus> {
  return getOwnerData('/api/v1/admin/system-status', systemStatusSchema);
}
