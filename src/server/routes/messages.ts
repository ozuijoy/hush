/**
 * 訊息列表、送出與刪除。
 */
import { Hono } from 'hono';
import { recordAudit } from '../audit';
import { requireAdmin, requireAuth } from '../auth';
import type { AppBindings } from '../context';
import { HttpError, optionalCursor, parseLimit, readJson, requireString } from '../http';
import { ISO_TIME } from '../schema';
import { MAX_BODY_CHARS } from '../config';
import type { Sql } from '../types';

export const messageRoutes = new Hono<AppBindings>();

messageRoutes.use('*', requireAuth);

interface MessageRow {
  id: string;
  kind: string;
  body: string | null;
  deleted: boolean;
  createdAt: string;
  authorId: string | null;
  authorName: string | null;
  authorColor: string | null;
  fileId: string | null;
  fileName: string | null;
  fileMime: string | null;
  fileSize: string | null;
  fileDeleted: boolean | null;
}

const SELECT_MESSAGES = (where: string, order: string, limit: string) => `
  select m.id::text as id,
         m.kind,
         case when m.deleted_at is null then m.body else null end as body,
         (m.deleted_at is not null) as deleted,
         ${ISO_TIME('m.created_at')} as "createdAt",
         u.id as "authorId",
         u.display_name as "authorName",
         u.color as "authorColor",
         f.id as "fileId",
         f.name as "fileName",
         f.mime as "fileMime",
         f.size_bytes::text as "fileSize",
         (f.deleted_at is not null) as "fileDeleted"
  from messages m
  left join users u on u.id = m.author_id
  left join files f on f.id = m.file_id
  ${where}
  order by m.id ${order}
  limit ${limit}
`;

function toMessage(row: MessageRow) {
  return {
    id: row.id,
    kind: row.deleted ? ('deleted' as const) : (row.kind as 'text' | 'file' | 'system'),
    body: row.body,
    deleted: row.deleted,
    createdAt: row.createdAt,
    author: row.authorId
      ? { id: row.authorId, name: row.authorName ?? '未知成員', color: row.authorColor ?? '#6d5df6' }
      : null,
    file:
      row.fileId && !row.deleted
        ? {
            id: row.fileId,
            name: row.fileName ?? '檔案',
            mime: row.fileMime ?? 'application/octet-stream',
            size: Number(row.fileSize ?? 0),
            deleted: Boolean(row.fileDeleted),
          }
        : null,
  };
}

export async function fetchMessages(
  db: Sql,
  options: { after?: string; before?: string; limit?: number },
): Promise<ReturnType<typeof toMessage>[]> {
  const requested = Number(options.limit);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 200) : 60;
  const after = options.after;
  const before = options.before;

  if (before) {
    const rows = await db.query<MessageRow>(
      SELECT_MESSAGES('where m.id < $1::bigint', 'desc', String(limit)),
      [before],
    );
    return rows.reverse().map(toMessage);
  }

  if (after) {
    const rows = await db.query<MessageRow>(
      SELECT_MESSAGES('where m.id > $1::bigint', 'asc', String(limit)),
      [after],
    );
    return rows.map(toMessage);
  }

  const rows = await db.query<MessageRow>(SELECT_MESSAGES('', 'desc', String(limit)));
  return rows.reverse().map(toMessage);
}

export async function fetchMessageById(db: Sql, id: string) {
  const rows = await db.query<MessageRow>(SELECT_MESSAGES('where m.id = $1::bigint', 'asc', '1'), [id]);
  return rows.length ? toMessage(rows[0]) : null;
}

export async function fetchPinned(db: Sql) {
  const rows = await db.query<{ messageId: string; pinnedAt: string; pinnedByName: string | null }>(
    `select p.message_id::text as "messageId",
            ${ISO_TIME('p.pinned_at')} as "pinnedAt",
            u.display_name as "pinnedByName"
     from chat_pin p
     left join users u on u.id = p.pinned_by
     where p.id = 1`,
  );
  const pin = rows[0];
  if (!pin) return null;
  const message = await fetchMessageById(db, pin.messageId);
  if (!message || message.deleted) return null;
  return { message, pinnedAt: pin.pinnedAt, pinnedBy: pin.pinnedByName };
}

