import { NextResponse, type NextRequest } from 'next/server';
import { checkOwner, OWNER_CHALLENGE } from '@/lib/admin-auth';
import { adminToken } from '@/lib/config';

/**
 * The first lock on /admin (DESIGN.md §8.7): the owner's password via HTTP Basic. Without
 * ADMIN_TOKEN the area doesn't exist. The pages check again.
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
  // Private: never cached, never indexed.
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-robots-tag', 'noindex, nofollow');
  return response;
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
};
