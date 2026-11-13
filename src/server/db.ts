/**
 * 資料庫存取層。
 *
 * 正式環境使用 Neon 的 HTTP driver（同時適用 Cloudflare Pages Functions 與
 * Netlify Functions，不需要 TCP socket）；本機開發與測試則換成 PGlite，
 * 兩者共用同一個 `Sql` 介面與同一份 schema。
 */
import { neon } from '@neondatabase/serverless';
import type { Sql } from './types';
import { OPTIONAL_SCHEMA_STATEMENTS, SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema';

const clients = new Map<string, Sql>();

export function createNeonSql(databaseUrl: string): Sql {
  const cached = clients.get(databaseUrl);
  if (cached) return cached;

  const query = neon(databaseUrl);
  const sql: Sql = {
    async query<T>(text: string, params: unknown[] = []) {
      const rows = await query.query(text, params);
      return rows as T[];
    },
  };
  clients.set(databaseUrl, sql);
  return sql;
}

let migration: Promise<void> | null = null;

/** 冪等遷移；同一個 isolate 內只會執行一次，失敗後允許重試。 */
export function ensureSchema(sql: Sql): Promise<void> {
  if (!migration) {
    migration = runMigrations(sql).catch((error) => {
      migration = null;
      throw error;
    });
  }
  return migration;
}

async function runMigrations(sql: Sql): Promise<void> {
  try {
    const rows = await sql.query<{ version: number }>(
      'select version from schema_migrations order by version desc limit 1',
    );
    if (Number(rows[0]?.version ?? 0) >= SCHEMA_VERSION) return;
  } catch {
    // 第一次部署時 schema_migrations 還不存在，直接往下建立。
  }

  for (const statement of SCHEMA_STATEMENTS) {
    await sql.query(statement);
  }
  for (const statement of OPTIONAL_SCHEMA_STATEMENTS) {
    try {
      await sql.query(statement);
    } catch (error) {
      console.warn('[hush] optional schema statement skipped:', (error as Error).message);
    }
  }
  await sql.query(
    'insert into schema_migrations (version) values ($1) on conflict (version) do nothing',
    [SCHEMA_VERSION],
  );
}

/** 測試與首次啟動用：回報目前資料庫是否已具備 schema。 */
export async function schemaReady(sql: Sql): Promise<boolean> {
  try {
    const rows = await sql.query<{ version: number }>(
      'select version from schema_migrations order by version desc limit 1',
    );
    return Number(rows[0]?.version ?? 0) >= SCHEMA_VERSION;
  } catch {
    return false;
  }
}