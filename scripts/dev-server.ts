/**
 * 本機開發 API 伺服器。
 *
 * 用 PGlite（in-process Postgres）跑同一份 Hono 應用與 SQL，
 * 不需要 Neon 也能完整試用；搭配 `npm run dev`（Vite）的 /api proxy 使用。
 */
import { mkdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../src/server/app';
import { loadConfig } from '../src/server/config';
import { ensureSchema } from '../src/server/db';
import type { Sql } from '../src/server/types';

const PORT = Number(process.env.PORT || 8787);

const dataDir = process.env.PGLITE_DATA || '.data/pglite';
mkdirSync(dataDir, { recursive: true });
const pg = new PGlite(dataDir);
const sql: Sql = {
  async query<T>(text: string, params: unknown[] = []) {
    const result = await pg.query(text, params);
    return result.rows as T[];
  },
};

const config = loadConfig({
  DATABASE_URL: 'pglite://local',
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'hush-demo-2026',
  STORAGE_DRIVER: 'pg',
  AUTO_MIGRATE: '0',
  ...process.env,
});

await ensureSchema(sql);
const app = createApp({ sql, config });

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  try {
    const host = request.headers['x-forwarded-host'] || request.headers.host || `127.0.0.1:${PORT}`;
    const url = new URL(request.url || '/', `http://${host}`);

    const chunks: Buffer[] = [];
    await new Promise<void>((resolvePromise, reject) => {
      request.on('data', (chunk) => chunks.push(chunk as Buffer));
      request.on('end', () => resolvePromise());
      request.on('error', reject);
    });

    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (Array.isArray(value)) value.forEach((entry) => headers.append(key, entry));
      else if (value) headers.set(key, value);
    }

    const webRequest = new Request(url, {
      method: request.method,
      headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });

    const webResponse = await app.fetch(webRequest, {});
    response.statusCode = webResponse.status;
    webResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'set-cookie') response.setHeader(key, value);
    });
    const cookies = webResponse.headers.getSetCookie?.() ?? [];
    if (cookies.length) response.setHeader('set-cookie', cookies);
    response.end(Buffer.from(await webResponse.arrayBuffer()));
  } catch (error) {
    console.error('[hush-dev]', error);
    if (!response.headersSent) {
      response.statusCode = 500;
      response.setHeader('content-type', 'application/json');
    }
    response.end(JSON.stringify({ error: { code: 'internal_error', message: '伺服器錯誤。' } }));
  }
});

server.listen(PORT, () => {
  console.log(`[hush] API 開發伺服器：http://127.0.0.1:${PORT}`);
  console.log(`[hush] 管理員帳號：${config.adminUsername}（第一次登入時自動建立）`);
  console.log(`[hush] 儲存模式：${config.storageDriver === 'pg' ? 'Postgres 直存（單檔 4 MB）' : 'S3'}`);
});