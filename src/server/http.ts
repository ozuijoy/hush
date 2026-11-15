/**
 * HTTP 共用工具：錯誤型別、輸入驗證、檔名清理。
 */
import type { Context } from 'hono';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
    return body as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'invalid_json', '請求內容不是有效的 JSON。');
  }
}

export function requireString(
  value: unknown,
  field: string,
  { min = 1, max = 200 }: { min?: number; max?: number } = {},
): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'invalid_field', `缺少欄位：${field}。`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min) {
    throw new HttpError(400, 'invalid_field', `欄位 ${field} 至少需要 ${min} 個字元。`);
  }
  if (trimmed.length > max) {
    throw new HttpError(400, 'invalid_field', `欄位 ${field} 不可超過 ${max} 個字元。`);
  }
  return trimmed;
}

export function optionalString(value: unknown, max = 200): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_field', '欄位型別錯誤。');
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw new HttpError(400, 'invalid_field', `欄位不可超過 ${max} 個字元。`);
  }
  return trimmed;
}

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function requireUsername(value: unknown): string {
  const username = requireString(value, 'username', { min: 3, max: 32 }).toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    throw new HttpError(
      400,
      'invalid_username',
      '帳號只能使用小寫英文字母、數字、句點、底線與連字號，長度 3–32。',
    );
  }
  return username;
}

export function requirePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8) {
    throw new HttpError(400, 'weak_password', '密碼至少需要 8 個字元。');
  }
  if (value.length > 200) {
    throw new HttpError(400, 'weak_password', '密碼過長。');
  }
  return value;
}

/** 只保留安全字元，避免路徑穿越與奇怪的物件鍵。 */
export function safeFileName(input: string): string {
  const base = input.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  const limited = cleaned.slice(0, 120);
  return limited || '未命名檔案';
}

/** 解析分頁筆數：非數字或越界時回到預設值／夾在範圍內，避免把 NaN 帶進 SQL。 */
export function parseLimit(raw: string | undefined, fallback: number, max: number): number {
  const value = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, 1), max);
}

/** 訊息游標（bigint id）：只接受純數字，否則回 400，而不是讓 SQL 轉型失敗變成 500。 */
export function optionalCursor(raw: string | undefined, field: string): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!/^\d{1,18}$/.test(raw)) {
    throw new HttpError(400, 'invalid_cursor', `參數 ${field} 格式錯誤。`);
  }
  return raw;
}

/**
 * 取得用戶端 IP。優先使用平台寫入、用戶端無法偽造的標頭：
 * Cloudflare 的 cf-connecting-ip、Netlify 的 x-nf-client-connection-ip；
 * x-forwarded-for 只當本機開發的後備。
 */
export function clientIp(c: Context): string {
  const trusted = c.req.header('cf-connecting-ip') || c.req.header('x-nf-client-connection-ip');
  const forwarded = trusted || c.req.header('x-forwarded-for') || '';
  return forwarded.split(',')[0].trim().slice(0, 64) || 'local';
}
/** RFC 5987 檔名，避免中文檔名在 Content-Disposition 壞掉。 */
export function contentDisposition(name: string, type: 'attachment' | 'inline' = 'attachment'): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
