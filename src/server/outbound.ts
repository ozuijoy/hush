/**
 * 代替成員抓取外部媒體（外鏈圖片、音訊、影片）。
 *
 * 目的：成員的瀏覽器只連到 Hush，外部網站只看得到伺服器的 IP。
 * 風險：伺服器替使用者發請求＝SSRF。因此：
 *   - 只接受 http/https、預設連接埠、不含帳密的網址；
 *   - 主機是 IP 時直接檢查；是網域時先解析 DNS（Node 環境），任何一個位址落在
 *     私有、迴路、鏈路本地、CGNAT、多播等範圍就拒絕；
 *   - 不自動跟隨轉址，每一跳都重新檢查，最多 3 跳；
 *   - 不帶 Cookie、Referer，逾時 8 秒，只放行白名單內的圖片／音訊／影片類型，
 *     超過 MEDIA_PROXY_LIMIT 的內容不轉送。
 * 已知限制：DNS 檢查與實際連線之間仍可能被 DNS rebinding 換掉位址；
 * Cloudflare Pages 沒有 DNS 解析 API，只做字面檢查（Workers 本身連不到私有網段）。
 */
import { HttpError } from './http';
import { previewInfo, type PreviewKind } from '../shared/preview';

export const MEDIA_PROXY_LIMIT = 6 * 1024 * 1024;
export const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8000;
const MAX_URL_LENGTH = 2048;

export type Resolver = (hostname: string) => Promise<string[]>;

export interface Outbound {
  fetch: typeof fetch;
  resolve: Resolver;
}

