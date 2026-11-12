/**
 * 成員管理：只有管理員能新增、改名、重設密碼、停用與刪除。
 */
import { Hono } from 'hono';
import { recordAudit } from '../audit';
import { requireAdmin, requireAuth, destroyUserSessions } from '../auth';
import type { AppBindings } from '../context';
import { hashPassword, pickColor } from '../crypto';
import {
  HttpError,
  optionalString,
  readJson,
  requirePassword,
  requireString,
  requireUsername,
} from '../http';
import { ISO_TIME } from '../schema';
import type { SessionUser } from '../types';

export const memberRoutes = new Hono<AppBindings>();

memberRoutes.use('*', requireAuth);

const MEMBER_SELECT = `
  select id, username, display_name as "displayName", role, status, color,
         ${ISO_TIME('created_at')} as "createdAt",
         ${ISO_TIME('last_seen_at')} as "lastSeenAt"
  from users
`;

memberRoutes.get('/', async (c) => {
  const rows = await c.get('db').query<SessionUser>(
    `${MEMBER_SELECT} order by (role = 'admin') desc, created_at asc`,
  );
  return c.json({ members: rows });
});

memberRoutes.post('/', async (c) => {
  const user = c.get('user');
  requireAdmin(user);
  const body = await readJson(c);
  const username = requireUsername(body.username);
  const displayName = requireString(body.displayName, 'displayName', { min: 1, max: 40 });
  const password = requirePassword(body.password);
  const db = c.get('db');

  const existing = await db.query(`select 1 from users where lower(username) = $1`, [username]);
  if (existing.length) throw new HttpError(409, 'username_taken', '這個帳號已經存在。');

  const rows = await db.query<SessionUser>(
    `insert into users (id, username, display_name, role, password_hash, color)
     values ($1, $2, $3, 'member', $4, $5)
     returning id, username, display_name as "displayName", role, status, color,
               ${ISO_TIME('created_at')} as "createdAt",
               ${ISO_TIME('last_seen_at')} as "lastSeenAt"`,
    [crypto.randomUUID(), username, displayName, await hashPassword(password), pickColor(username)],
  );

  await recordAudit(db, { id: user.id, name: user.displayName }, 'member.create', {
    type: 'user',
    id: rows[0].id,
  }, { username });
  return c.json({ member: rows[0] }, 201);
});

memberRoutes.patch('/:id', async (c) => {
  const user = c.get('user');
  requireAdmin(user);
  const body = await readJson(c);
  const id = c.req.param('id');
  const db = c.get('db');

  const targets = await db.query<{ id: string; role: string; username: string }>(
    'select id, role, username from users where id = $1',
    [id],
  );
  const target = targets[0];
  if (!target) throw new HttpError(404, 'not_found', '找不到這位成員。');
  if (target.role === 'admin') {
    throw new HttpError(400, 'protected_account', '管理員帳號請用「修改密碼」功能。');
  }

  const displayName = optionalString(body.displayName, 40);
  const status = body.status === 'active' || body.status === 'disabled' ? body.status : null;
  const password = body.password === undefined ? null : requirePassword(body.password);

  if (!displayName && !status && !password) {
    throw new HttpError(400, 'nothing_to_update', '沒有需要更新的欄位。');
  }

  if (displayName) {
    await db.query('update users set display_name = $1 where id = $2', [displayName, id]);
  }
  if (password) {
    await db.query('update users set password_hash = $1 where id = $2', [
      await hashPassword(password),
      id,
    ]);
    await destroyUserSessions(db, id);
  }
  if (status) {
    await db.query('update users set status = $1 where id = $2', [status, id]);
    if (status === 'disabled') await destroyUserSessions(db, id);
  }

  await recordAudit(db, { id: user.id, name: user.displayName }, 'member.update', {
    type: 'user',
    id,
  }, { displayName, status, passwordReset: Boolean(password) });

  const rows = await db.query<SessionUser>(`${MEMBER_SELECT} where id = $1`, [id]);
  return c.json({ member: rows[0] });
});

memberRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  requireAdmin(user);
  const id = c.req.param('id');
  if (id === user.id) throw new HttpError(400, 'protected_account', '不能移除自己的帳號。');

  const db = c.get('db');
  const rows = await db.query<{ id: string; role: string; username: string }>(
    'select id, role, username from users where id = $1',
    [id],
  );
  const target = rows[0];
  if (!target) throw new HttpError(404, 'not_found', '找不到這位成員。');
  if (target.role === 'admin') throw new HttpError(400, 'protected_account', '不能移除管理員帳號。');

  await db.query('delete from users where id = $1', [id]);
  await recordAudit(db, { id: user.id, name: user.displayName }, 'member.delete', {
    type: 'user',
    id,
  }, { username: target.username });

  return c.json({ ok: true, id });
});