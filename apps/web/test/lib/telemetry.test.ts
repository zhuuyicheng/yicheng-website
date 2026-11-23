import { eventRequestSchema } from '@portfolio/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  buildInteraction,
  buildPageView,
  externalReferrer,
  getSessionId,
  newSessionId,
  OWNER_BROWSER_KEY,
  SESSION_STORAGE_KEY,
  sendEvent,
  shouldRecord,
  trackName,
} from '@/lib/telemetry';

const fixedBytes = (bytes: Uint8Array) => bytes.fill(7);

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    data,
  };
}

describe('session id', () => {
  it('is 16 URL-safe characters, accepted by the API', () => {
    const id = newSessionId((bytes) => crypto.getRandomValues(bytes));

    expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  it('is created once per tab, then reused from session storage', () => {
    const storage = memoryStorage();

    const first = getSessionId(storage, fixedBytes);
    const second = getSessionId(storage, () => new Uint8Array(12).fill(9));

    expect(second).toBe(first);
    expect(storage.data.get(SESSION_STORAGE_KEY)).toBe(first);
  });

  it('still produces an id when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
    };

    expect(getSessionId(blocked, fixedBytes)).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(getSessionId(null, fixedBytes)).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });
});

describe('externalReferrer', () => {
  const site = 'https://example.dev';

  it('keeps another website', () => {
    expect(externalReferrer('https://www.linkedin.com/feed/', site)).toBe(
      'https://www.linkedin.com/feed/',
    );
  });

  it('drops our own pages, no referrer, and anything that is not a web URL', () => {
    expect(externalReferrer('https://example.dev/projects', site)).toBeNull();
    expect(externalReferrer('', site)).toBeNull();
    expect(externalReferrer('android-app://com.google.android.gm/', site)).toBeNull();
  });
});

describe('shouldRecord', () => {
  it('records visitors, but never the owner area', () => {
    expect(shouldRecord('/', memoryStorage())).toBe(true);
    expect(shouldRecord('/projects/x?ref=acme', null)).toBe(true);
    expect(shouldRecord('/admin', memoryStorage())).toBe(false);
    expect(shouldRecord('/admin?days=30', memoryStorage())).toBe(false);
    expect(shouldRecord('/administrator', memoryStorage())).toBe(true);
  });

  it("skips every page in a browser marked as the owner's, unless the mark was removed", () => {
    expect(shouldRecord('/', memoryStorage({ [OWNER_BROWSER_KEY]: '1' }))).toBe(false);
    expect(shouldRecord('/', memoryStorage({ [OWNER_BROWSER_KEY]: '0' }))).toBe(true);
  });

  it('records when storage cannot be read', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(shouldRecord('/', blocked)).toBe(true);
  });
});

describe('buildPageView', () => {
  const base = { path: '/', referrer: null, sessionId: 'k3J9xQ2mP0aZ', timezone: 'Asia/Singapore' };

  it('keeps the query string, so tagged links (?ref=…) reach the API', () => {
    const event = buildPageView({ ...base, path: '/?ref=acme&utm_source=linkedin' });

    expect(event).toMatchObject({ type: 'page_view', path: '/?ref=acme&utm_source=linkedin' });
    expect(eventRequestSchema.safeParse(event).success).toBe(true);
  });

  it('trims a very long path to what the API accepts', () => {
    const event = buildPageView({ ...base, path: `/${'a'.repeat(600)}` });

    expect(event?.path).toHaveLength(512);
  });

  it('drops an unusual time zone rather than losing the whole page view', () => {
    const event = buildPageView({ ...base, timezone: 'Not a/real zone!' });

    expect(event).toMatchObject({ type: 'page_view', timezone: null });
  });
});

describe('interactions', () => {
  it('turns a link label into an allowed interaction name', () => {
    expect(trackName('GitHub')).toBe('click:github-link');
    expect(trackName('portfolio-telemetry-platform', 'repo')).toBe(
      'click:portfolio-telemetry-platform-repo',
    );
    expect(trackName('!!!')).toBe('click:external-link');
  });

  it('builds a valid interaction event, or null for a name the API would refuse', () => {
    const input = { path: '/', sessionId: 'k3J9xQ2mP0aZ', timezone: null };

    expect(buildInteraction('click:github-link', input)).toMatchObject({
      type: 'interaction',
      name: 'click:github-link',
    });
    expect(buildInteraction('Click GitHub', input)).toBeNull();
  });
});

describe('sendEvent', () => {
  it('POSTs the JSON as text/plain (no CORS preflight) with keepalive, and never throws', async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError('offline')));
    const event = buildPageView({
      path: '/',
      referrer: null,
      sessionId: 'k3J9xQ2mP0aZ',
      timezone: null,
    });
    if (!event) throw new Error('expected an event');

    expect(() => {
      sendEvent(event, { baseUrl: 'http://api.test', fetch });
    }).not.toThrow();
    await Promise.resolve(); // let the rejection settle: none unhandled

    expect(fetch).toHaveBeenCalledWith('http://api.test/api/v1/events', {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(event),
      keepalive: true,
    });
  });
});
