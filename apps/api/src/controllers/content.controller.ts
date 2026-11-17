import type { FastifyReply, FastifyRequest } from 'fastify';
import { projectParamsSchema } from '../models/content.model.js';
import type { ContentService } from '../services/content.service.js';
import { renderProfile, renderProject, renderProjectList } from '../views/content.view.js';
import { parseRequest } from './parse-request.js';

/** Tells clients (and you, in curl) whether the response came from Redis. */
export const CACHE_HEADER = 'x-cache';

type Handler = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;

export interface ContentController {
  getProfile: Handler;
  listProjects: Handler;
  getProject: Handler;
}

export function createContentController(contentService: ContentService): ContentController {
  return {
    async getProfile(request, reply) {
      const { value, cache } = await contentService.getProfile(request.log);
      return reply.header(CACHE_HEADER, cache).send(renderProfile(value));
    },

    async listProjects(request, reply) {
      const { value, cache } = await contentService.listProjects(request.log);
      return reply.header(CACHE_HEADER, cache).send(renderProjectList(value));
    },

    async getProject(request, reply) {
      const { slug } = parseRequest(projectParamsSchema, request.params);
      const { value, cache } = await contentService.getProject(slug, request.log);
      return reply.header(CACHE_HEADER, cache).send(renderProject(value));
    },
  };
}
