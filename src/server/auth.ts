/**
 * 帳號、session 與登入節流。
 *
 * 設計取向：只有一個管理員，其餘成員一律由管理員建立，因此不做註冊、
 * 不做 OAuth，也不寄送 email；只需要「帳號 + 密碼 + 伺服器端 session」。
 */
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import { SESSION_COOKIE } from './config';
import type { AppBindings } from './context';
import { randomToken, sha256Hex } from './crypto';
import { HttpError } from './http';
import { ISO_TIME } from './schema';
import type { SessionUser, Sql } from './types';

const WINDOW_MINUTES = 15;

/**
 * 登入節流分兩層，都在 15 分鐘視窗內計算：
 * - 帳號＋IP：同一個 IP 對同一個帳號連錯 5 次就鎖 15 分鐘。
 *   別人從其他 IP 亂試，鎖不到你自己的登入。
 * - IP：同一個 IP 不論試哪個帳號，連錯 20 次就整個 IP 鎖 15 分鐘，擋撞庫。
 * 登入成功只清除「帳號＋IP」的計數，IP 計數照算，避免用自己的帳號洗掉紀錄。
 */
export const LOGIN_LIMITS = { perAccountIp: 5, perIp: 20 } as const;

export function loginThrottleKeys(username: string, ip: string) {
  return {
    accountIp: `user:${username}|ip:${ip}`,
    ip: `ip:${ip}`,
  };
}

const SESSION_SELECT = `
  select s.id as "sessionId",
         u.id, u.username,
         u.display_name as "displayName",
         u.role, u.status, u.color,
         ${ISO_TIME('u.created_at')} as "createdAt",
         ${ISO_TIME('u.last_seen_at')} as "lastSeenAt"
  from sessions s
  join users u on u.id = s.user_id
`;

export async function createSession(
  sql: Sql,
  userId: string,
  userAgent: string | null,
  days: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await sql.query(
    `insert into sessions (id, token_hash, user_id, user_agent, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [crypto.randomUUID(), tokenHash, userId, userAgent, expiresAt.toISOString()],
  );
  return { token, expiresAt };
}

export async function resolveSession(sql: Sql, token: string): Promise<SessionUser | null> {
  const tokenHash = await sha256Hex(token);
  const rows = await sql.query<SessionUser>(
    `${SESSION_SELECT} where s.token_hash = $1 and s.expires_at > now() and u.status = 'active'`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function destroySession(sql: Sql, token: string): Promise<void> {
  const tokenHash = await sha256Hex(token);
  await sql.query('delete from sessions where token_hash = $1', [tokenHash]);
}

export async function destroyUserSessions(sql: Sql, userId: string): Promise<void> {
  await sql.query('delete from sessions where user_id = $1', [userId]);
}

export function readSessionCookie(c: Parameters<MiddlewareHandler<AppBindings>>[0]): string | null {
  return getCookie(c, SESSION_COOKIE) ?? null;
}

export function writeSessionCookie(
  c: Parameters<MiddlewareHandler<AppBindings>>[0],
  token: string,
  days: number,
): void {
  const secure = new URL(c.req.url).protocol === 'https:';
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure,
    maxAge: days * 24 * 60 * 60,
  });
}

export function clearSessionCookie(c: Parameters<MiddlewareHandler<AppBindings>>[0]): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

/** 需要登入的路由中介層。 */
export const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  const token = readSessionCookie(c);
  if (!token) throw new HttpError(401, 'unauthenticated', '請先登入。');
  const user = await resolveSession(c.get('db'), token);
  if (!user) throw new HttpError(401, 'unauthenticated', '登入已失效，請重新登入。');
  c.set('user', user);
  await next();
};

export function requireAdmin(user: SessionUser): void {
  if (user.role !== 'admin') {
    throw new HttpError(403, 'forbidden', '只有管理員可以執行這個動作。');
  }
}

/** 擋掉跨站寫入請求；瀏覽器一定會帶 Origin。 */
export const csrfGuard: MiddlewareHandler<AppBindings> = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = c.req.header('origin');
    if (origin) {
      const expected = new URL(c.req.url).origin;
      if (origin !== expected) throw new HttpError(403, 'bad_origin', '來源不被允許。');
    }
  }
  await next();
};

export async function assertLoginAllowed(sql: Sql, keys: string[]): Promise<void> {
  const rows = await sql.query<{ locked: boolean }>(
    `select (locked_until is not null and locked_until > now()) as locked
     from login_throttle where throttle_key = any($1::text[])`,
    [keys],
  );
  if (rows.some((row) => row.locked)) {
    throw new HttpError(429, 'too_many_attempts', '嘗試次數過多，請 15 分鐘後再試。');
  }
}

export async function noteLoginFailure(sql: Sql, key: string, maxFailures: number): Promise<void> {
  await sql.query(
    `insert into login_throttle (throttle_key, failures, updated_at)
     values ($1, 1, now())
     on conflict (throttle_key) do update set
       failures = case
         when login_throttle.updated_at < now() - interval '${WINDOW_MINUTES} minutes' then 1
         when login_throttle.failures + 1 >= $2::int then 0
         else login_throttle.failures + 1
       end,
       locked_until = case
         when login_throttle.failures + 1 >= $2::int
           and login_throttle.updated_at >= now() - interval '${WINDOW_MINUTES} minutes'
         then now() + interval '${WINDOW_MINUTES} minutes'
         else login_throttle.locked_until
       end,
       updated_at = now()`,
    [key, maxFailures],
  );
}

export async function resetLoginFailures(sql: Sql, key: string): Promise<void> {
  await sql.query('delete from login_throttle where throttle_key = $1', [key]);
}