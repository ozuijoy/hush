/**
 * 儲存抽象層。
 *
 * - `s3`：任何 S3 相容服務（Backblaze B2、Supabase Storage、MinIO、Wasabi…），
 *   瀏覽器直接以預簽名網址上傳／下載，檔案不經過函式。
 * - `pg`：把小型檔案切成 chunk 存在 Postgres，僅作為本機開發或應急後備；
 *   正式環境請用物件儲存。
 *
 * 本專案刻意不使用 Cloudflare R2。
 */
import type { Config } from '../config';
import type { Sql } from '../types';
import { PgStorage } from './pg';
import { S3Storage } from './s3';
import type { Storage } from './types';

export function storageKeyFor(fileId: string, name: string, now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}/${month}/${fileId}/${name}`;
}

export function createStorage(config: Config, sql: Sql): Storage {
  if (config.storageDriver === 's3') {
    if (!config.s3) {
      throw new Error('STORAGE_DRIVER=s3 但 S3 設定不完整。');
    }
    return new S3Storage(config.s3);
  }
  return new PgStorage(sql);
}

export type { Storage, StoredFile, UploadTarget } from './types';