/** 預設解析器：Node（Netlify）用 dns.lookup；其他環境回傳空陣列，只做字面檢查。 */
export const defaultResolver: Resolver = async (hostname) => {
  if (!(globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node) return [];
  const specifier = 'node:dns/promises';
  const dns = (await import(/* @vite-ignore */ specifier)) as {
    lookup: (host: string, options: { all: true }) => Promise<{ address: string }[]>;
  };
  try {
    const records = await dns.lookup(hostname, { all: true });
    return records.map((record) => record.address);
  } catch {
    throw new HttpError(502, 'media_unreachable', '找不到這個網址的主機。');
  }
};

export const defaultOutbound: Outbound = {
  fetch: (input, init) => fetch(input, init),
  resolve: defaultResolver,
};

function parseIPv4(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return bytes.every((byte) => byte >= 0 && byte <= 255) ? bytes : null;
}

function blockedIPv4([a, b, c]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** 把 IPv6 展開成 8 組 16 位元數字；內嵌 IPv4 會轉成最後兩組。 */
function parseIPv6(value: string): number[] | null {
  let text = value.toLowerCase().replace(/^\[|\]$/g, '');
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  if (!text.includes(':')) return null;
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    text = `${text.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  const numbers = groups.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN));
  return numbers.every((n) => Number.isFinite(n)) ? numbers : null;
}

function blockedIPv6(g: number[]): boolean {
  const allZeroUntil = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (allZeroUntil(8)) return true; // ::
  if (allZeroUntil(7) && g[7] === 1) return true; // ::1
  // ::ffff:a.b.c.d、::a.b.c.d、64:ff9b::a.b.c.d（NAT64）一律看內嵌的 IPv4
  const embedded = [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff];
  if (allZeroUntil(5) && (g[5] === 0xffff || g[5] === 0)) return blockedIPv4(embedded);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return blockedIPv4(embedded);
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site local（已廢止）
  if ((g[0] & 0xff00) === 0xff00) return true; // 多播
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // 文件用
  return false;
}

/** 位址是否不可連（私有、迴路、鏈路本地等）。無法解析的字串視為不可連。 */
export function isBlockedAddress(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4) return blockedIPv4(v4);
  const v6 = parseIPv6(address);
  if (v6) return blockedIPv6(v6);
  return true;
}

function isIpLiteral(hostname: string): boolean {
  return parseIPv4(hostname) !== null || hostname.startsWith('[');
}

/** 驗證使用者給的網址格式；不做 DNS。 */
export function parseExternalUrl(raw: string | undefined): URL {
  if (!raw || raw.length > MAX_URL_LENGTH) throw new HttpError(400, 'invalid_url', '網址格式錯誤。');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'invalid_url', '網址格式錯誤。');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'invalid_url', '只支援 http 與 https 網址。');
  }
  if (url.username || url.password) throw new HttpError(400, 'invalid_url', '網址不可包含帳號密碼。');
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new HttpError(400, 'blocked_url', '只支援預設連接埠的網址。');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    !host ||
    host === 'localhost' ||
    /\.(localhost|local|internal|intranet|lan|home|corp)$/.test(host) ||
    (!isIpLiteral(host) && !host.includes('.'))
  ) {
    throw new HttpError(400, 'blocked_url', '不能讀取內部網路的網址。');
  }
  if (isIpLiteral(host) && isBlockedAddress(host)) {
    throw new HttpError(400, 'blocked_url', '不能讀取內部網路的網址。');
  }
  url.hash = '';
  return url;
}

async function assertPublicHost(url: URL, resolve: Resolver): Promise<void> {
  const host = url.hostname.replace(/\.$/, '');
  if (isIpLiteral(host)) return; // 已在 parseExternalUrl 檢查
  const addresses = await resolve(host);
  if (addresses.some((address) => isBlockedAddress(address))) {
    throw new HttpError(400, 'blocked_url', '不能讀取內部網路的網址。');
  }
}

/** 逐跳檢查並跟隨轉址；回傳最終回應與網址。 */
export async function fetchExternal(
  raw: string | undefined,
  outbound: Outbound,
  method: 'GET' | 'HEAD' = 'GET',
): Promise<{ response: Response; url: URL }> {
  let url = parseExternalUrl(raw);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url, outbound.resolve);
    let response: Response;
    try {
      response = await outbound.fetch(url.toString(), {
        method,
        redirect: 'manual',
        signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: { accept: 'image/*,audio/*,video/*;q=0.9,*/*;q=0.1', 'user-agent': 'HushMediaProxy/1.0' },
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'media_unreachable', '無法連到這個網址。');
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      await response.body?.cancel().catch(() => undefined);
      if (hop === MAX_REDIRECTS) throw new HttpError(502, 'too_many_redirects', '轉址次數過多。');
      url = parseExternalUrl(new URL(response.headers.get('location') as string, url).toString());
      continue;
    }
    return { response, url };
  }
  throw new HttpError(502, 'too_many_redirects', '轉址次數過多。');
}

export interface MediaMeta {
  kind: Extract<PreviewKind, 'image' | 'audio' | 'video'>;
  contentType: string;
  size: number | null;
}

/** 依回應標頭判斷能否當外鏈媒體轉送（只收圖片、音訊、影片；SVG 不收）。 */
export function mediaMeta(response: Response, url: URL): MediaMeta | null {
  const declared = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const name = decodeURIComponent(url.pathname.split('/').pop() || '').slice(0, 200) || 'file';
  // 對方明確宣告非媒體類型（例如 text/html）就不收，不讓副檔名蓋過。
  if (declared && declared !== 'application/octet-stream' && !/^(image|audio|video)\//.test(declared)) return null;
  const info = previewInfo(name, declared);
  if (!info || (info.kind !== 'image' && info.kind !== 'audio' && info.kind !== 'video')) return null;
  const length = response.headers.get('content-length');
  const size = length && /^\d+$/.test(length) ? Number(length) : null;
  return { kind: info.kind, contentType: info.contentType, size };
}

/** 讓串流在超過上限時中止，避免沒有 Content-Length 的回應無限制地傳下去。 */
export function limitStream(body: ReadableStream<Uint8Array>, limit: number): ReadableStream<Uint8Array> {
  let total = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > limit) {
          controller.error(new Error('media_too_large'));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}
