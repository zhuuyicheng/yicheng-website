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
} from '../schema/content.schema.js';
import { CONTENT_CACHE_KEYS, type ContentCacheDal } from '../dal/content-cache.dal.js';
import type { ContentDal } from '../dal/content.dal.js';
import type { CacheAsideManager, Cached } from './cache-aside.manager.js';

export interface PublishSummary {
  experiences: number;
  education: number;
  projects: number;
  cacheKeysCleared: number;
}

export interface ContentManager {
  getProfile: (log: Logger) => Promise<Cached<Profile>>;
  listProjects: (log: Logger) => Promise<Cached<ProjectSummary[]>>;
  getProject: (slug: string, log: Logger) => Promise<Cached<Project>>;
  /** `content:seed`: save to Postgres, clear the cache, then warm it again. */
  publish: (content: PortfolioContent, log: Logger) => Promise<PublishSummary>;
}

export interface ContentManagerDependencies {
  dal: ContentDal;
  cacheDal: ContentCacheDal;
  cache: CacheAsideManager;
}

export function createContentManager(dependencies: ContentManagerDependencies): ContentManager {
  const { dal, cacheDal, cache } = dependencies;

  const manager: ContentManager = {
    async getProfile(log) {
      const result = await cache.read(
        {
          cacheName: 'profile',
          key: CONTENT_CACHE_KEYS.profile,
          schema: profileSchema,
          load: dal.findProfile,
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
          load: dal.listProjects,
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
          load: () => dal.findProjectBySlug(slug),
        },
        log,
      );
      return found(result, `Project "${slug}" not found`);
    },

    async publish(content, log) {
      await dal.replaceAll(content);

      // Postgres is updated, so every cached copy is now stale. A failure here is not
      // swallowed: the seed exits non-zero and says the cache may be stale until its TTL.
      const cacheKeysCleared = await cacheDal.deleteAllContent();

      // Warm the cache through the normal read path, so the first visitor gets a hit.
      await manager.getProfile(log);
      const projects = await manager.listProjects(log);
      for (const project of projects.value) {
        await manager.getProject(project.slug, log);
      }

      return {
        experiences: content.experiences.length,
        education: content.education.length,
        projects: content.projects.length,
        cacheKeysCleared,
      };
    },
  };

  return manager;
}

function found<T>(result: Cached<T | null>, notFoundMessage: string): Cached<T> {
  if (result.value === null) {
    throw new AppError(ErrorCode.NOT_FOUND, notFoundMessage);
  }
  return { value: result.value, cache: result.cache };
}
