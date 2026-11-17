import { AppError, ErrorCode } from '../errors/app-error.js';
import type { Logger } from '../infra/logger.js';
import {
  profileSchema,
  projectListSchema,
  projectSchema,
  type PortfolioContent,
  type Profile,
  type Project,
  type ProjectSummary,
} from '../models/content.model.js';
import { CONTENT_CACHE_KEYS, type ContentCacheStore } from '../repositories/content-cache.store.js';
import type { ContentRepository } from '../repositories/content.repository.js';
import type { CacheAside, Cached } from './cache-aside.js';

export interface PublishSummary {
  experiences: number;
  projects: number;
  cacheKeysCleared: number;
}

export interface ContentService {
  getProfile: (log: Logger) => Promise<Cached<Profile>>;
  listProjects: (log: Logger) => Promise<Cached<ProjectSummary[]>>;
  getProject: (slug: string, log: Logger) => Promise<Cached<Project>>;
  /** `content:seed`: save to Postgres, clear the cache, then warm it again. */
  publish: (content: PortfolioContent, log: Logger) => Promise<PublishSummary>;
}

export interface ContentServiceDependencies {
  repository: ContentRepository;
  cacheStore: ContentCacheStore;
  cache: CacheAside;
}

export function createContentService(dependencies: ContentServiceDependencies): ContentService {
  const { repository, cacheStore, cache } = dependencies;

  const service: ContentService = {
    async getProfile(log) {
      const result = await cache.read(
        {
          cacheName: 'profile',
          key: CONTENT_CACHE_KEYS.profile,
          schema: profileSchema,
          load: repository.findProfile,
        },
        log,
      );
      return found(result, 'Profile has not been published yet');
    },

    async listProjects(log) {
      const result = await cache.read(
        {
          cacheName: 'projects',
          key: CONTENT_CACHE_KEYS.projects,
          schema: projectListSchema,
          load: repository.listProjects,
        },
        log,
      );
      // listProjects never returns null (no projects is an empty list); this narrows the type.
      return found(result, 'Projects not found');
    },

    async getProject(slug, log) {
      const result = await cache.read(
        {
          cacheName: 'project',
          key: CONTENT_CACHE_KEYS.project(slug),
          schema: projectSchema,
          load: () => repository.findProjectBySlug(slug),
        },
        log,
      );
      return found(result, `Project "${slug}" not found`);
    },

    async publish(content, log) {
      await repository.replaceAll(content);

      // Postgres is updated, so every cached copy is now stale. A failure here is not
      // swallowed: the seed exits non-zero and says the cache may be stale until its TTL.
      const cacheKeysCleared = await cacheStore.deleteAllContent();

      // Warm the cache through the normal read path, so the first visitor gets a hit.
      await service.getProfile(log);
      const projects = await service.listProjects(log);
      for (const project of projects.value) {
        await service.getProject(project.slug, log);
      }

      return {
        experiences: content.experiences.length,
        projects: content.projects.length,
        cacheKeysCleared,
      };
    },
  };

  return service;
}

function found<T>(result: Cached<T | null>, notFoundMessage: string): Cached<T> {
  if (result.value === null) {
    throw new AppError(ErrorCode.NOT_FOUND, notFoundMessage);
  }
  return { value: result.value, cache: result.cache };
}
