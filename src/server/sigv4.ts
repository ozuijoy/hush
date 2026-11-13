/**
 * AWS Signature V4 預簽名（query string 形式）。
 *
 * 只用 Web Crypto 實作，所以 Cloudflare Pages Functions 與 Netlify Functions
 * 都能直接替 S3 相容服務（Backblaze B2、Supabase Storage、MinIO、Wasabi…）
 * 產生一次性上傳／下載網址；檔案不經過函式，因此不受 6 MB 請求上限影響。
 */

const ALGORITHM = 'AWS4-HMAC-SHA256';
const encoder = new TextEncoder();

export interface PresignInput {
  method: string;
  /** 例如 `bucket.s3.us-west-004.backblazeb2.com` 或 `s3.us-east-1.amazonaws.com`（path-style）。 */
  host: string;
  /** `https:`（預設）或自架 MinIO 的 `http:`。 */
  protocol?: string;
  /** 已做 RFC3986 編碼的資源路徑，例如 `/hush/2026/file.pdf`。 */
  path: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresIn: number;
  extraQuery?: Record<string, string>;
  service?: string;
  now?: Date;
}

export interface PresignResult {
  url: string;
  signature: string;
  canonicalRequest: string;
  amzDate: string;
  scope: string;
}

/** AWS 要求的 RFC3986 編碼：encodeURIComponent 不會處理 !'()*。 */
export function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function amzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmac(key: string | Uint8Array, data: string): Promise<Uint8Array> {
  const raw = typeof key === 'string' ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    raw as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  return new Uint8Array(signature);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return hex(new Uint8Array(digest));
}

async function signingKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<Uint8Array> {
  const kDate = await hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

export async function presign(input: PresignInput): Promise<PresignResult> {
  const service = input.service ?? 's3';
  const now = input.now ?? new Date();
  const stamp = amzDate(now);
  const dateStamp = stamp.slice(0, 8);
  const scope = `${dateStamp}/${input.region}/${service}/aws4_request`;

  const query: Array<[string, string]> = [
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', `${input.accessKeyId}/${scope}`],
    ['X-Amz-Date', stamp],
    ['X-Amz-Expires', String(input.expiresIn)],
    ['X-Amz-SignedHeaders', 'host'],
    ...Object.entries(input.extraQuery ?? {}),
  ];

  // SigV4 規定先依「編碼後的參數名」排序、同名再依值排序；
  // 直接對 `key=value` 字串排序，在某個鍵是另一個鍵的前綴時（如 `a` 與 `a-b`）會排錯。
  const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const canonicalQuery = query
    .map(([key, value]) => [rfc3986(key), rfc3986(value)] as const)
    .sort(([ka, va], [kb, vb]) => byCodePoint(ka, kb) || byCodePoint(va, vb))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const canonicalRequest = [
    input.method.toUpperCase(),
    input.path,
    canonicalQuery,
    `host:${input.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    ALGORITHM,
    stamp,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const key = await signingKey(input.secretAccessKey, dateStamp, input.region, service);
  const signature = hex(await hmac(key, stringToSign));

  return {
    url: `${input.protocol ?? 'https:'}//${input.host}${input.path}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    signature,
    canonicalRequest,
    amzDate: stamp,
    scope,
  };
}

/** 把物件鍵轉成安全的路徑（保留 `/` 分隔）。 */
export function encodeObjectPath(segments: string[]): string {
  return `/${segments.map((segment) => rfc3986(segment)).join('/')}`;
}