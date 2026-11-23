import {
  queueItemsSchema,
  visitorSummarySchema,
  type QueueItems,
  type QueueName,
  type VisitorSummary,
} from '@portfolio/shared';
import { z } from 'zod';
import { ApiUnavailableError } from './api';
import { adminToken, serverApiBaseUrl } from './config';
import { dashboardStatusSchema, type DashboardStatus } from './status';

/** Owner API reads (DESIGN.md §7.8) with ADMIN_TOKEN. Server only: it never reaches a browser. */
async function getOwnerData<T extends z.ZodType>(
  path: string,
  schema: T,
  options: { signal?: AbortSignal } = {},
): Promise<z.infer<T>> {
  const token = adminToken();
  if (token === undefined) {
    throw new ApiUnavailableError(path, new Error('ADMIN_TOKEN is not set'));
  }

  let response: Response;
  try {
    response = await fetch(`${serverApiBaseUrl()}${path}`, {
      cache: 'no-store',
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      ...(options.signal ? { signal: options.signal } : {}),
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

/** The dashboard says so after this long, rather than wait for a stuck API. */
const STATUS_TIMEOUT_MS = 3_000;

/**
 * The API's status for the dashboard (DESIGN.md §15.5), through Caddy like every owner read: its
 * dependencies, queues and page views are the same whichever replica answers.
 */
export function getSystemStatus(): Promise<DashboardStatus> {
  return getOwnerData('/api/v1/admin/system-status', dashboardStatusSchema, {
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
  });
}

export function getQueueItems(queue: QueueName, limit: number): Promise<QueueItems> {
  return getOwnerData(`/api/v1/admin/queues/${queue}?limit=${String(limit)}`, queueItemsSchema);
}
