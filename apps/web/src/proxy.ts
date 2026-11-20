import { NextResponse, type NextRequest } from 'next/server';
import { checkOwner, OWNER_CHALLENGE } from '@/lib/admin-auth';
import { adminToken } from '@/lib/config';

/**
 * The lock on the owner area (DESIGN.md §8.7). Every /admin request needs the owner's
 * password (HTTP Basic: the browser shows its own login box); without ADMIN_TOKEN configured
 * the area does not exist. The pages check again themselves: this is the first lock, not the
 * only one.
 */
export async function proxy(request: NextRequest) {
  const check = await checkOwner(request.headers.get('authorization'), adminToken());
  if (check === 'disabled') {
    return new NextResponse('Not found', { status: 404 });
  }
  if (check === 'denied') {
    return new NextResponse('The owner area needs a password.', {
      status: 401,
      headers: { 'www-authenticate': OWNER_CHALLENGE, 'cache-control': 'no-store' },
    });
  }

  const response = NextResponse.next();
  // Private data: never stored by a cache, never indexed by a search engine.
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-robots-tag', 'noindex, nofollow');
  return response;
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
};
