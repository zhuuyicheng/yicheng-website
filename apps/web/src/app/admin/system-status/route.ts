import { checkOwner, OWNER_CHALLENGE } from '@/lib/admin-auth';
import { adminToken } from '@/lib/config';
import { readDashboardData } from '@/lib/dashboard-data';

/**
 * The dashboard's poll (every 15 s): the API's status and Prometheus's numbers (DESIGN.md
 * §15.5). The browser sends the owner's password; ADMIN_TOKEN stays on this server.
 */
export async function GET(request: Request) {
  const check = await checkOwner(request.headers.get('authorization'), adminToken());
  if (check === 'disabled') {
    return new Response(null, { status: 404 });
  }
  if (check === 'denied') {
    return new Response(null, { status: 401, headers: { 'www-authenticate': OWNER_CHALLENGE } });
  }

  // Always 200 for the owner: a source that didn't answer is `null`, with the reason.
  const data = await readDashboardData();
  return Response.json({ data }, { headers: { 'cache-control': 'no-store' } });
}
