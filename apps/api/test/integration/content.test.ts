import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createPostgresPool } from '../../src/infra/postgres.js';
import { closeRedis, createRedisClient } from '../../src/infra/redis.js';
import type { Profile, Project, ProjectSummary } from '../../src/schema/content.schema.js';
import { CONTENT_CACHE_KEYS } from '../../src/dal/content-cache.dal.js';
import { createContentDal } from '../../src/dal/content.dal.js';
import type { DataResponseBody } from '../../src/views/data.view.js';
import type { ErrorResponseBody } from '../../src/views/error.view.js';
import { counterValue } from '../helpers/metrics.js';
import { SAMPLE_CONTENT } from '../helpers/sample-content.js';
import {
  createTestDependencies,
  UNREACHABLE_POSTGRES_URL,
  UNREACHABLE_REDIS_URL,
  type TestDependencies,
} from '../helpers/test-dependencies.js';

describe('content API with live Postgres and Redis', () => {
  let deps: TestDependencies;
  let app: FastifyInstance;

  beforeAll(async () => {
    deps = await createTestDependencies();
    app = buildApp(deps);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await deps.close();
  });

  beforeEach(async () => {
    // Every test starts from the same published content and an empty cache (Redis DB 1 only).
    await deps.postgres.query('TRUNCATE profile, experiences, education, projects');
    await createContentDal(deps.postgres).replaceAll(SAMPLE_CONTENT);
    await deps.redis.flushdb();
  });

  it('GET /api/v1/profile misses, then hits the cache', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/v1/profile' });
    const second = await app.inject({ method: 'GET', url: '/api/v1/profile' });

    expect(first.statusCode).toBe(200);
    expect(first.headers['x-cache']).toBe('miss');
    expect(second.headers['x-cache']).toBe('hit');
    expect(second.json()).toEqual(first.json());

    const profile = first.json<DataResponseBody<Profile>>().data;
    expect(profile.fullName).toBe('Ada Lovelace');
    expect(profile.experiences.map((experience) => experience.company)).toEqual([
      'Analytical Engine Ltd',
      'Difference Engine Co',
    ]);
    expect(profile.education).toEqual([
      expect.objectContaining({
        institution: 'University of London',
        startDate: '1840-01-01',
        endDate: '1841-12-31',
        highlights: ['Studied under Augustus De Morgan'],
      }),
      expect.objectContaining({ institution: 'Home schooling', endDate: null }),
    ]);
    expect(profile.experiences[1]).toMatchObject({
      startDate: '1840-03-01',
      endDate: '1841-12-31',
    });
  });

  it('GET /api/v1/projects lists featured projects first, without descriptions', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/projects' });

    expect(response.statusCode).toBe(200);
    const projects = response.json<DataResponseBody<ProjectSummary[]>>().data;
    expect(projects.map((project) => project.slug)).toEqual(['note-g', 'bernoulli-numbers']);
    expect(projects[0]).not.toHaveProperty('description');
  });

  it('GET /api/v1/projects/:slug returns the full project', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/projects/note-g' });

    expect(response.statusCode).toBe(200);
    const { updatedAt, ...project } = response.json<DataResponseBody<Project>>().data;
    expect(updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(project).toEqual({
      slug: 'note-g',
      title: 'Note G',
      summary: 'Annotated translation.',
      description: 'Notes on the Analytical Engine.',
      techStack: [],
      repoUrl: 'https://github.com/example/note-g',
      liveUrl: null,
      featured: true,
      sections: [
        {
          heading: 'How it works',
          body: 'A table of operations.\n\nOne row per step.',
          points: ['Loops over the variables', 'Stores results on the Store'],
        },
        { heading: 'Legacy', body: null, points: ['Called the first program'] },
      ],
    });
  });

  it('GET /api/v1/projects/:slug returns an empty sections list for a project without any', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/projects/bernoulli-numbers' });

    expect(response.statusCode).toBe(200);
    expect(response.json<DataResponseBody<Project>>().data.sections).toEqual([]);
  });

  it('stores cache entries with a TTL within ±10 % of CACHE_TTL_SECONDS', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/projects' });

    const ttl = await deps.redis.ttl(CONTENT_CACHE_KEYS.projects);
    const base = deps.config.cache.ttlSeconds;
    expect(ttl).toBeGreaterThanOrEqual(Math.floor(base * 0.9) - 1);
    expect(ttl).toBeLessThanOrEqual(Math.ceil(base * 1.1));
  });

  it('returns 404 NOT_FOUND for an unknown project', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/projects/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorResponseBody>().error.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR for a malformed slug', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/projects/Bad_Slug' });

    expect(response.statusCode).toBe(400);
    const { error } = response.json<ErrorResponseBody>();
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details?.[0]?.path).toBe('slug');
  });

  it('returns 404 for the profile when no content has been published', async () => {
    await deps.postgres.query('TRUNCATE profile, experiences, education, projects');

    const response = await app.inject({ method: 'GET', url: '/api/v1/profile' });

    expect(response.statusCode).toBe(404);
  });

  it('replaces a corrupt cache entry with fresh data from Postgres', async () => {
    await deps.redis.set(CONTENT_CACHE_KEYS.projects, '{"not": "a list"');

    const response = await app.inject({ method: 'GET', url: '/api/v1/projects' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-cache']).toBe('miss');
    const repaired: unknown = JSON.parse((await deps.redis.get(CONTENT_CACHE_KEYS.projects)) ?? '');
    expect(repaired).toHaveLength(2);
  });
});

