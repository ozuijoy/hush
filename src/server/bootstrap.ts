/**
 * 首次啟動：建立唯一的管理員帳號。
 *
 * 帳號密碼來自環境變數（ADMIN_PASSWORD 或 ADMIN_PASSWORD_HASH），
 * 只有資料庫裡完全沒有管理員時才會寫入，之後改密碼請用應用程式內的功能，
 * 環境變數不會覆蓋資料庫。
 */
import type { Config } from './config';
import { hashPassword, pickColor } from './crypto';
import { HttpError } from './http';
import type { Sql } from './types';

export async function ensureAdmin(sql: Sql, config: Config): Promise<void> {
  const rows = await sql.query<{ count: number }>(
    `select count(*)::int as count from users where role = 'admin'`,
  );
  if (Number(rows[0]?.count ?? 0) > 0) return;

  let passwordHash = config.adminPasswordHash;
  if (!passwordHash) {
    if (!config.adminPassword) {
      throw new HttpError(
        503,
        'admin_not_configured',
        '尚未建立管理員：請在環境變數設定 ADMIN_PASSWORD（或 ADMIN_PASSWORD_HASH）後重新整理。',
      );
    }
    passwordHash = await hashPassword(config.adminPassword);
  }

  await sql.query(
    `insert into users (id, username, display_name, role, password_hash, color)
     values ($1, $2, $3, 'admin', $4, $5)
     on conflict do nothing`,
    [
      crypto.randomUUID(),
      config.adminUsername,
      '管理員',
      passwordHash,
      pickColor(config.adminUsername),
    ],
  );
}