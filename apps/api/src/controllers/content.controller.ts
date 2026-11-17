import type { FastifyInstance } from 'fastify';
import { projectParamsSchema } from '../schema/content.schema.js';
import type { ContentManager } from '../services/content.manager.js';
import { renderProfile, renderProject, renderProjectList } from '../views/content.view.js';
import { API_V1 } from './api-v1.js';
import { parseRequest } from './parse-request.js';

/** Tells clients (and you, in curl) whether the response came from Redis. */
export const CACHE_HEADER = 'x-cache';

/**
 * Portfolio content endpoints. See DESIGN.md §7.4. Each endpoint validates its input, calls
 * one manager method, and renders a view.
 */
export function registerContentController(
  app: FastifyInstance,
  contentManager: ContentManager,
): void {
  app.get(`${API_V1}/profile`, async (request, reply) => {
    const { value, cache } = await contentManager.getProfile(request.log);
    return reply.header(CACHE_HEADER, cache).send(renderProfile(value));
  });

  app.get(`${API_V1}/projects`, async (request, reply) => {
    const { value, cache } = await contentManager.listProjects(request.log);
    return reply.header(CACHE_HEADER, cache).send(renderProjectList(value));
  });

  app.get(`${API_V1}/projects/:slug`, async (request, reply) => {
    const { slug } = parseRequest(projectParamsSchema, request.params);
    const { value, cache } = await contentManager.getProject(slug, request.log);
    return reply.header(CACHE_HEADER, cache).send(renderProject(value));
  });
}