describe('content API with Redis down', () => {
  let deps: TestDependencies;

  beforeAll(async () => {
    deps = await createTestDependencies();
    await deps.postgres.query('TRUNCATE profile, experiences, education, projects');
    await createContentDal(deps.postgres).replaceAll(SAMPLE_CONTENT);
  });

  afterAll(async () => {
    await deps.close();
  });

  it('serves content from Postgres and counts the cache error', async () => {
    const deadRedis = createRedisClient(
      { url: UNREACHABLE_REDIS_URL, connectionName: 'dead-redis' },
      deps.logger,
      deps.metrics,
    );
    const app = buildApp({ ...deps, redis: deadRedis });

    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/projects' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['x-cache']).toBe('miss');
      expect(response.json<DataResponseBody<ProjectSummary[]>>().data).toHaveLength(2);
      expect(await counterValue(deps.metrics.cacheErrors, { operation: 'read' })).toBe(1);
      expect(await counterValue(deps.metrics.cacheErrors, { operation: 'write' })).toBe(1);
    } finally {
      await app.close();
      await closeRedis(deadRedis);
    }
  });
});

describe('content API with Postgres down', () => {
  let deps: TestDependencies;

  beforeAll(async () => {
    deps = await createTestDependencies();
    await deps.postgres.query('TRUNCATE profile, experiences, education, projects');
    await createContentDal(deps.postgres).replaceAll(SAMPLE_CONTENT);
    await deps.redis.flushdb();
  });

  afterAll(async () => {
    await deps.close();
  });

  // Regression test: found in the guided tour, a cache miss used to return 500 INTERNAL_ERROR.
  it('serves cached entries, and answers 503 (not 500) for a cache miss', async () => {
    const healthyApp = buildApp(deps);
    await healthyApp.inject({ method: 'GET', url: '/api/v1/projects' }); // warm one key
    await healthyApp.close();

    const deadPostgres = createPostgresPool(
      { url: UNREACHABLE_POSTGRES_URL, poolMax: 1, applicationName: 'dead-postgres' },
      deps.logger,
      deps.metrics,
    );
    const app = buildApp({ ...deps, postgres: deadPostgres });

    try {
      const cached = await app.inject({ method: 'GET', url: '/api/v1/projects' });
      const uncached = await app.inject({ method: 'GET', url: '/api/v1/projects/note-g' });

      expect(cached.statusCode).toBe(200);
      expect(cached.headers['x-cache']).toBe('hit');
      expect(uncached.statusCode).toBe(503);
      expect(uncached.json<ErrorResponseBody>().error.code).toBe('SERVICE_UNAVAILABLE');
    } finally {
      await app.close();
      await deadPostgres.end();
    }
  });
});
