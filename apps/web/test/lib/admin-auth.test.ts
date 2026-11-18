import { describe, expect, it } from 'vitest';
import { basicPassword, checkOwner } from '@/lib/admin-auth';

const TOKEN = 'owner-token-0123456789abcdef0123456789';
const basic = (credentials: string) => `Basic ${btoa(credentials)}`;

describe('owner login (HTTP Basic)', () => {
  it('lets the owner in with ADMIN_TOKEN as the password, whatever the username', async () => {
    expect(await checkOwner(basic(`admin:${TOKEN}`), TOKEN)).toBe('owner');
    expect(await checkOwner(basic(`:${TOKEN}`), TOKEN)).toBe('owner');
  });

  it('denies a wrong, missing or malformed password', async () => {
    expect(await checkOwner(basic('admin:guess'), TOKEN)).toBe('denied');
    expect(await checkOwner(null, TOKEN)).toBe('denied');
    expect(await checkOwner(`Bearer ${TOKEN}`, TOKEN)).toBe('denied');
    expect(await checkOwner('Basic !!!not-base64', TOKEN)).toBe('denied');
    expect(await checkOwner(basic('no-colon-at-all'), TOKEN)).toBe('denied');
  });

  it('is disabled (the area does not exist) when no ADMIN_TOKEN is configured', async () => {
    expect(await checkOwner(basic(`admin:${TOKEN}`), undefined)).toBe('disabled');
    expect(await checkOwner(basic('admin:'), '')).toBe('disabled');
  });

  it('keeps colons inside the password', () => {
    expect(basicPassword(basic('user:pa:ss'))).toBe('pa:ss');
  });
});
