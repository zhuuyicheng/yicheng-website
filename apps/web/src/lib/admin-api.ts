import {
  queueItemsSchema,
  systemStatusSchema,
  visitorSummarySchema,
  type QueueItems,
  type QueueName,
  type VisitorSummary,
} from '@portfolio/shared';
import { z } from 'zod';
import { ApiUnavailableError } from './api';
import { adminToken, apiReplicas, serverApiBaseUrl } from './config';
import type { ReplicaStatuses } from './status';

/**
 * The owner's API reads (/api/v1/admin/*, DESIGN.md §7.8), made by the Next.js server with
 * ADMIN_TOKEN as the bearer token. Server code only (the /admin page and its route): the
 * token never goes to the browser.
 */
async function getOwnerData<T extends z.ZodType>(
  path: string,
  schema: T,
  options: { baseUrl?: string; signal?: AbortSignal } = {},
): Promise<z.infer<T>> {
  const token = adminToken();
  if (token === undefined) {
    throw new ApiUnavailableError(path, new Error('ADMIN_TOKEN is not set'));
  }

  let response: Response;
  try {
    response = await fetch(`${options.baseUrl ?? serverApiBaseUrl()}${path}`, {
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

/** A replica silent this long is reported as such, so a stuck one cannot hold up the page. */
const REPLICA_TIMEOUT_MS = 3_000;

/**
 * Every API replica's own status, for the live dashboard (DESIGN.md §8.6). Each is asked at
 * its own address (API_REPLICA_URLS), not through Caddy, which would hand the request to just
 * one of them. One that fails or takes longer than 3 s is listed with `status: null`, and the
 * dashboard names it instead of losing the others' numbers too.
 */
export async function getReplicaStatuses(): Promise<ReplicaStatuses> {
  const replicas = apiReplicas();
  const answers = await Promise.allSettled(
    replicas.map((replica) =>
      getOwnerData('/api/v1/admin/system-status', systemStatusSchema, {
        baseUrl: replica.url,
        signal: AbortSignal.timeout(REPLICA_TIMEOUT_MS),
      }),
    ),
  );
  return {
    replicas: replicas.map((replica, index) => {
      const answer = answers[index];
      return { name: replica.name, status: answer?.status === 'fulfilled' ? answer.value : null };
    }),
  };
}

export function getQueueItems(queue: QueueName, limit: number): Promise<QueueItems> {
  return getOwnerData(`/api/v1/admin/queues/${queue}?limit=${String(limit)}`, queueItemsSchema);
}
