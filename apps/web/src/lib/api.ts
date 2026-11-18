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
 * Reads portfolio content from the API while a page renders on the Next.js server. Server
 * Components only: browsers never call these.
 *
 * Each response is checked against the shared contract (`@portfolio/shared`), so if the API
 * and the site ever disagree, the page fails loudly instead of rendering half-empty.
 */

export class ApiUnavailableError extends Error {
  constructor(path: string, cause: unknown) {
    super(`API request ${path} failed`, { cause });
    this.name = 'ApiUnavailableError';
  }
}

/**
 * `null` for 404 (e.g. an unknown project slug). Anything else that is not a valid 200 throws,
 * and the nearest error.tsx shows "API unreachable" with a retry button.
 */
async function getData<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T> | null> {
  // Render at request time, not during `next build`: the content lives in the API (which
  // keeps it in Redis), and the build must not depend on the API running.
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
  // The `{ data }` envelope first, then the payload against its contract.
  const envelope = z.object({ data: z.unknown() }).parse(await response.json());
  return schema.parse(envelope.data);
}

// `cache` (React): within one page render, calling getProfile() twice (e.g. in generateMetadata
// and in the page) makes one request, not two.

/** `null` until the content has been seeded (`npm run content:seed`). */
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