/** 把使用者輸入轉成 ILIKE 樣式，跳脫 % _ \\ 避免被當成萬用字元。 */
function likePattern(input: string): string {
  return `%${input.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

const SEARCH_LIMIT = 30;
const CONTEXT_SIZE = 15;

messageRoutes.get('/pinned', async (c) => {
  return c.json({ pinned: await fetchPinned(c.get('db')) });
});

/**
 * 關鍵字搜尋：比對訊息內文與檔名（不分大小寫），排除已刪除訊息。
 * 可加 author（成員 id）與 files=1（只看檔案）篩選；before 用來翻下一頁。
 */
messageRoutes.get('/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (!q) throw new HttpError(400, 'invalid_field', '請輸入搜尋關鍵字。');
  if (q.length > 100) throw new HttpError(400, 'invalid_field', '關鍵字不可超過 100 個字元。');

  const author = c.req.query('author') || null;
  if (author && !/^[0-9a-f-]{36}$/i.test(author)) {
    throw new HttpError(400, 'invalid_field', '成員編號格式錯誤。');
  }
  const filesOnly = c.req.query('files') === '1';
  const before = optionalCursor(c.req.query('before'), 'before');

  const conditions = [
    'm.deleted_at is null',
    `(m.body ilike $1 escape '\\' or (f.deleted_at is null and f.name ilike $1 escape '\\'))`,
  ];
  const params: unknown[] = [likePattern(q)];
  if (author) {
    params.push(author);
    conditions.push(`m.author_id = $${params.length}::uuid`);
  }
  if (filesOnly) conditions.push(`m.kind = 'file'`);
  if (before) {
    params.push(before);
    conditions.push(`m.id < $${params.length}::bigint`);
  }

  const rows = await c
    .get('db')
    .query<MessageRow>(
      SELECT_MESSAGES(`where ${conditions.join(' and ')}`, 'desc', String(SEARCH_LIMIT + 1)),
      params,
    );
  const hasMore = rows.length > SEARCH_LIMIT;
  const results = rows.slice(0, SEARCH_LIMIT).map(toMessage);
  return c.json({
    results,
    hasMore,
    nextBefore: hasMore ? results[results.length - 1].id : null,
  });
});

/** 某則訊息的前後文：用於搜尋結果與置頂訊息的跳轉。 */
messageRoutes.get('/:id/context', async (c) => {
  const id = c.req.param('id');
  if (!/^\d{1,18}$/.test(id)) throw new HttpError(400, 'invalid_id', '訊息編號格式錯誤。');
  const db = c.get('db');
  const target = await fetchMessageById(db, id);
  if (!target) throw new HttpError(404, 'not_found', '找不到這則訊息。');

  const before = await fetchMessages(db, { before: id, limit: CONTEXT_SIZE });
  const after = await fetchMessages(db, { after: id, limit: CONTEXT_SIZE });
  return c.json({
    messages: [...before, target, ...after],
    targetId: id,
    hasOlder: before.length === CONTEXT_SIZE,
    hasNewer: after.length === CONTEXT_SIZE,
  });
});

messageRoutes.get('/', async (c) => {
  const after = optionalCursor(c.req.query('after'), 'after');
  const before = optionalCursor(c.req.query('before'), 'before');
  const limit = parseLimit(c.req.query('limit'), 60, 200);
  const messages = await fetchMessages(c.get('db'), { after, before, limit });
  return c.json({
    messages,
    // 輪詢只拿新訊息，置頂狀態每次一併回傳，其他成員才看得到變化。
    pinned: await fetchPinned(c.get('db')),
    lastId: messages.length ? messages[messages.length - 1].id : after ?? '0',
    serverTime: new Date().toISOString(),
  });
});

messageRoutes.post('/', async (c) => {
  const body = await readJson(c);
  const text = requireString(body.body, 'body', { min: 1, max: MAX_BODY_CHARS });
  const user = c.get('user');
  const db = c.get('db');

  const inserted = await db.query<{ id: string }>(
    `insert into messages (author_id, kind, body) values ($1, 'text', $2) returning id::text as id`,
    [user.id, text],
  );
  const rows = await db.query<MessageRow>(
    SELECT_MESSAGES('where m.id = $1::bigint', 'asc', '1'),
    [inserted[0].id],
  );
  return c.json({ message: toMessage(rows[0]) }, 201);
});

/** 置頂：同時只有一則，新的會取代舊的。 */
messageRoutes.put('/:id/pin', async (c) => {
  const user = c.get('user');
  requireAdmin(user);
  const id = c.req.param('id');
  if (!/^\d{1,18}$/.test(id)) throw new HttpError(400, 'invalid_id', '訊息編號格式錯誤。');

  const db = c.get('db');
  const target = await fetchMessageById(db, id);
  if (!target || target.deleted) throw new HttpError(404, 'not_found', '找不到這則訊息。');
  if (target.kind === 'system') throw new HttpError(400, 'invalid_target', '系統訊息不能置頂。');

  const previous = await db.query<{ messageId: string }>(
    `select message_id::text as "messageId" from chat_pin where id = 1`,
  );
  await db.query(
    `insert into chat_pin (id, message_id, pinned_by, pinned_at) values (1, $1::bigint, $2, now())
     on conflict (id) do update set message_id = excluded.message_id,
       pinned_by = excluded.pinned_by, pinned_at = excluded.pinned_at`,
    [id, user.id],
  );
  await recordAudit(db, { id: user.id, name: user.displayName }, 'message.pin', {
    type: 'message',
    id,
  }, { replaced: previous[0]?.messageId ?? null });
  return c.json({ pinned: await fetchPinned(db) });
});

messageRoutes.delete('/pin', async (c) => {
  const user = c.get('user');
  requireAdmin(user);
  const db = c.get('db');
  const rows = await db.query<{ messageId: string }>(
    `delete from chat_pin where id = 1 returning message_id::text as "messageId"`,
  );
  if (rows.length) {
    await recordAudit(db, { id: user.id, name: user.displayName }, 'message.unpin', {
      type: 'message',
      id: rows[0].messageId,
    });
  }
  return c.json({ pinned: null });
});

messageRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  requireAdmin(user);
  const id = c.req.param('id');
  if (!/^\d+$/.test(id)) throw new HttpError(400, 'invalid_id', '訊息編號格式錯誤。');

  const db = c.get('db');
  const rows = await db.query<{ id: string }>(
    `update messages set deleted_at = now(), deleted_by = $2
     where id = $1::bigint and deleted_at is null
     returning id::text as id`,
    [id, user.id],
  );
  if (!rows.length) throw new HttpError(404, 'not_found', '找不到這則訊息。');
  // 被刪除的訊息不能繼續置頂。
  await db.query('delete from chat_pin where message_id = $1::bigint', [id]);

  await recordAudit(db, { id: user.id, name: user.displayName }, 'message.delete', {
    type: 'message',
    id,
  });
  return c.json({ ok: true, id });
});