import type { FastifyInstance } from 'fastify';
import type { ContentController } from '../controllers/content.controller.js';

const API_V1 = '/api/v1';

/** URL → controller mapping for portfolio content. See DESIGN.md §7.4. */
export function registerContentRoutes(app: FastifyInstance, controller: ContentController): void {
  app.get(`${API_V1}/profile`, controller.getProfile);
  app.get(`${API_V1}/projects`, controller.listProjects);
  app.get(`${API_V1}/projects/:slug`, controller.getProject);
}
