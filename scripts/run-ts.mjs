/**
 * 以 esbuild 把 TypeScript 腳本打包後執行。
 *
 * 用於 `npm run dev:api` 與 `npm run db:migrate`，避免依賴額外的 ts 執行器。
 * 會順便載入 .env.local（存在才載入）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

const entry = process.argv[2];
if (!entry) {
  console.error('用法：node scripts/run-ts.mjs <entry.ts>');
  process.exit(1);
}

const envFile = resolve('.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^['"]|['"]$/g, '');
  }
}

const outfile = resolve('.dev', entry.replace(/[/\\]/g, '_').replace(/\.ts$/, '') + '.mjs');
mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  external: ['@electric-sql/pglite'],
  logLevel: 'warning',
});

const child = spawn(process.execPath, [outfile], { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));