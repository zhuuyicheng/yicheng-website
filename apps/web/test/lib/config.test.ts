import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiReplicas } from '@/lib/config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('apiReplicas', () => {
  it('lists each replica of API_REPLICA_URLS by its host name', () => {
    vi.stubEnv('API_REPLICA_URLS', ' http://api-1:4000 ,http://api-2:4000/,');

    expect(apiReplicas()).toEqual([
      { name: 'api-1', url: 'http://api-1:4000' },
      { name: 'api-2', url: 'http://api-2:4000' },
    ]);
  });

  it('is the one API of API_BASE_URL when unset, as in development', () => {
    vi.stubEnv('API_REPLICA_URLS', undefined);
    vi.stubEnv('API_BASE_URL', 'http://portfolio-api-dev:4000');

    expect(apiReplicas()).toEqual([
      { name: 'portfolio-api-dev', url: 'http://portfolio-api-dev:4000' },
    ]);
  });

  it('adds the port when two replicas share a host, so each name says which', () => {
    vi.stubEnv('API_REPLICA_URLS', 'http://localhost:4000,http://localhost:4001');

    expect(apiReplicas().map((replica) => replica.name)).toEqual([
      'localhost:4000',
      'localhost:4001',
    ]);
  });

  it('refuses an address it cannot use instead of guessing', () => {
    for (const listed of ['api-1:4000', 'http://api-1:4000,nonsense', 'ftp://api-1']) {
      vi.stubEnv('API_REPLICA_URLS', listed);
      expect(() => apiReplicas()).toThrow();
    }
  });
});
