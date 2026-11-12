/**
 * 密碼雜湊、session token 與雜湊工具。
 *
 * 全部使用 Web Crypto（`crypto.subtle`），因此同一份程式碼可以跑在
 * Cloudflare Pages Functions、Netlify Functions 與 Node。
 */

/** Cloudflare Workers 的 PBKDF2 迭代次數上限為 100,000，這裡取上限。 */
const PBKDF2_ITERATIONS = 100_000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    key,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** 格式：`pbkdf2-sha256$<iterations>$<salt>$<hash>`（皆為 base64url）。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const derived = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(derived)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  try {
    const salt = fromBase64Url(parts[2]);
    const expected = fromBase64Url(parts[3]);
    const derived = await pbkdf2(password, salt, iterations);
    return constantTimeEqual(toBase64Url(derived), toBase64Url(expected));
  } catch {
    return false;
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const NAME_COLORS = [
  '#6d5df6',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#8b5cf6',
  '#14b8a6',
];

export function pickColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return NAME_COLORS[hash % NAME_COLORS.length];
}