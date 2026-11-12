export interface StoredFile {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  storageKey: string;
}

export interface UploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresIn: number;
}

export interface DownloadTarget {
  url: string;
  expiresIn: number;
  /** `presigned` 可直接連外；`proxy` 需帶登入 cookie 回自己的 API。 */
  mode: 'presigned' | 'proxy';
}

export interface Storage {
  driver: 's3' | 'pg';
  uploadTarget(file: StoredFile): Promise<UploadTarget>;
  downloadTarget(file: StoredFile): Promise<DownloadTarget>;
  /** 僅 pg 驅動使用。 */
  save(fileId: string, bytes: Uint8Array): Promise<void>;
  load(fileId: string): Promise<Uint8Array | null>;
  remove(file: StoredFile): Promise<void>;
}