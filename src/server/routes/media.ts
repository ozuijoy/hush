/**
 * 外鏈媒體代理：成員貼的圖片／音訊／影片網址由伺服器代抓，對方網站看不到成員的 IP。
 *
 *   GET /api/media/info?url=…  只看標頭，回傳 { kind, size, previewable, reason }
 *   GET /api/media?url=…       轉送內容（上限 MEDIA_PROXY_LIMIT，超過回 413）
 *
 * 安全檢查集中在 ../outbound.ts。
 */
import { Hono } from 'hono';
import { requireAuth } from '../auth';
import type { AppBindings } from '../context';
import { HttpError } from '../http';
import { MEDIA_PROXY_LIMIT, fetchExternal, limitStream, mediaMeta } from '../outbound';

export const mediaRoutes = new Hono<AppBindings>();

mediaRoutes.use('*', requireAuth);

mediaRoutes.get('/info', async (c) => {
  const outbound = c.get('outbound');
  const raw = c.req.query('url');
  let { response, url } = await fetchExternal(raw, outbound, 'HEAD');
  // 有些伺服器不支援 HEAD，或 HEAD 不給類型：改用 GET，只讀標頭就取消。
  if (!response.ok || !response.headers.get('content-type')) {
    ({ response, url } = await fetchExternal(raw, outbound, 'GET'));
    await response.body?.cancel().catch(() => undefined);
  }
  if (!response.ok) {
    return c.json({ kind: null, size: null, previewable: false, reason: 'unreachable', limit: MEDIA_PROXY_LIMIT });
  }
  const meta = mediaMeta(response, url);
  if (!meta) {
    return c.json({ kind: null, size: null, previewable: false, reason: 'not_media', limit: MEDIA_PROXY_LIMIT });
  }
  const tooLarge = meta.size !== null && meta.size > MEDIA_PROXY_LIMIT;
  return c.json({
    kind: meta.kind,
    size: meta.size,
    previewable: !tooLarge,
    reason: tooLarge ? 'too_large' : null,
    limit: MEDIA_PROXY_LIMIT,
  });
});

mediaRoutes.get('/', async (c) => {
  const { response, url } = await fetchExternal(c.req.query('url'), c.get('outbound'), 'GET');
  const fail = async (error: HttpError) => {
    await response.body?.cancel().catch(() => undefined);
    throw error;
  };
  if (!response.ok || !response.body) {
    return fail(new HttpError(502, 'media_unreachable', `對方網站回應 HTTP ${response.status}。`));
  }
  const meta = mediaMeta(response, url);
  if (!meta) return fail(new HttpError(415, 'not_media', '這個網址不是可預覽的圖片、音訊或影片。'));
  if (meta.size !== null && meta.size > MEDIA_PROXY_LIMIT) {
    return fail(new HttpError(413, 'media_too_large', '檔案超過 6 MB，無法預覽。'));
  }

  const headers: Record<string, string> = {
    'Content-Type': meta.contentType,
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
  };
  if (meta.size !== null) headers['Content-Length'] = String(meta.size);
  return new Response(limitStream(response.body, MEDIA_PROXY_LIMIT), { headers });
});
