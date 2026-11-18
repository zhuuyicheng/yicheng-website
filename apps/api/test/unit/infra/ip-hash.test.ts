import { describe, expect, it } from 'vitest';
import { createIpHasher } from '../../../src/infra/ip-hash.js';

const SECRET = 'unit-test-ip-hash-secret-0123456789abcdef';

describe('createIpHasher', () => {
  it('gives the same 64-hex-character hash for the same IP, and never contains the IP', () => {
    const hashIp = createIpHasher(SECRET);

    const hash = hashIp('203.0.113.7');

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIp('203.0.113.7')).toBe(hash);
    expect(hash).not.toContain('203.0.113.7');
  });

  it('gives different hashes for different IPs', () => {
    const hashIp = createIpHasher(SECRET);

    expect(hashIp('203.0.113.7')).not.toBe(hashIp('203.0.113.8'));
  });

  it('depends on the secret, so nobody without it can recompute (and reverse) a hash', () => {
    const ours = createIpHasher(SECRET);
    const theirs = createIpHasher('someone-else-guessing-the-secret-0000');

    expect(ours('203.0.113.7')).not.toBe(theirs('203.0.113.7'));
  });
});
