import {
  profileSchema,
  projectListSchema,
  projectSchema,
  type Profile,
  type Project,
  type ProjectSummary,
} from '@portfolio/shared';
import { connection } from 'next/server';
import { cache } from 'react';
import { z } from 'zod';
import { serverApiBaseUrl } from './config';

/**
 * Portfolio content from the API, for Server Components. Responses are checked against the
 * shared contract, so a disagreement fails loudly instead of rendering half-empty.
 */

export class ApiUnavailableError extends Error {
  constructor(path: string, cause: unknown) {
    super(`API request ${path} failed`, { cause });
    this.name = 'ApiUnavailableError';
  }
}

/** `null` for 404; anything else that isn't a valid 200 throws (error.tsx then shows a retry). */
async function getData<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T> | null> {
  // At request time, not during `next build`: the build mustn't need the API running.
  await connection();

  let response: Response;
  try {
    response = await fetch(`${serverApiBaseUrl()}${path}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    throw new ApiUnavailableError(path, error); // connection refused, DNS, …
  }
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new ApiUnavailableError(path, new Error(`HTTP ${String(response.status)}`));
  }
  // The envelope first, then the payload against its contract.
  const envelope = z.object({ data: z.unknown() }).parse(await response.json());
  return schema.parse(envelope.data);
}

// React's `cache`: getProfile() twice in one render (metadata and page) is one request.

/** `null` until content is seeded. */
export const getProfile = cache((): Promise<Profile | null> =>
  getData('/api/v1/profile', profileSchema),
);

export const getProjects = cache(
  async (): Promise<ProjectSummary[]> =>
    (await getData('/api/v1/projects', projectListSchema)) ?? [],
);

export const getProject = cache((slug: string): Promise<Project | null> =>
  getData(`/api/v1/projects/${encodeURIComponent(slug)}`, projectSchema),
);
