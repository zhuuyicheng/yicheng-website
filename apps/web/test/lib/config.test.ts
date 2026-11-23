import { afterEach, describe, expect, it, vi } from 'vitest';
import { prometheusUrl } from '@/lib/config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('prometheusUrl', () => {
  it("is development's Prometheus (npm run infra:up) when unset or empty", () => {
    vi.stubEnv('PROMETHEUS_URL', undefined);
    expect(prometheusUrl()).toBe('http://localhost:9090');

    vi.stubEnv('PROMETHEUS_URL', '');
    expect(prometheusUrl()).toBe('http://localhost:9090');
  });

  it('is PROMETHEUS_URL without a trailing slash, as in production', () => {
    vi.stubEnv('PROMETHEUS_URL', 'http://prometheus:9090/');

    expect(prometheusUrl()).toBe('http://prometheus:9090');
  });

  it('refuses an address it cannot use instead of guessing', () => {
    for (const url of ['prometheus:9090', 'ftp://prometheus', 'nonsense']) {
      vi.stubEnv('PROMETHEUS_URL', url);
      expect(() => prometheusUrl()).toThrow();
    }
  });
});
