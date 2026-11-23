import type { z } from 'zod';

/**
 * Reads one of this web server's owner-only routes from the browser (`/admin/system-status`,
 * `/admin/queues/…`) and checks the `{ data }` it answers against the shared contract. The
 * browser resends the owner's /admin password by itself (HTTP Basic, DESIGN.md §8.7).
 */
export async function fetchOwnerData<T extends z.ZodType>(options: {
  url: string;
  schema: T;
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
}): Promise<z.infer<T>> {
  const response = await options.fetch(options.url, {
    cache: 'no-store',
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`${options.url} answered ${String(response.status)}`);
  }
  const body: unknown = await response.json();
  const parsed = options.schema.safeParse(
    typeof body === 'object' && body !== null && 'data' in body ? body.data : undefined,
  );
  if (!parsed.success) {
    throw new Error(`${options.url} answered something unexpected`);
  }
  return parsed.data;
}
