import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app';
import { loadConfig } from '../src/server/config';
import { ensureSchema } from '../src/server/db';
import type { Sql } from '../src/server/types';

/**
 * 端到端 API 測試：真的跑 Hono 路由、真的執行 SQL。
 * 資料庫用 PGlite（in-process Postgres），與 Neon 的 SQL 方言一致。
 */
const config = loadConfig({
  DATABASE_URL: 'pglite://memory',
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'admin-pass-123',
  STORAGE_DRIVER: 'pg',
  AUTO_MIGRATE: '0',
});

let app: ReturnType<typeof createApp>;
let adminCookie = '';
let aliceCookie = '';
let messageId = '';
let fileId = '';
const fileBytes = new TextEncoder().encode('Hush 內部檔案測試內容\nline 2\n');

type CallOptions = {
  method?: string;
  body?: unknown;
  cookie?: string;
  origin?: string;
};

function cookieFrom(response: Response): string {
  const cookies = response.headers.getSetCookie?.() ?? [];
  const session = cookies.find((value) => value.startsWith('hush_session='));
  return session ? session.split(';')[0] : '';
}

async function call(path: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.cookie) headers.cookie = options.cookie;
  if (options.origin) headers.origin = options.origin;

  return app.request(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

beforeAll(async () => {
  const pg = new PGlite();
  const sql: Sql = {
    async query<T>(text: string, params: unknown[] = []) {
      const result = await pg.query(text, params);
      return result.rows as T[];
    },
  };
  await ensureSchema(sql);
  app = createApp({ sql, config });
});

describe('Hush API', () => {
  it('健康檢查', async () => {
    const res = await call('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.storage).toBe('pg');
  });

  it('管理員首次登入時自動建立', async () => {
    const res = await call('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin-pass-123' },
    });
    expect(res.status).toBe(200);
    adminCookie = cookieFrom(res);
    expect(adminCookie).toContain('hush_session=');
    const body = await res.json();
    expect(body.user.role).toBe('admin');
    expect(body.setup.hasAdmin).toBe(true);
  });

  it('錯誤密碼不能登入', async () => {
    const res = await call('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'wrong-password' },
    });
    expect(res.status).toBe(401);
  });

  it('管理員新增成員，成員可以登入', async () => {
    const created = await call('/api/members', {
      method: 'POST',
      cookie: adminCookie,
      body: { username: 'alice', displayName: '小艾', password: 'alice-pass-123' },
    });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.member.username).toBe('alice');

    const duplicate = await call('/api/members', {
      method: 'POST',
      cookie: adminCookie,
      body: { username: 'alice', displayName: '重複', password: 'alice-pass-123' },
    });
    expect(duplicate.status).toBe(409);

    const login = await call('/api/auth/login', {
      method: 'POST',
      body: { username: 'alice', password: 'alice-pass-123' },
    });
    expect(login.status).toBe(200);
    aliceCookie = cookieFrom(login);
  });

  it('成員不能新增其他成員', async () => {
    const res = await call('/api/members', {
      method: 'POST',
      cookie: aliceCookie,
      body: { username: 'bob', displayName: '小波', password: 'bob-pass-123' },
    });
    expect(res.status).toBe(403);
  });

  it('成員可以送出訊息，列表依時間排序', async () => {
    const first = await call('/api/messages', {
      method: 'POST',
      cookie: adminCookie,
      body: { body: '大家好，這是 Hush 的第一則訊息。' },
    });
    expect(first.status).toBe(201);

    const second = await call('/api/messages', {
      method: 'POST',
      cookie: aliceCookie,
      body: { body: '收到，介面很漂亮。' },
    });
    expect(second.status).toBe(201);
    const payload = await second.json();
    messageId = payload.message.id;

    const list = await call('/api/messages', { cookie: aliceCookie });
    const { messages } = await list.json();
    expect(messages).toHaveLength(2);
    expect(messages[0].body).toContain('第一則');
    expect(messages[1].author.name).toBe('小艾');
  });

  it('只有管理員可以刪除訊息，刪除後只留下墓碑', async () => {
    const forbidden = await call(`/api/messages/${messageId}`, {
      method: 'DELETE',
      cookie: aliceCookie,
    });
    expect(forbidden.status).toBe(403);

    const removed = await call(`/api/messages/${messageId}`, {
      method: 'DELETE',
      cookie: adminCookie,
    });
    expect(removed.status).toBe(200);

    const list = await call('/api/messages', { cookie: adminCookie });
    const { messages } = await list.json();
    const target = messages.find((message: { id: string }) => message.id === messageId);
    expect(target.deleted).toBe(true);
    expect(target.kind).toBe('deleted');
    expect(target.body).toBeNull();
  });

  it('檔案：預簽名 → 上傳 → 完成 → 下載', async () => {
    const presign = await call('/api/files/presign', {
      method: 'POST',
      cookie: aliceCookie,
      body: { name: '會議紀錄.txt', size: fileBytes.byteLength, mime: 'text/plain' },
    });
    expect(presign.status).toBe(201);
    const presigned = await presign.json();
    fileId = presigned.fileId;
    expect(presigned.upload.url).toBe(`/api/files/${fileId}/content`);

    const upload = await app.request(presigned.upload.url, {
      method: 'PUT',
      headers: { cookie: aliceCookie, 'content-type': 'application/octet-stream' },
      body: fileBytes,
    });
    expect(upload.status).toBe(200);

    const complete = await call(`/api/files/${fileId}/complete`, {
      method: 'POST',
      cookie: aliceCookie,
      body: { caption: '今天的會議紀錄' },
    });
    expect(complete.status).toBe(201);
    const completed = await complete.json();
    expect(completed.message.kind).toBe('file');
    expect(completed.message.file.name).toBe('會議紀錄.txt');

    const list = await call('/api/files', { cookie: aliceCookie });
    const files = await list.json();
    expect(files.files).toHaveLength(1);
    expect(files.totalBytes).toBe(fileBytes.byteLength);

    const url = await call(`/api/files/${fileId}/url`, { cookie: aliceCookie });
    const target = await url.json();
    expect(target.mode).toBe('proxy');

    const download = await call(`/api/files/${fileId}/content`, { cookie: aliceCookie });
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('filename*=UTF-8');
    const received = new Uint8Array(await download.arrayBuffer());
    expect(Array.from(received)).toEqual(Array.from(fileBytes));
  });

  it('只有管理員可以移除檔案', async () => {
    const forbidden = await call(`/api/files/${fileId}`, {
      method: 'DELETE',
      cookie: aliceCookie,
    });
    expect(forbidden.status).toBe(403);

    const removed = await call(`/api/files/${fileId}`, {
      method: 'DELETE',
      cookie: adminCookie,
    });
    expect(removed.status).toBe(200);

    const list = await call('/api/files', { cookie: adminCookie });
    const files = await list.json();
    expect(files.files).toHaveLength(0);

    const download = await call(`/api/files/${fileId}/content`, { cookie: adminCookie });
    expect(download.status).toBe(404);
  });

  it('管理員總覽與稽核紀錄', async () => {
    const overview = await call('/api/admin/overview', { cookie: adminCookie });
    expect(overview.status).toBe(200);
    const data = await overview.json();
    expect(data.stats.members).toBe(1);
    expect(data.config.storageDriver).toBe('pg');

    const audit = await call('/api/admin/audit', { cookie: adminCookie });
    const entries = await audit.json();
    const actions = entries.entries.map((entry: { action: string }) => entry.action);
    expect(actions).toContain('file.delete');
    expect(actions).toContain('message.delete');
  });

  it('跨站 Origin 的寫入請求會被拒絕', async () => {
    const res = await call('/api/messages', {
      method: 'POST',
      cookie: adminCookie,
      origin: 'https://evil.example.com',
      body: { body: 'csrf attempt' },
    });
    expect(res.status).toBe(403);
  });

  it('連續失敗會被鎖定', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await call('/api/auth/login', {
        method: 'POST',
        body: { username: 'nobody', password: 'bad-password' },
      });
      expect(res.status).toBe(401);
    }
    const locked = await call('/api/auth/login', {
      method: 'POST',
      body: { username: 'nobody', password: 'bad-password' },
    });
    expect(locked.status).toBe(429);
  });

  it('登出後 session 立即失效', async () => {
    const logout = await call('/api/auth/logout', { method: 'POST', cookie: aliceCookie });
    expect(logout.status).toBe(200);

    const me = await call('/api/auth/me', { cookie: aliceCookie });
    const body = await me.json();
    expect(body.user).toBeNull();
  });
});