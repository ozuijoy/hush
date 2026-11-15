/**
 * 檔案：建立預簽名上傳、完成、取得下載網址、刪除。
 *
 * 檔案內容不經過函式（S3 模式），所以不受 Netlify 6 MB 同步請求上限影響；
 * Postgres 直存模式則限制在 4 MB。
 */
import { Hono } from 'hono';
import { recordAudit } from '../audit';
import { requireAdmin, requireAuth } from '../auth';
import type { AppBindings, AppContext } from '../context';
import { PG_UPLOAD_LIMIT } from '../config';
import { HttpError, contentDisposition, readJson, requireString, safeFileName } from '../http';
import { ISO_TIME } from '../schema';
import { createStorage, storageKeyFor } from '../storage';
import { previewInfo } from '../../shared/preview';
import { fetchMessageById } from './messages';

export const fileRoutes = new Hono<AppBindings>();

fileRoutes.use('*', requireAuth);

interface FileRow {
  id: string;
  name: string;
  mime: string;
  sizeBytes: string;
  storageDriver: string;
  storageKey: string;
  status: string;
  uploaderId: string | null;
  uploaderName: string | null;
  uploaderColor: string | null;
  createdAt: string;
}

const FILE_SELECT = `
  select f.id, f.name, f.mime, f.size_bytes::text as "sizeBytes",
         f.storage_driver as "storageDriver", f.storage_key as "storageKey", f.status,
         ${ISO_TIME('f.created_at')} as "createdAt",
         u.id as "uploaderId", u.display_name as "uploaderName", u.color as "uploaderColor"
  from files f
  left join users u on u.id = f.uploader_id
`;

function toFile(row: FileRow) {
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: Number(row.sizeBytes),
    createdAt: row.createdAt,
    uploader: row.uploaderId
      ? { id: row.uploaderId, name: row.uploaderName ?? '未知成員', color: row.uploaderColor ?? '#6d5df6' }
      : null,
  };
}

async function loadFile(c: AppContext, id: string) {
  const rows = await c
    .get('db')
    .query<FileRow>(`${FILE_SELECT} where f.id = $1 and f.deleted_at is null`, [id]);
  return rows[0] ?? null;
}

fileRoutes.get('/', async (c) => {
  const db = c.get('db');
  // 清掉超過 24 小時仍未完成上傳的預留資料。
  await db.query(
    `delete from files where status = 'pending' and created_at < now() - interval '24 hours'`,
  );

  const rows = await db.query<FileRow>(
    `${FILE_SELECT} where f.deleted_at is null and f.status = 'ready' order by f.created_at desc limit 200`,
  );
  const files = rows.map(toFile);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  return c.json({
    files,
    totalBytes,
    storageDriver: c.get('config').storageDriver,
    maxUploadBytes: c.get('config').maxUploadBytes,
  });
});

