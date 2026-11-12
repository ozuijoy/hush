/**
 * S3 相容物件儲存（預簽名 URL）。
 */
import type { S3Config } from '../config';
import { encodeObjectPath, presign, rfc3986 } from '../sigv4';
import { contentDisposition } from '../http';
import type { DownloadTarget, Storage, StoredFile, UploadTarget } from './types';

const UPLOAD_TTL = 900;
const DOWNLOAD_TTL = 300;

export class S3Storage implements Storage {
  readonly driver = 's3' as const;

  constructor(private readonly s3: S3Config) {}

  private locate(file: StoredFile) {
    const endpoint = new URL(this.s3.endpoint);
    const prefix = this.s3.prefix.replace(/\/+$/, '');
    const segments = [...(prefix ? prefix.split('/') : []), ...file.storageKey.split('/')];
    const objectPath = encodeObjectPath(segments.filter(Boolean));

    if (this.s3.forcePathStyle) {
      return {
        protocol: endpoint.protocol,
        host: endpoint.host,
        path: `/${rfc3986(this.s3.bucket)}${objectPath}`,
      };
    }
    return {
      protocol: endpoint.protocol,
      host: `${this.s3.bucket}.${endpoint.host}`,
      path: objectPath,
    };
  }

  async uploadTarget(file: StoredFile): Promise<UploadTarget> {
    const { protocol, host, path } = this.locate(file);
    const { url } = await presign({
      method: 'PUT',
      protocol,
      host,
      path,
      region: this.s3.region,
      accessKeyId: this.s3.accessKeyId,
      secretAccessKey: this.s3.secretAccessKey,
      expiresIn: UPLOAD_TTL,
    });
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': file.mime },
      expiresIn: UPLOAD_TTL,
    };
  }

  async downloadTarget(file: StoredFile): Promise<DownloadTarget> {
    const { protocol, host, path } = this.locate(file);
    const { url } = await presign({
      method: 'GET',
      protocol,
      host,
      path,
      region: this.s3.region,
      accessKeyId: this.s3.accessKeyId,
      secretAccessKey: this.s3.secretAccessKey,
      expiresIn: DOWNLOAD_TTL,
      extraQuery: { 'response-content-disposition': contentDisposition(file.name) },
    });
    return { url, expiresIn: DOWNLOAD_TTL, mode: 'presigned' };
  }

  async save(): Promise<void> {
    throw new Error('S3 模式不需要伺服器端寫入。');
  }

  async load(): Promise<Uint8Array | null> {
    return null;
  }

  /** 以預簽名的 DELETE 直接刪除物件，失敗不影響資料庫標記。 */
  async remove(file: StoredFile): Promise<void> {
    try {
      const { protocol, host, path } = this.locate(file);
      const { url } = await presign({
        method: 'DELETE',
        protocol,
        host,
        path,
        region: this.s3.region,
        accessKeyId: this.s3.accessKeyId,
        secretAccessKey: this.s3.secretAccessKey,
        expiresIn: 60,
      });
      await fetch(url, { method: 'DELETE' });
    } catch {
      // 物件可能已不存在，或 bucket 未開放 DeleteObject；DB 仍會標記為已刪除。
    }
  }
}