/**
 * 產生 ADMIN_PASSWORD_HASH 用的密碼雜湊。
 *
 * 用法：npm run db:migrate 同款執行器 ——
 *   node scripts/run-ts.mjs scripts/hash-password.ts <password>
 */
import { hashPassword } from '../src/server/crypto';

const password = process.argv[2];
if (!password || password.length < 8) {
  console.error('用法：node scripts/run-ts.mjs scripts/hash-password.ts <至少 8 字元密碼>');
  process.exit(1);
}

console.log(await hashPassword(password));