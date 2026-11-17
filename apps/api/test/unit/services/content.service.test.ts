import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/errors/app-error.js';
import { createMetrics } from '../../../src/infra/metrics.js';
import type { PortfolioContent, Profile, Project } from '../../../src/models/content.model.js';
import {
  CONTENT_CACHE_KEYS,
  type ContentCacheStore,
} from '../../../src/repositories/content-cache.store.js';
import type { ContentRepository } from '../../../src/repositories/content.repository.js';
import { createCacheAside } from '../../../src/services/cache-aside.js';
import { createContentService } from '../../../src/services/content.service.js';
import { SAMPLE_CONTENT } from '../../helpers/sample-content.js';

const log = pino({ level: 'silent' });

/** An in-memory repository that behaves like the SQL one for the given content. */
function createFakeRepository(): ContentRepository & { content: PortfolioContent | null } {
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
  };
}

function toProject(project: PortfolioContent['projects'][number]): Project {
  return project;
}

function createFakeCacheStore(): ContentCacheStore & { entries: Map<string, string> } {
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
  const repository = createFakeRepository();
  const cacheStore = createFakeCacheStore();
  const cache = createCacheAside({ store: cacheStore, metrics: createMetrics(), ttlSeconds: 60 });
  const service = createContentService({ repository, cacheStore, cache });
  return { repository, cacheStore, service };
}

describe('ContentService', () => {
  it('throws NOT_FOUND for the profile before content is published', async () => {
    const { service } = setup();

    await expect(service.getProfile(log)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    });
  });

  it('throws NOT_FOUND for an unknown project slug', async () => {
    const { service, repository } = setup();
    repository.content = SAMPLE_CONTENT;

    const error = await service.getProject('does-not-exist', log).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).toBe('Project "does-not-exist" not found');
  });

  it('returns an empty list, not 404, when there are no projects', async () => {
    const { service } = setup();

    const result = await service.listProjects(log);

    expect(result.value).toEqual([]);
  });

  it('publish saves the content, replaces stale cache entries, and warms every key', async () => {
    const { service, repository, cacheStore } = setup();
    cacheStore.entries.set(CONTENT_CACHE_KEYS.projects, '[]'); // stale: published before the seed
    cacheStore.entries.set(CONTENT_CACHE_KEYS.project('removed-project'), '{}');

    const summary = await service.publish(SAMPLE_CONTENT, log);

    expect(repository.content).toBe(SAMPLE_CONTENT);
    expect(summary).toEqual({ experiences: 2, projects: 2, cacheKeysCleared: 2 });
    expect([...cacheStore.entries.keys()].sort()).toEqual([
      CONTENT_CACHE_KEYS.profile,
      CONTENT_CACHE_KEYS.project('bernoulli-numbers'),
      CONTENT_CACHE_KEYS.project('note-g'),
      CONTENT_CACHE_KEYS.projects,
    ]);
    const cachedProjects: unknown = JSON.parse(
      cacheStore.entries.get(CONTENT_CACHE_KEYS.projects) ?? '',
    );
    expect(cachedProjects).toHaveLength(2);
  });

  it('publish fails loudly if the cache cannot be cleared after saving', async () => {
    const { service, repository, cacheStore } = setup();
    cacheStore.deleteAllContent = vi.fn(() => Promise.reject(new Error('redis unavailable')));

    await expect(service.publish(SAMPLE_CONTENT, log)).rejects.toThrow('redis unavailable');
    expect(repository.content).toBe(SAMPLE_CONTENT); // Postgres stays the source of truth
  });
});
