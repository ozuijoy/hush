/**
 * 訊息列表、送出與刪除。
 */
import { Hono } from 'hono';
import { recordAudit } from '../audit';
import { requireAdmin, requireAuth } from '../auth';
import type { AppBindings } from '../context';
import { HttpError, readJson, requireString } from '../http';
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
  const limit = Math.min(Math.max(options.limit ?? 60, 1), 200);
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

messageRoutes.get('/', async (c) => {
  const after = c.req.query('after') || undefined;
  const before = c.req.query('before') || undefined;
  const limit = Number(c.req.query('limit') || 60);
  const messages = await fetchMessages(c.get('db'), { after, before, limit });
  return c.json({
    messages,
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

  await recordAudit(db, { id: user.id, name: user.displayName }, 'message.delete', {
    type: 'message',
    id,
  });
  return c.json({ ok: true, id });
});