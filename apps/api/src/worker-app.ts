import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { AppConfig } from './config/env.js';
import { registerSystemController } from './controllers/system.controller.js';
import type { Logger } from './infra/logger.js';
import type { Metrics } from './infra/metrics.js';
import { registerErrorHandlers } from './middleware/error-handler.js';
import { resolveRequestId } from './middleware/request-id.js';
import { createMetricsTextManager } from './services/metrics-text.manager.js';

export interface WorkerAppDependencies {
  config: Pick<AppConfig, 'metrics'>;
  logger: Logger;
  metrics: Metrics;
}

/**
 * The worker's HTTP side, not listening: GET /metrics only, so Prometheus can read the counts
 * that only the worker updates (DESIGN.md §15.2). Nothing outside the server reaches it.
 */
export function buildWorkerApp(dependencies: WorkerAppDependencies): FastifyInstance {
  const { config, logger, metrics } = dependencies;

  const app = Fastify({
    loggerInstance: logger,
    genReqId: resolveRequestId,
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
  });

  registerErrorHandlers(app);
  registerSystemController(app, createMetricsTextManager(metrics), {
    metricsToken: config.metrics.token,
  });
  return app;
}
