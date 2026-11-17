import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/errors/app-error.js';
import { createMetrics } from '../../../src/infra/metrics.js';
import type { PortfolioContent, Profile, Project } from '../../../src/schema/content.schema.js';
import { CONTENT_CACHE_KEYS, type ContentCacheDal } from '../../../src/dal/content-cache.dal.js';
import type { ContentDal } from '../../../src/dal/content.dal.js';
import { createCacheAsideManager } from '../../../src/services/cache-aside.manager.js';
import { createContentManager } from '../../../src/services/content.manager.js';
import { SAMPLE_CONTENT } from '../../helpers/sample-content.js';

const log = pino({ level: 'silent' });

/** An in-memory DAL that behaves like the SQL one for the given content. */
function createFakeDal(): ContentDal & { content: PortfolioContent | null } {
  const fake = {
    content: null as PortfolioContent | null,
    findProfile: () => Promise.resolve(fake.content ? toProfile(fake.content) : null),
    listProjects: () => Promise.resolve(fake.content ? fake.content.projects.map(toProject) : []),
    findProjectBySlug: (slug: string) => {
      const project = fake.content?.projects.find((candidate) => candidate.slug === slug);
      return Promise.resolve(project ? toProject(project) : null);
    },
    replaceAll: (content: PortfolioContent) => {
      fake.content = content;
      return Promise.resolve();
    },
  };
  return fake;
}

function toProfile(content: PortfolioContent): Profile {
  return {
    ...content.profile,
    experiences: content.experiences.map((experience, index) => ({
      ...experience,
      id: `experience-${String(index)}`,
    })),
    education: content.education.map((entry, index) => ({
      ...entry,
      id: `education-${String(index)}`,
    })),
  };
}

function toProject(project: PortfolioContent['projects'][number]): Project {
  return project;
}

function createFakeCacheDal(): ContentCacheDal & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    get: (key) => Promise.resolve(entries.get(key) ?? null),
    set: (key, value) => {
      entries.set(key, value);
      return Promise.resolve();
    },
    deleteAllContent: () => {
      const count = entries.size;
      entries.clear();
      return Promise.resolve(count);
    },
  };
}

function setup() {
  const dal = createFakeDal();
  const cacheDal = createFakeCacheDal();
  const cache = createCacheAsideManager({ cacheDal, metrics: createMetrics(), ttlSeconds: 60 });
  const manager = createContentManager({ dal, cacheDal, cache });
  return { dal, cacheDal, manager };
}

describe('ContentManager', () => {
  it('throws NOT_FOUND for the profile before content is published', async () => {
    const { manager } = setup();

    await expect(manager.getProfile(log)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    });
  });

  it('throws NOT_FOUND for an unknown project slug', async () => {
    const { manager, dal } = setup();
    dal.content = SAMPLE_CONTENT;

    const error = await manager.getProject('does-not-exist', log).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).toBe('Project "does-not-exist" not found');
  });

  it('returns an empty list, not 404, when there are no projects', async () => {
    const { manager } = setup();

    const result = await manager.listProjects(log);

    expect(result.value).toEqual([]);
  });

  it('publish saves the content, replaces stale cache entries, and warms every key', async () => {
    const { manager, dal, cacheDal } = setup();
    cacheDal.entries.set(CONTENT_CACHE_KEYS.projects, '[]'); // stale: published before the seed
    cacheDal.entries.set(CONTENT_CACHE_KEYS.project('removed-project'), '{}');

    const summary = await manager.publish(SAMPLE_CONTENT, log);

    expect(dal.content).toBe(SAMPLE_CONTENT);
    expect(summary).toEqual({ experiences: 2, education: 2, projects: 2, cacheKeysCleared: 2 });
    expect([...cacheDal.entries.keys()].sort()).toEqual(
      [
        CONTENT_CACHE_KEYS.profile,
        CONTENT_CACHE_KEYS.project('bernoulli-numbers'),
        CONTENT_CACHE_KEYS.project('note-g'),
        CONTENT_CACHE_KEYS.projects,
      ].sort(),
    );
    const cachedProjects: unknown = JSON.parse(
      cacheDal.entries.get(CONTENT_CACHE_KEYS.projects) ?? '',
    );
    expect(cachedProjects).toHaveLength(2);
  });

  it('publish fails loudly if the cache cannot be cleared after saving', async () => {
    const { manager, dal, cacheDal } = setup();
    cacheDal.deleteAllContent = vi.fn(() => Promise.reject(new Error('redis unavailable')));

    await expect(manager.publish(SAMPLE_CONTENT, log)).rejects.toThrow('redis unavailable');
    expect(dal.content).toBe(SAMPLE_CONTENT); // Postgres stays the source of truth
  });
});
