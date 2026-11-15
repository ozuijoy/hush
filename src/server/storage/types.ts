import type { PreviewInfo } from '../../shared/preview';

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
  /** true：網址以 inline 回傳，可直接放進 <img>/<audio>/<video>/<iframe> 預覽。 */
  inline: boolean;
  /** `presigned` 可直接連外；`proxy` 需帶登入 cookie 回自己的 API。 */
  mode: 'presigned' | 'proxy';
}

export interface Storage {
  driver: 's3' | 'pg';
  uploadTarget(file: StoredFile): Promise<UploadTarget>;
  /** 帶 `preview` 時產生 inline 預覽網址，Content-Type 以白名單值覆寫。 */
  downloadTarget(file: StoredFile, preview?: PreviewInfo | null): Promise<DownloadTarget>;
  /** 僅 pg 驅動使用。 */
  save(fileId: string, bytes: Uint8Array): Promise<void>;
  load(fileId: string): Promise<Uint8Array | null>;
  remove(file: StoredFile): Promise<void>;
}