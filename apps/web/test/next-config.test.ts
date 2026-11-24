import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';

async function redirectSources(): Promise<string[]> {
  const redirects = (await nextConfig.redirects?.()) ?? [];
  return redirects.map((redirect) => redirect.source);
}

describe('next.config redirects', () => {
  // Regression: /privacy was redirected home while the notice was gone. Redirects run before
  // pages, so a leftover one would hide the notice that is back (DESIGN.md §12).
  it('lets /privacy reach the privacy notice', async () => {
    expect(await redirectSources()).not.toContain('/privacy');
  });

  it('still sends the old /projects addresses to their new homes', async () => {
    expect(await redirectSources()).toEqual(['/projects', '/projects/:slug']);
  });
});