fileRoutes.post('/presign', async (c) => {
  const body = await readJson(c);
  const name = safeFileName(requireString(body.name, 'name', { max: 255 }));
  const size = Number(body.size);
  const mime =
    typeof body.mime === 'string' && body.mime.trim()
      ? body.mime.trim().slice(0, 200)
      : 'application/octet-stream';

  const config = c.get('config');
  if (!Number.isInteger(size) || size <= 0) {
    throw new HttpError(400, 'invalid_size', '檔案大小不正確。');
  }
  if (size > config.maxUploadBytes) {
    throw new HttpError(
      413,
      'file_too_large',
      `檔案超過 ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB 上限。`,
    );
  }

  const storage = createStorage(config, c.get('db'));
  const id = crypto.randomUUID();
  const storageKey = storageKeyFor(id, name);
  const user = c.get('user');

  await c.get('db').query(
    `insert into files (id, name, mime, size_bytes, storage_driver, storage_key, status, uploader_id)
     values ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
    [id, name, mime, size, storage.driver, storageKey, user.id],
  );

  const target = await storage.uploadTarget({ id, name, mime, sizeBytes: size, storageKey });
  return c.json({ fileId: id, upload: { ...target, mode: storage.driver } }, 201);
});

fileRoutes.put('/:id/content', async (c) => {
  const config = c.get('config');
  if (config.storageDriver !== 'pg') {
    throw new HttpError(400, 'unsupported', '目前儲存模式不支援直接上傳。');
  }

  const user = c.get('user');
  const file = await loadFile(c, c.req.param('id'));
  if (!file) throw new HttpError(404, 'not_found', '找不到這個檔案。');
  if (file.status !== 'pending') throw new HttpError(409, 'already_uploaded', '檔案已上傳完成。');
  if (file.uploaderId !== user.id && user.role !== 'admin') {
    throw new HttpError(403, 'forbidden', '只能上傳自己建立的檔案。');
  }

  const declaredLength = Number(c.req.header('content-length') || 0);
  if (declaredLength > PG_UPLOAD_LIMIT) {
    throw new HttpError(413, 'file_too_large', '檔案超過 4 MB 上限。');
  }

  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength === 0) throw new HttpError(400, 'empty_body', '檔案內容是空的。');
  if (bytes.byteLength !== Number(file.sizeBytes)) {
    throw new HttpError(400, 'size_mismatch', '檔案大小與申請時不一致。');
  }

  await createStorage(config, c.get('db')).save(file.id, bytes);
  return c.json({ ok: true });
});

fileRoutes.post('/:id/complete', async (c) => {
  const body = await readJson(c);
  const caption =
    typeof body.caption === 'string' && body.caption.trim()
      ? body.caption.trim().slice(0, 1000)
      : null;

  const user = c.get('user');
  const db = c.get('db');
  const file = await loadFile(c, c.req.param('id'));
  if (!file) throw new HttpError(404, 'not_found', '找不到這個檔案。');
  if (file.status !== 'pending') throw new HttpError(409, 'already_completed', '檔案已完成。');
  if (file.uploaderId !== user.id && user.role !== 'admin') {
    throw new HttpError(403, 'forbidden', '只能完成自己上傳的檔案。');
  }

  await db.query(`update files set status = 'ready' where id = $1`, [file.id]);
  const inserted = await db.query<{ id: string }>(
    `insert into messages (author_id, kind, body, file_id) values ($1, 'file', $2, $3) returning id::text as id`,
    [user.id, caption, file.id],
  );
  await recordAudit(db, { id: user.id, name: user.displayName }, 'file.upload', {
    type: 'file',
    id: file.id,
  }, { name: file.name, size: Number(file.sizeBytes) });

  return c.json(
    {
      file: toFile({ ...file, status: 'ready' }),
      message: await fetchMessageById(db, inserted[0].id),
    },
    201,
  );
});

fileRoutes.get('/:id/url', async (c) => {
  const file = await loadFile(c, c.req.param('id'));
  if (!file || file.status !== 'ready') throw new HttpError(404, 'not_found', '找不到這個檔案。');

  // ?inline=1：可預覽的類型回傳 inline 網址；其餘類型照舊以附件下載。
  const wantsInline = c.req.query('inline') === '1';
  const preview = wantsInline ? previewInfo(file.name, file.mime, Number(file.sizeBytes)) : null;
  const target = await createStorage(c.get('config'), c.get('db')).downloadTarget(
    {
      id: file.id,
      name: file.name,
      mime: file.mime,
      sizeBytes: Number(file.sizeBytes),
      storageKey: file.storageKey,
    },
    preview,
  );
  return c.json({ ...target, preview: preview?.kind ?? null });
});

fileRoutes.get('/:id/content', async (c) => {
  const config = c.get('config');
  if (config.storageDriver !== 'pg') {
    throw new HttpError(404, 'not_found', '這個檔案請使用預簽名下載網址。');
  }

  const file = await loadFile(c, c.req.param('id'));
  if (!file || file.status !== 'ready') throw new HttpError(404, 'not_found', '找不到這個檔案。');

  const bytes = await createStorage(config, c.get('db')).load(file.id);
  if (!bytes) throw new HttpError(404, 'not_found', '檔案內容不存在。');

  const preview =
    c.req.query('inline') === '1' ? previewInfo(file.name, file.mime, Number(file.sizeBytes)) : null;
  const headers: Record<string, string> = {
    // 附件也不直接沿用上傳者宣告的 MIME：同源回應若被當成 HTML 開啟會在站內執行。
    'Content-Type': preview ? preview.contentType : 'application/octet-stream',
    'Content-Length': String(bytes.byteLength),
    'Content-Disposition': contentDisposition(file.name, preview ? 'inline' : 'attachment'),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (preview && preview.kind !== 'pdf') {
    // 預覽內容與網站同源：再加一層沙箱，就算被直接開啟也不能執行腳本。
    // （PDF 不加：Chrome 不在沙箱 frame 裏顯示 PDF。PDF 由瀏覽器內建檢視器開啟，不執行頁面腳本。）
    headers['Content-Security-Policy'] = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
  }
  return new Response(bytes as unknown as BodyInit, { headers });
});

fileRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  requireAdmin(user);
  const db = c.get('db');
  const file = await loadFile(c, c.req.param('id'));
  if (!file) throw new HttpError(404, 'not_found', '找不到這個檔案。');

  await db.query(`update files set deleted_at = now(), deleted_by = $2 where id = $1`, [
    file.id,
    user.id,
  ]);
  await createStorage(c.get('config'), db).remove({
    id: file.id,
    name: file.name,
    mime: file.mime,
    sizeBytes: Number(file.sizeBytes),
    storageKey: file.storageKey,
  });
  await recordAudit(db, { id: user.id, name: user.displayName }, 'file.delete', {
    type: 'file',
    id: file.id,
  }, { name: file.name });

  return c.json({ ok: true, id: file.id });
});