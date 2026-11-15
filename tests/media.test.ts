import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app';
import { loadConfig } from '../src/server/config';
import { ensureSchema } from '../src/server/db';
import { MEDIA_PROXY_LIMIT, isBlockedAddress, parseExternalUrl, type Outbound } from '../src/server/outbound';
import type { Sql } from '../src/server/types';
import { extractLinks, splitLinks } from '../web/lib/links';

describe('外鏈網址檢查', () => {
  it('私有、迴路、鏈路本地、CGNAT 與內嵌 IPv4 的 IPv6 都擋下', () => {
    for (const address of [
      '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
      '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
      '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1',
      '64:ff9b::a00:1', 'not-an-ip',
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
    for (const address of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it('網址格式：只收 http/https、預設連接埠、公開主機', () => {
    expect(parseExternalUrl('https://example.com/a.png#x').toString()).toBe('https://example.com/a.png');
    for (const raw of [
      'ftp://example.com/a.png', 'file:///etc/passwd', 'http://localhost/a.png', 'http://127.1/a.png',
      'http://2130706433/a.png', 'http://0x7f000001/', 'http://[::1]/', 'http://user:pw@example.com/',
      'http://example.com:8080/a.png', 'http://intranet/a.png', 'http://printer.local/a.png', '',
    ]) {
      expect(() => parseExternalUrl(raw), raw).toThrow();
    }
  });

  it('訊息內文切出網址，結尾標點不算', () => {
    expect(splitLinks('看 https://example.com/a.png。好看嗎')).toEqual([
      { type: 'text', value: '看 ' },
      { type: 'link', url: 'https://example.com/a.png' },
      { type: 'text', value: '。好看嗎' },
    ]);
    expect(extractLinks('(https://en.wikipedia.org/wiki/Foo_(bar)) and https://x.com/y.mp3, https://x.com/y.mp3')).toEqual([
      'https://en.wikipedia.org/wiki/Foo_(bar)',
      'https://x.com/y.mp3',
    ]);
    expect(splitLinks('沒有網址 http://')).toEqual([{ type: 'text', value: '沒有網址 http://' }]);
  });
});

/** 假的外部網路：主機 → IP、網址 → 回應。 */
const hosts: Record<string, string[]> = {
  'cdn.example.com': ['93.184.216.34'],
  'evil.example.com': ['10.0.0.5'],
};
const requested: { url: string; method: string; headers: Record<string, string> }[] = [];
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

const outbound: Outbound = {
  resolve: async (host) => hosts[host] ?? ['93.184.216.34'],
  fetch: async (input, init) => {
    const url = String(input);
    requested.push({ url, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string> });
    const body = init?.method === 'HEAD' ? null : png;
    switch (new URL(url).pathname) {
      case '/cat.png':
        return new Response(body, { headers: { 'content-type': 'image/png', 'content-length': String(png.length) } });
      case '/song':
        return new Response(body, { headers: { 'content-type': 'audio/mpeg' } });
      case '/big.mp4':
        return new Response(body, { headers: { 'content-type': 'video/mp4', 'content-length': String(MEDIA_PROXY_LIMIT + 1) } });
      case '/page.png':
        return new Response(body, { headers: { 'content-type': 'text/html' } });
      case '/logo.svg':
        return new Response(body, { headers: { 'content-type': 'image/svg+xml' } });
      case '/to-internal':
        return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
      case '/to-cat':
        return new Response(null, { status: 301, headers: { location: '/cat.png' } });
      case '/no-head.png':
        return init?.method === 'HEAD'
          ? new Response(null, { status: 405 })
          : new Response(png, { headers: { 'content-type': 'image/png' } });
      default:
        return new Response('nope', { status: 404 });
    }
  },
};

let app: ReturnType<typeof createApp>;
let cookie = '';

const get = (path: string, withCookie = true) =>
  app.request(path, { headers: withCookie ? { cookie } : {} });
const media = (url: string) => get(`/api/media?url=${encodeURIComponent(url)}`);
const info = async (url: string) => (await get(`/api/media/info?url=${encodeURIComponent(url)}`)).json();

beforeAll(async () => {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const sql: Sql = {
    async query<T>(text: string, params: unknown[] = []) {
      return (await pg.query(text, params)).rows as T[];
    },
  };
  await ensureSchema(sql);
  const config = loadConfig({
    DATABASE_URL: 'pglite://memory',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'admin-pass-123',
    STORAGE_DRIVER: 'pg',
    AUTO_MIGRATE: '0',
  });
  app = createApp({ sql, config, outbound });
  const login = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin-pass-123' }),
  });
  cookie = (login.headers.getSetCookie?.() ?? []).find((v) => v.startsWith('hush_session='))!.split(';')[0];
});

describe('外鏈媒體代理 API', () => {
  it('未登入不能使用', async () => {
    expect((await get('/api/media?url=https%3A%2F%2Fcdn.example.com%2Fcat.png', false)).status).toBe(401);
  });

  it('代抓圖片：類型來自白名單、不帶 Cookie、可在瀏覽器快取', async () => {
    requested.length = 0;
    const res = await media('https://cdn.example.com/cat.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
    expect(requested[0].headers).not.toHaveProperty('cookie');
  });

  it('info：媒體回報種類與大小，超過 4 MB 不可預覽', async () => {
    expect(await info('https://cdn.example.com/cat.png')).toMatchObject({ kind: 'image', size: png.length, previewable: true });
    expect(await info('https://cdn.example.com/song')).toMatchObject({ kind: 'audio', size: null, previewable: true });
    expect(await info('https://cdn.example.com/big.mp4')).toMatchObject({ kind: 'video', previewable: false, reason: 'too_large' });
    expect(await info('https://cdn.example.com/page.png')).toMatchObject({ kind: null, reason: 'not_media' });
    expect(await info('https://cdn.example.com/no-head.png')).toMatchObject({ kind: 'image', previewable: true });
  });

  it('超過 4 MB 回 413；HTML、SVG 不轉送', async () => {
    expect((await media('https://cdn.example.com/big.mp4')).status).toBe(413);
    expect((await media('https://cdn.example.com/page.png')).status).toBe(415);
    expect((await media('https://cdn.example.com/logo.svg')).status).toBe(415);
  });

  it('擋下內部網路：IP 字面、DNS 解析到私有位址、轉址到內部', async () => {
    requested.length = 0;
    expect((await media('http://127.0.0.1/cat.png')).status).toBe(400);
    expect((await media('https://evil.example.com/cat.png')).status).toBe(400);
    expect(requested).toHaveLength(0);
    const redirected = await media('https://cdn.example.com/to-internal');
    expect(redirected.status).toBe(400);
    expect(requested.map((r) => r.url)).toEqual(['https://cdn.example.com/to-internal']);
  });

  it('公開網址之間的轉址會跟隨', async () => {
    const res = await media('https://cdn.example.com/to-cat');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });
});

describe('外鏈媒體上限', () => {
  it('低於 Netlify 6 MB 回應上限扣掉 base64 膨脹後的大小', () => {
    expect(MEDIA_PROXY_LIMIT).toBe(4 * 1024 * 1024);
    expect(Math.ceil(MEDIA_PROXY_LIMIT / 3) * 4).toBeLessThan(6 * 1024 * 1024);
  });
});
