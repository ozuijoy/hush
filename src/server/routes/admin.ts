/**
 * 管理員總覽與稽核紀錄。
 */
import { Hono } from 'hono';
import { requireAdmin, requireAuth } from '../auth';
import { publicConfig } from '../config';
import type { AppBindings } from '../context';
import { parseLimit } from '../http';
import { ISO_TIME, SCHEMA_VERSION } from '../schema';

export const adminRoutes = new Hono<AppBindings>();

adminRoutes.use('*', requireAuth);

adminRoutes.get('/overview', async (c) => {
  requireAdmin(c.get('user'));
  const db = c.get('db');

  const stats = await db.query<{
    members: number;
    messages: number;
    files: number;
    bytes: string;
    sessions: number;
  }>(
    `select
       (select count(*)::int from users where role = 'member') as members,
       (select count(*)::int from messages where deleted_at is null) as messages,
       (select count(*)::int from files where status = 'ready' and deleted_at is null) as files,
       (select coalesce(sum(size_bytes), 0)::text from files where status = 'ready' and deleted_at is null) as bytes,
       (select count(*)::int from sessions where expires_at > now()) as sessions`,
  );

  return c.json({
    stats: {
      ...stats[0],
      bytes: Number(stats[0]?.bytes ?? 0),
    },
    config: publicConfig(c.get('config')),
    schemaVersion: SCHEMA_VERSION,
  });
});

adminRoutes.get('/audit', async (c) => {
  requireAdmin(c.get('user'));
  const limit = parseLimit(c.req.query('limit'), 60, 200);
  const rows = await c.get('db').query<{
    id: string;
    actorName: string | null;
    action: string;
    targetType: string | null;
    targetId: string | null;
    detail: unknown;
    createdAt: string;
  }>(
    `select id::text as id, actor_name as "actorName", action,
            target_type as "targetType", target_id as "targetId", detail,
            ${ISO_TIME('created_at')} as "createdAt"
     from audit_log
     order by id desc
     limit $1`,
    [limit],
  );
  return c.json({ entries: rows });
});