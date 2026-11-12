/**
 * 對 Neon 執行 schema 遷移。
 *
 * 用法：DATABASE_URL=postgres://... npm run db:migrate
 * 或先建立 .env.local。
 */
import { loadConfig } from '../src/server/config';
import { createNeonSql, ensureSchema } from '../src/server/db';

const config = loadConfig(process.env as Record<string, string | undefined>);

if (!config.databaseUrl) {
  console.error('請先設定 DATABASE_URL（可放在 .env.local）。');
  process.exit(1);
}

const sql = createNeonSql(config.databaseUrl);
await ensureSchema(sql);

const rows = await sql.query<{ version: number }>(
  'select version from schema_migrations order by version desc limit 1',
);
console.log(`Hush 資料庫就緒（schema v${rows[0]?.version ?? '?'}）。`);