import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHealthService,
  HEALTH_CHECK_TIMEOUT_MS,
} from '../../../src/services/health.service.js';

const logger = pino({ level: 'silent' });
const healthy = () => Promise.resolve();

describe('HealthService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports ok when every dependency answers', async () => {
    const service = createHealthService([
      { name: 'postgres', ping: healthy },
      { name: 'redis', ping: healthy },
    ]);

    const report = await service.checkHealth(logger);

    expect(report.status).toBe('ok');
    expect(Object.keys(report.checks)).toEqual(['postgres', 'redis']);
  });

  it('reports degraded and marks only the failing dependency down', async () => {
    const service = createHealthService([
      { name: 'postgres', ping: healthy },
      { name: 'redis', ping: () => Promise.reject(new Error('ECONNREFUSED')) },
    ]);

    const report = await service.checkHealth(logger);

    expect(report.status).toBe('degraded');
    expect(report.checks.postgres?.status).toBe('up');
    expect(report.checks.redis?.status).toBe('down');
  });

  it('marks a dependency down when its ping hangs past the timeout', async () => {
    vi.useFakeTimers();
    const service = createHealthService([
      { name: 'postgres', ping: () => new Promise(() => undefined) },
    ]);

    const pending = service.checkHealth(logger);
    await vi.advanceTimersByTimeAsync(HEALTH_CHECK_TIMEOUT_MS);
    const report = await pending;

    expect(report.checks.postgres?.status).toBe('down');
  });

  it('logs the failure reason without exposing it in the report', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const service = createHealthService([
      { name: 'redis', ping: () => Promise.reject(new Error('connect to 10.1.2.3 refused')) },
    ]);

    const report = await service.checkHealth(logger);

    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(report)).not.toContain('10.1.2.3');
  });
});
