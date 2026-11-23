/**
 * The /admin login (DESIGN.md §8.7): HTTP Basic, password = ADMIN_TOKEN, any username.
 * Checked in proxy.ts and again in each /admin route, in case one slips past the matcher.
 */
export type OwnerCheck = 'owner' | 'denied' | 'disabled';

/** The header that makes the browser show its login prompt. */
export const OWNER_CHALLENGE = 'Basic realm="Owner", charset="UTF-8"';

export async function checkOwner(
  authorization: string | null,
  adminToken: string | undefined,
): Promise<OwnerCheck> {
  if (!adminToken) {
    return 'disabled';
  }
  const password = basicPassword(authorization);
  if (password === null) {
    return 'denied';
  }
  return (await sameSecret(password, adminToken)) ? 'owner' : 'denied';
}

/** The password from `Authorization: Basic base64(username:password)`, or `null`. */
export function basicPassword(authorization: string | null): string | null {
  const encoded = /^Basic\s+([A-Za-z0-9+/]+=*)\s*$/i.exec(authorization ?? '')?.[1];
  if (encoded === undefined) {
    return null;
  }
  let decoded: string;
  try {
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null; // not base64 or UTF-8: same as no password
  }
  const colon = decoded.indexOf(':');
  return colon === -1 ? null : decoded.slice(colon + 1);
}

/**
 * Compares SHA-256 digests byte by byte: `===` returns sooner on a wrong prefix, leaking how
 * much of a guess was right. Hashing also hides the token's length.
 */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
