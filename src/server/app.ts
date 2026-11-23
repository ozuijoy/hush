/**
 * Hono 應用程式：Cloudflare Pages Functions 與 Netlify Functions 共用同一份路由。
 *
 * API 同時掛在 `/api` 與 `/.netlify/functions/api` 之下：前者是正式路徑，
 * 後者讓 Netlify 以 redirect 方式轉發時也能正確比對路由。
 */
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { csrfGuard } from './auth';
import { loadConfig } from './config';
import type { Config } from './config';
import type { AppBindings } from './context';
import { createNeonSql, ensureSchema } from './db';
import { HttpError } from './http';
import { adminRoutes } from './routes/admin';
import { aiRoutes } from './routes/ai';
import type { AiFetch } from './ai';
import { authRoutes } from './routes/auth';
import { fileRoutes } from './routes/files';
import { memberRoutes } from './routes/members';
import { mediaRoutes } from './routes/media';
import { messageRoutes } from './routes/messages';
import { defaultOutbound } from './outbound';
import type { Outbound } from './outbound';
import type { Sql } from './types';

export interface AppDeps {
  sql: Sql;
  config: Config;
  /** 測試用：替換對外連線與 DNS 解析。 */
  outbound?: Outbound;
  /** 測試用：替換呼叫 AI 端點的 fetch。 */
  aiFetch?: AiFetch;
}

function buildApi(deps?: AppDeps) {
  const api = new Hono<AppBindings>();

  api.use('*', csrfGuard);
  api.use('*', async (c, next) => {
    await next();
    // 路由自己設定的快取（例如外鏈媒體）保留，其餘一律 no-store。
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
  });
  api.use('*', async (c, next) => {
    c.set('outbound', deps?.outbound ?? defaultOutbound);
    c.set('aiFetch', deps?.aiFetch ?? ((url, init) => fetch(url, init)));
    if (deps) {
      c.set('config', deps.config);
      c.set('db', deps.sql);
    } else {
      const config = loadConfig(c.env);
      c.set('config', config);
      if (!config.databaseUrl) {
        throw new HttpError(503, 'database_not_configured', '尚未設定 DATABASE_URL。');
      }
      c.set('db', createNeonSql(config.databaseUrl));
    }
    if (c.get('config').autoMigrate) await ensureSchema(c.get('db'));
    await next();
  });

  api.get('/health', async (c) => {
    const started = Date.now();
    await c.get('db').query('select 1 as ok');
    return c.json({
      ok: true,
      app: 'hush',
      storage: c.get('config').storageDriver,
      latencyMs: Date.now() - started,
      time: new Date().toISOString(),
    });
  });

  api.route('/auth', authRoutes);
  api.route('/messages', messageRoutes);
  api.route('/files', fileRoutes);
  api.route('/members', memberRoutes);
  api.route('/media', mediaRoutes);
  api.route('/ai', aiRoutes);
  api.route('/admin', adminRoutes);

  return api;
}

export function createApp(deps?: AppDeps) {
  const app = new Hono<AppBindings>();
  const api = buildApi(deps);

  app.route('/api', api);
  app.route('/.netlify/functions/api', api);

  app.notFound((c) =>
    c.json({ error: { code: 'not_found', message: '找不到這個 API 路徑。' } }, 404),
  );

  app.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status as ContentfulStatusCode,
      );
    }
    console.error('[hush] unhandled error', error);
    return c.json(
      { error: { code: 'internal_error', message: '伺服器暫時無法處理這個請求。' } },
      500,
    );
  });

  return app;
}