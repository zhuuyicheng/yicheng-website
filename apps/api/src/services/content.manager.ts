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
  /** `false` when the database already matched: no "Last updated" date moved. */
  changed: boolean;
  experiences: number;
  education: number;
  projects: number;
  cacheKeysCleared: number;
}

export interface ContentManager {
  getProfile: (log: Logger) => Promise<Cached<Profile>>;
  listProjects: (log: Logger) => Promise<Cached<ProjectSummary[]>>;
  getProject: (slug: string, log: Logger) => Promise<Cached<Project>>;
  /** `content:seed`: save to Postgres, clear the cache, warm it. */
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
      // Never null (no projects is []); this narrows the type.
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
      const changed = await dal.replaceAll(content);

      // Every cached copy is stale now. Not swallowed: the seed fails and says so.
      const cacheKeysCleared = await cacheDal.deleteAllContent();

      // Warm through the normal read path, so the first visitor gets a hit.
      await manager.getProfile(log);
      const projects = await manager.listProjects(log);
      for (const project of projects.value) {
        await manager.getProject(project.slug, log);
      }

      return {
        changed,
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
