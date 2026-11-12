/**
 * Postgres 直存後備模式：把小檔案切成 base64 chunk 寫入資料庫。
 *
 * 只用於本機開發、測試或沒有物件儲存可用的臨時環境；
 * 受限於 Netlify 同步函式的 6 MB 請求上限，單檔上限 4 MB。
 */
import { PG_UPLOAD_LIMIT } from '../config';
import type { Sql } from '../types';
import type { DownloadTarget, Storage, StoredFile, UploadTarget } from './types';

const CHUNK_BYTES = 512 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class PgStorage implements Storage {
  readonly driver = 'pg' as const;
  readonly maxUploadBytes = PG_UPLOAD_LIMIT;

  constructor(private readonly sql: Sql) {}

  async uploadTarget(file: StoredFile): Promise<UploadTarget> {
    return {
      url: `/api/files/${file.id}/content`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      expiresIn: 900,
    };
  }

  async downloadTarget(file: StoredFile): Promise<DownloadTarget> {
    return { url: `/api/files/${file.id}/content`, expiresIn: 0, mode: 'proxy' };
  }

  async save(fileId: string, bytes: Uint8Array): Promise<void> {
    if (bytes.byteLength > PG_UPLOAD_LIMIT) {
      throw new Error('檔案超過 Postgres 直存模式的上限。');
    }
    await this.sql.query('delete from file_chunks where file_id = $1', [fileId]);
    for (let offset = 0, index = 0; offset < bytes.byteLength; offset += CHUNK_BYTES, index += 1) {
      const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, bytes.byteLength));
      await this.sql.query(
        'insert into file_chunks (file_id, idx, data_b64) values ($1, $2, $3)',
        [fileId, index, bytesToBase64(chunk)],
      );
    }
  }

  async load(fileId: string): Promise<Uint8Array | null> {
    const rows = await this.sql.query<{ data_b64: string }>(
      'select data_b64 from file_chunks where file_id = $1 order by idx asc',
      [fileId],
    );
    if (!rows.length) return null;

    const parts = rows.map((row) => base64ToBytes(row.data_b64));
    const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.byteLength;
    }
    return output;
  }

  async remove(file: StoredFile): Promise<void> {
    await this.sql.query('delete from file_chunks where file_id = $1', [file.id]);
  }
}