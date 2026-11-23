import { QUEUE_ITEMS_LIMIT, queueNameSchema } from '@portfolio/shared';
import { checkOwner, OWNER_CHALLENGE } from '@/lib/admin-auth';
import { getQueueItems } from '@/lib/admin-api';
import { adminToken } from '@/lib/config';

/** Not Next's generated `RouteContext` (see app/[slug]/page.tsx). */
interface QueueRouteContext {
  params: Promise<{ queue: string }>;
}

/**
 * One queue's items, for "Show items" on /admin (DESIGN.md §8.7). The browser sends the owner's
 * password; this server asks the API with ADMIN_TOKEN, which never leaves it.
 */
export async function GET(request: Request, context: QueueRouteContext) {
  const check = await checkOwner(request.headers.get('authorization'), adminToken());
  if (check === 'disabled') {
    return new Response(null, { status: 404 });
  }
  if (check === 'denied') {
    return new Response(null, { status: 401, headers: { 'www-authenticate': OWNER_CHALLENGE } });
  }

  const queue = queueNameSchema.safeParse((await context.params).queue);
  if (!queue.success) {
    return new Response(null, { status: 404 });
  }

  // An unreachable API throws: Next.js logs it and answers 500, which the card reports.
  const items = await getQueueItems(queue.data, QUEUE_ITEMS_LIMIT.default);
  return Response.json({ data: items }, { headers: { 'cache-control': 'no-store' } });
}
