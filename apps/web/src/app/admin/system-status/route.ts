import { checkOwner, OWNER_CHALLENGE } from '@/lib/admin-auth';
import { getReplicaStatuses } from '@/lib/admin-api';
import { adminToken } from '@/lib/config';

/**
 * The dashboard's poll (every 5 s): each API replica's own status, which the page adds up. The
 * browser sends the owner's password; ADMIN_TOKEN stays on this server.
 */
export async function GET(request: Request) {
  const check = await checkOwner(request.headers.get('authorization'), adminToken());
  if (check === 'disabled') {
    return new Response(null, { status: 404 });
  }
  if (check === 'denied') {
    return new Response(null, { status: 401, headers: { 'www-authenticate': OWNER_CHALLENGE } });
  }

  // A replica that doesn't answer is listed as such; with none, the page shows "lost contact".
  const statuses = await getReplicaStatuses();
  return Response.json({ data: statuses }, { headers: { 'cache-control': 'no-store' } });
}
