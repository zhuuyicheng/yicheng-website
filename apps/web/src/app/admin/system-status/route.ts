import { checkOwner, OWNER_CHALLENGE } from '@/lib/admin-auth';
import { getReplicaStatuses } from '@/lib/admin-api';
import { adminToken } from '@/lib/config';

/**
 * The live system dashboard's data, for the owner's browser (it polls every 5 s): every API
 * replica's own status, which the page adds up. The browser cannot call the API's owner
 * endpoint itself, since that needs ADMIN_TOKEN, which stays on this server. The browser
 * resends the password it gave for /admin with each poll.
 */
export async function GET(request: Request) {
  const check = await checkOwner(request.headers.get('authorization'), adminToken());
  if (check === 'disabled') {
    return new Response(null, { status: 404 });
  }
  if (check === 'denied') {
    return new Response(null, { status: 401, headers: { 'www-authenticate': OWNER_CHALLENGE } });
  }

  // A replica that does not answer is listed as such; when none answers, the dashboard shows
  // "lost contact" while it keeps polling.
  const statuses = await getReplicaStatuses();
  return Response.json({ data: statuses }, { headers: { 'cache-control': 'no-store' } });
}
