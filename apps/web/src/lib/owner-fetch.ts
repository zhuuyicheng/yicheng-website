import type { z } from 'zod';

/**
 * Reads an owner-only route from the browser and checks its `{ data }` against a schema. The
 * browser resends the /admin password itself (HTTP Basic).
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
