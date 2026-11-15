import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
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
  ip?: string;
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
  if (options.ip) headers['cf-connecting-ip'] = options.ip;

  return app.request(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

beforeAll(async () => {
  const pg = new PGlite({ extensions: { pg_trgm } });
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
    expect(list.status).toBe(200);
    const { messages } = await list.json();
    expect(messages).toHaveLength(2);
    expect(messages[0].body).toContain('第一則');
    expect(messages[1].author.name).toBe('小艾');
  });

  it('訊息分頁游標，以及錯誤的查詢參數回 400 而不是 500', async () => {
    const all = await (await call('/api/messages', { cookie: aliceCookie })).json();
    const [first, second] = all.messages;

    const after = await (await call(`/api/messages?after=${first.id}`, { cookie: aliceCookie })).json();
    expect(after.messages.map((m: { id: string }) => m.id)).toEqual([second.id]);

    const before = await (await call(`/api/messages?before=${second.id}`, { cookie: aliceCookie })).json();
    expect(before.messages.map((m: { id: string }) => m.id)).toEqual([first.id]);

    const limited = await (await call('/api/messages?limit=1', { cookie: aliceCookie })).json();
    expect(limited.messages.map((m: { id: string }) => m.id)).toEqual([second.id]);

    const badLimit = await call('/api/messages?limit=abc', { cookie: aliceCookie });
    expect(badLimit.status).toBe(200);
    expect((await badLimit.json()).messages).toHaveLength(2);

    for (const query of ['after=abc', 'before=1x', 'after=-1']) {
      const res = await call(`/api/messages?${query}`, { cookie: aliceCookie });
      expect(res.status, query).toBe(400);
      expect((await res.json()).error.code).toBe('invalid_cursor');
    }
  });

  it('置頂：只有管理員能設定，同時只有一則，輪詢會帶回置頂狀態', async () => {
    const all = await (await call('/api/messages', { cookie: aliceCookie })).json();
    const [first, second] = all.messages;
    expect(all.pinned).toBeNull();

    const forbidden = await call(`/api/messages/${first.id}/pin`, { method: 'PUT', cookie: aliceCookie });
    expect(forbidden.status).toBe(403);

    const pinFirst = await call(`/api/messages/${first.id}/pin`, { method: 'PUT', cookie: adminCookie });
    expect(pinFirst.status).toBe(200);
    expect((await pinFirst.json()).pinned.message.id).toBe(first.id);

    // 置頂第二則會取代第一則。
    const pinSecond = await call(`/api/messages/${second.id}/pin`, { method: 'PUT', cookie: adminCookie });
    const replaced = await pinSecond.json();
    expect(replaced.pinned.message.id).toBe(second.id);
    expect(replaced.pinned.pinnedBy).toBe('管理員');

    // 其他成員輪詢新訊息時也拿得到置頂。
    const polled = await (
      await call(`/api/messages?after=${second.id}`, { cookie: aliceCookie })
    ).json();
    expect(polled.messages).toHaveLength(0);
    expect(polled.pinned.message.id).toBe(second.id);

    const missing = await call('/api/messages/999999/pin', { method: 'PUT', cookie: adminCookie });
    expect(missing.status).toBe(404);

    const unpinForbidden = await call('/api/messages/pin', { method: 'DELETE', cookie: aliceCookie });
    expect(unpinForbidden.status).toBe(403);
    const unpin = await call('/api/messages/pin', { method: 'DELETE', cookie: adminCookie });
    expect(unpin.status).toBe(200);
    const after = await (await call('/api/messages/pinned', { cookie: aliceCookie })).json();
    expect(after.pinned).toBeNull();

    // 為下一個測試保留：置頂第二則（它接著會被刪除）。
    await call(`/api/messages/${second.id}/pin`, { method: 'PUT', cookie: adminCookie });
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

    // 刪除置頂中的訊息會一併取消置頂，也不能再置頂墓碑。
    const pinned = await (await call('/api/messages/pinned', { cookie: adminCookie })).json();
    expect(pinned.pinned).toBeNull();
    const pinDeleted = await call(`/api/messages/${messageId}/pin`, { method: 'PUT', cookie: adminCookie });
    expect(pinDeleted.status).toBe(404);
  });

  it('搜尋：中文、英文不分大小寫、檔名、篩選與萬用字元跳脫', async () => {
    const posts = ['週五 Demo 改到下午三點', '記得帶 demo 用的筆電', '折扣 100% 確定', 'snake_case 命名'];
    for (const text of posts) {
      const res = await call('/api/messages', { method: 'POST', cookie: aliceCookie, body: { body: text } });
      expect(res.status).toBe(201);
    }
    const search = async (query: string) => {
      const res = await call(`/api/messages/search?${query}`, { cookie: aliceCookie });
      expect(res.status, query).toBe(200);
      return (await res.json()) as { results: Array<{ id: string; body: string | null; author: { name: string } }>; hasMore: boolean };
    };

    const zh = await search(`q=${encodeURIComponent('下午')}`);
    expect(zh.results.map((m) => m.body)).toEqual(['週五 Demo 改到下午三點']);

    const en = await search('q=DEMO');
    expect(en.results).toHaveLength(2);
    // 新的在前。
    expect(en.results[0].body).toContain('筆電');

    // % 與 _ 只當一般字元。
    expect((await search(`q=${encodeURIComponent('%')}`)).results.map((m) => m.body)).toEqual(['折扣 100% 確定']);
    expect((await search(`q=${encodeURIComponent('_')}`)).results.map((m) => m.body)).toEqual(['snake_case 命名']);

    // 已刪除的訊息搜不到。
    expect((await search(`q=${encodeURIComponent('收到')}`)).results).toHaveLength(0);

    const members = await (await call('/api/members', { cookie: adminCookie })).json();
    const admin = members.members.find((m: { role: string }) => m.role === 'admin');
    const byAdmin = await search(`q=${encodeURIComponent('第一則')}&author=${admin.id}`);
    expect(byAdmin.results).toHaveLength(1);
    const byOther = await search(`q=demo&author=${admin.id}`);
    expect(byOther.results).toHaveLength(0);

    const empty = await call('/api/messages/search?q=', { cookie: aliceCookie });
    expect(empty.status).toBe(400);
    const badAuthor = await call('/api/messages/search?q=a&author=x', { cookie: aliceCookie });
    expect(badAuthor.status).toBe(400);
  });

  it('訊息前後文：用於跳轉到搜尋結果', async () => {
    const found = await (
      await call(`/api/messages/search?q=${encodeURIComponent('筆電')}`, { cookie: aliceCookie })
    ).json();
    const id = found.results[0].id;
    const res = await call(`/api/messages/${id}/context`, { cookie: aliceCookie });
    expect(res.status).toBe(200);
    const context = await res.json();
    expect(context.targetId).toBe(id);
    const ids = context.messages.map((m: { id: string }) => Number(m.id));
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids).toContain(Number(id));
    expect(context.messages.some((m: { body: string | null }) => m.body?.includes('下午'))).toBe(true);

    expect((await call('/api/messages/999999/context', { cookie: aliceCookie })).status).toBe(404);
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

    const byName = await (
      await call(`/api/messages/search?files=1&q=${encodeURIComponent('會議紀錄')}`, { cookie: aliceCookie })
    ).json();
    expect(byName.results).toHaveLength(1);
    expect(byName.results[0].file.name).toBe('會議紀錄.txt');

    const url = await call(`/api/files/${fileId}/url`, { cookie: aliceCookie });
    const target = await url.json();
    expect(target.mode).toBe('proxy');

    const download = await call(`/api/files/${fileId}/content`, { cookie: aliceCookie });
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('filename*=UTF-8');
    const received = new Uint8Array(await download.arrayBuffer());
    expect(Array.from(received)).toEqual(Array.from(fileBytes));
  });

  it('檔案預覽：inline 網址只給白名單類型，HTML/SVG 不會在站內被渲染', async () => {
    const upload = async (name: string, mime: string, bytes: Uint8Array) => {
      const presigned = await (
        await call('/api/files/presign', {
          method: 'POST',
          cookie: aliceCookie,
          body: { name, size: bytes.byteLength, mime },
        })
      ).json();
      await app.request(presigned.upload.url, {
        method: 'PUT',
        headers: { cookie: aliceCookie, 'content-type': 'application/octet-stream' },
        body: bytes as unknown as BodyInit,
      });
      await call(`/api/files/${presigned.fileId}/complete`, { method: 'POST', cookie: aliceCookie, body: {} });
      return presigned.fileId as string;
    };

    // 文字檔：inline 預覽，強制 text/plain 並加沙箱。
    const preview = await (await call(`/api/files/${fileId}/url?inline=1`, { cookie: aliceCookie })).json();
    expect(preview.inline).toBe(true);
    expect(preview.preview).toBe('text');
    expect(preview.url).toBe(`/api/files/${fileId}/content?inline=1`);
    const inline = await call(preview.url, { cookie: aliceCookie });
    expect(inline.status).toBe(200);
    expect(inline.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(inline.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(inline.headers.get('content-security-policy')).toContain('sandbox');

    // 圖片：副檔名正確但 MIME 空白也能預覽。
    const png = await upload('截圖.png', '', new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const pngTarget = await (await call(`/api/files/${png}/url?inline=1`, { cookie: aliceCookie })).json();
    expect(pngTarget.preview).toBe('image');
    const pngInline = await call(pngTarget.url, { cookie: aliceCookie });
    expect(pngInline.headers.get('content-type')).toBe('image/png');

    // HTML：預覽只看原始碼；一般下載也不帶 text/html。
    const html = await upload('page.html', 'text/html', new TextEncoder().encode('<script>alert(1)</script>'));
    const htmlTarget = await (await call(`/api/files/${html}/url?inline=1`, { cookie: aliceCookie })).json();
    expect(htmlTarget.preview).toBe('text');
    const htmlInline = await call(htmlTarget.url, { cookie: aliceCookie });
    expect(htmlInline.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    const htmlDownload = await call(`/api/files/${html}/content`, { cookie: aliceCookie });
    expect(htmlDownload.headers.get('content-type')).toBe('application/octet-stream');
    expect(htmlDownload.headers.get('content-disposition')).toMatch(/^attachment;/);

    // 不能預覽的類型：要求 inline 也只回附件。
    const zip = await upload('備份.zip', 'application/zip', new Uint8Array([1, 2, 3]));
    const zipTarget = await (await call(`/api/files/${zip}/url?inline=1`, { cookie: aliceCookie })).json();
    expect(zipTarget.inline).toBe(false);
    expect(zipTarget.preview).toBeNull();
    const zipInline = await call(`/api/files/${zip}/content?inline=1`, { cookie: aliceCookie });
    expect(zipInline.headers.get('content-disposition')).toMatch(/^attachment;/);

    for (const id of [png, html, zip]) {
      expect((await call(`/api/files/${id}`, { method: 'DELETE', cookie: adminCookie })).status).toBe(200);
    }
  });

  it('上傳大小不一致或超過上限會被拒絕，未完成的檔案不能下載', async () => {
    const presign = await call('/api/files/presign', {
      method: 'POST',
      cookie: aliceCookie,
      body: { name: 'a.bin', size: 10, mime: 'application/octet-stream' },
    });
    expect(presign.status).toBe(201);
    const { fileId: pendingId } = await presign.json();

    const mismatch = await app.request(`/api/files/${pendingId}/content`, {
      method: 'PUT',
      headers: { cookie: aliceCookie, 'content-type': 'application/octet-stream' },
      body: new Uint8Array(3),
    });
    expect(mismatch.status).toBe(400);
    expect((await mismatch.json()).error.code).toBe('size_mismatch');

    const tooLarge = await call('/api/files/presign', {
      method: 'POST',
      cookie: aliceCookie,
      body: { name: 'big.bin', size: config.maxUploadBytes + 1 },
    });
    expect(tooLarge.status).toBe(413);

    // 未完成的檔案不會出現在列表，也不能下載。
    const download = await call(`/api/files/${pendingId}/content`, { cookie: aliceCookie });
    expect(download.status).toBe(404);
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
    expect(actions).toContain('message.pin');
    expect(actions).toContain('message.unpin');

    const badLimit = await call('/api/admin/audit?limit=abc', { cookie: adminCookie });
    expect(badLimit.status).toBe(200);

    const forbidden = await call('/api/admin/overview', { cookie: aliceCookie });
    expect(forbidden.status).toBe(403);
  });

  it('跨站 Origin 的寫入請求會被拒絕', async () => {
    const res = await call('/api/messages', {
      method: 'POST',
      cookie: adminCookie,
      origin: 'https://evil.example.com',
      body: { body: 'csrf attempt' },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('bad_origin');
  });

  it('同源 Origin 的寫入請求可以通過', async () => {
    const res = await call('/api/messages', {
      method: 'POST',
      cookie: adminCookie,
      origin: 'http://localhost',
      body: { body: 'same origin' },
    });
    expect(res.status).toBe(201);
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

  it('真實帳號被鎖定期間，同一 IP 用正確密碼也無法登入', async () => {
    const created = await call('/api/members', {
      method: 'POST',
      cookie: adminCookie,
      body: { username: 'carol', displayName: '小卡', password: 'carol-pass-123' },
    });
    expect(created.status).toBe(201);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await call('/api/auth/login', {
        method: 'POST',
        body: { username: 'carol', password: 'wrong-password' },
      });
      expect(res.status).toBe(401);
    }
    const locked = await call('/api/auth/login', {
      method: 'POST',
      body: { username: 'carol', password: 'carol-pass-123' },
    });
    expect(locked.status).toBe(429);

    // 換一個 IP 不受影響：別人在別處亂試，鎖不到本人。
    const elsewhere = await call('/api/auth/login', {
      method: 'POST',
      ip: '203.0.113.7',
      body: { username: 'carol', password: 'carol-pass-123' },
    });
    expect(elsewhere.status).toBe(200);
  });

  it('同一個 IP 換帳號亂試，累計 20 次後整個 IP 被鎖', async () => {
    const attacker = '198.51.100.9';
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const res = await call('/api/auth/login', {
        method: 'POST',
        ip: attacker,
        body: { username: `guess${attempt}`, password: 'bad-password' },
      });
      expect(res.status).toBe(401);
    }
    const blocked = await call('/api/auth/login', {
      method: 'POST',
      ip: attacker,
      body: { username: 'admin', password: 'admin-pass-123' },
    });
    expect(blocked.status).toBe(429);

    const other = await call('/api/auth/login', {
      method: 'POST',
      ip: '198.51.100.10',
      body: { username: 'admin', password: 'admin-pass-123' },
    });
    expect(other.status).toBe(200);
  });

  it('偽造 x-forwarded-for 繞不過平台提供的 IP', async () => {
    const realIp = '192.0.2.50';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-nf-client-connection-ip': realIp,
          'x-forwarded-for': `10.0.0.${attempt}`,
        },
        body: JSON.stringify({ username: 'carol', password: 'wrong-password' }),
      });
      expect(res.status).toBe(401);
    }
    const locked = await app.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-nf-client-connection-ip': realIp,
        'x-forwarded-for': '10.0.0.99',
      },
      body: JSON.stringify({ username: 'carol', password: 'carol-pass-123' }),
    });
    expect(locked.status).toBe(429);
  });

  it('停用成員後，其 session 立即失效', async () => {
    const created = await call('/api/members', {
      method: 'POST',
      cookie: adminCookie,
      body: { username: 'dave', displayName: '小戴', password: 'dave-pass-123' },
    });
    const { member } = await created.json();
    const login = await call('/api/auth/login', {
      method: 'POST',
      body: { username: 'dave', password: 'dave-pass-123' },
    });
    const daveCookie = cookieFrom(login);

    const disable = await call(`/api/members/${member.id}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { status: 'disabled' },
    });
    expect(disable.status).toBe(200);

    const me = await (await call('/api/auth/me', { cookie: daveCookie })).json();
    expect(me.user).toBeNull();
    const relogin = await call('/api/auth/login', {
      method: 'POST',
      body: { username: 'dave', password: 'dave-pass-123' },
    });
    expect(relogin.status).toBe(401);
  });

  it('修改密碼後舊 session 失效、新密碼可登入', async () => {
    const wrong = await call('/api/auth/password', {
      method: 'POST',
      cookie: aliceCookie,
      body: { currentPassword: 'nope-nope', nextPassword: 'alice-new-pass-1' },
    });
    expect(wrong.status).toBe(400);

    const changed = await call('/api/auth/password', {
      method: 'POST',
      cookie: aliceCookie,
      body: { currentPassword: 'alice-pass-123', nextPassword: 'alice-new-pass-1' },
    });
    expect(changed.status).toBe(200);
    const newCookie = cookieFrom(changed);
    expect(newCookie).not.toBe(aliceCookie);

    const oldSession = await (await call('/api/auth/me', { cookie: aliceCookie })).json();
    expect(oldSession.user).toBeNull();

    const login = await call('/api/auth/login', {
      method: 'POST',
      body: { username: 'alice', password: 'alice-new-pass-1' },
    });
    expect(login.status).toBe(200);
    aliceCookie = cookieFrom(login);
  });

  it('登出後 session 立即失效', async () => {
    const logout = await call('/api/auth/logout', { method: 'POST', cookie: aliceCookie });
    expect(logout.status).toBe(200);

    const me = await call('/api/auth/me', { cookie: aliceCookie });
    const body = await me.json();
    expect(body.user).toBeNull();
  });
});