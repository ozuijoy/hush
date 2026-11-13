/**
 * 登入、登出、目前使用者與改密碼。
 */
import { Hono } from 'hono';
import type { AppContext } from '../context';
import { ensureAdmin } from '../bootstrap';
import { publicConfig } from '../config';
import type { AppBindings } from '../context';
import {
  LOGIN_LIMITS,
  assertLoginAllowed,
  clearSessionCookie,
  createSession,
  destroySession,
  destroyUserSessions,
  loginThrottleKeys,
  noteLoginFailure,
  readSessionCookie,
  requireAuth,
  resetLoginFailures,
  resolveSession,
  writeSessionCookie,
} from '../auth';
import { hashPassword, verifyPassword } from '../crypto';
import { HttpError, clientIp, readJson, requirePassword, requireString } from '../http';
import { ISO_TIME } from '../schema';
import type { SessionUser } from '../types';

export const authRoutes = new Hono<AppBindings>();

/** 帳號不存在時仍跑一次 PBKDF2，避免用回應時間判斷帳號是否存在。 */
let dummyHash: string | null = null;

async function sessionPayload(c: AppContext, user: SessionUser | null) {
  const db = c.get('db');
  const config = c.get('config');
  const admins = await db.query<{ count: number }>(
    `select count(*)::int as count from users where role = 'admin'`,
  );
  return {
    user,
    config: publicConfig(config),
    setup: {
      hasAdmin: Number(admins[0]?.count ?? 0) > 0,
      adminConfigured: Boolean(config.adminPassword || config.adminPasswordHash),
    },
  };
}

authRoutes.get('/me', async (c) => {
  const token = readSessionCookie(c);
  if (!token) return c.json(await sessionPayload(c, null));

  const db = c.get('db');
  const user = await resolveSession(db, token);
  if (user) {
    await db.query('update users set last_seen_at = now() where id = $1', [user.id]);
  }
  return c.json(await sessionPayload(c, user));
});

authRoutes.post('/login', async (c) => {
  const body = await readJson(c);
  const username = requireString(body.username, 'username', { min: 1, max: 64 }).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) throw new HttpError(400, 'invalid_field', '請輸入密碼。');

  const db = c.get('db');
  const config = c.get('config');
  await ensureAdmin(db, config);

  const throttle = loginThrottleKeys(username, clientIp(c));
  await assertLoginAllowed(db, [throttle.accountIp, throttle.ip]);

  const rows = await db.query<{ id: string; passwordHash: string; status: string }>(
    `select id, password_hash as "passwordHash", status from users where lower(username) = $1`,
    [username],
  );
  const row = rows[0];

  if (!row) dummyHash ??= await hashPassword('hush-dummy-password');
  const stored = row?.passwordHash ?? (dummyHash as string);
  const passwordOk = await verifyPassword(password, stored);

  if (!row || row.status !== 'active' || !passwordOk) {
    await noteLoginFailure(db, throttle.accountIp, LOGIN_LIMITS.perAccountIp);
    await noteLoginFailure(db, throttle.ip, LOGIN_LIMITS.perIp);
    throw new HttpError(401, 'invalid_credentials', '帳號或密碼不正確。');
  }

  await resetLoginFailures(db, throttle.accountIp);
  const { token } = await createSession(
    db,
    row.id,
    c.req.header('user-agent')?.slice(0, 300) ?? null,
    config.sessionDays,
  );
  writeSessionCookie(c, token, config.sessionDays);
  await db.query('update users set last_seen_at = now() where id = $1', [row.id]);
  await db.query('delete from sessions where expires_at < now()');

  const user = await db.query<SessionUser>(
    `select id, username, display_name as "displayName", role, status, color,
            ${ISO_TIME('created_at')} as "createdAt",
            ${ISO_TIME('last_seen_at')} as "lastSeenAt"
     from users where id = $1`,
    [row.id],
  );
  return c.json(await sessionPayload(c, user[0] ?? null));
});

authRoutes.post('/logout', async (c) => {
  const token = readSessionCookie(c);
  if (token) await destroySession(c.get('db'), token);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.post('/password', requireAuth, async (c) => {
  const body = await readJson(c);
  const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const next = requirePassword(body.nextPassword);
  const db = c.get('db');
  const user = c.get('user');

  const rows = await db.query<{ passwordHash: string }>(
    'select password_hash as "passwordHash" from users where id = $1',
    [user.id],
  );
  if (!rows[0] || !(await verifyPassword(current, rows[0].passwordHash))) {
    throw new HttpError(400, 'invalid_password', '目前密碼不正確。');
  }

  await db.query('update users set password_hash = $1 where id = $2', [
    await hashPassword(next),
    user.id,
  ]);
  await destroyUserSessions(db, user.id);
  const { token } = await createSession(
    db,
    user.id,
    c.req.header('user-agent')?.slice(0, 300) ?? null,
    c.get('config').sessionDays,
  );
  writeSessionCookie(c, token, c.get('config').sessionDays);
  return c.json({ ok: true });
});