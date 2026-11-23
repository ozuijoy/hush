/**
 * 執行環境設定。
 *
 * 所有敏感資料都來自環境變數，程式碼裡不保存任何憑證。
 * Cloudflare Pages 由 `context.env` 注入；Netlify 由 `process.env` 注入。
 */

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** MinIO、Supabase Storage 等多數自架服務需要 path-style。 */
  forcePathStyle: boolean;
  /** 物件鍵前綴，方便同一個 bucket 內與其他服務隔離。 */
  prefix: string;
}

/** 外接 AI：任何 OpenAI 相容端點（/chat/completions），不綁定供應商。 */
export interface AiConfig {
  /** 例：https://api.groq.com/openai/v1、http://localhost:11434/v1。 */
  baseUrl: string;
  /** 本機或自架端點可不設。 */
  apiKey: string | null;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  /** 每位成員每小時可用次數。 */
  hourlyLimit: number;
}

export interface Config {
  appName: string;
  databaseUrl: string | null;
  adminUsername: string;
  adminPassword: string | null;
  adminPasswordHash: string | null;
  storageDriver: 's3' | 'pg';
  s3: S3Config | null;
  maxUploadBytes: number;
  autoMigrate: boolean;
  sessionDays: number;
  /** 未設定 AI_BASE_URL 與 AI_MODEL 時為 null，AI 功能整個關閉。 */
  ai: AiConfig | null;
}

export const SESSION_COOKIE = 'hush_session';

/** Postgres 直存模式的單檔上限：Netlify 同步函式請求上限 6 MB，留安全邊界。 */
export const PG_UPLOAD_LIMIT = 4 * 1024 * 1024;

/** 單則訊息長度上限（字元）。 */
export const MAX_BODY_CHARS = 4000;

const MB = 1024 * 1024;

/** 非數字、0 或負數時回到預設值，避免 NaN 讓 session 到期時間變成 Invalid Date。 */
function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return raw && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const bucket = env.S3_BUCKET?.trim();
  const accessKeyId = env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim();
  const endpoint = (env.S3_ENDPOINT?.trim() || 'https://s3.amazonaws.com').replace(/\/+$/, '');

  const s3Ready = Boolean(bucket && accessKeyId && secretAccessKey);
  const requestedDriver = (env.STORAGE_DRIVER || '').toLowerCase();
  const storageDriver: 's3' | 'pg' =
    requestedDriver === 'pg' ? 'pg' : requestedDriver === 's3' ? 's3' : s3Ready ? 's3' : 'pg';

  const requestedMax = Number(env.MAX_UPLOAD_MB ?? 100);
  const maxUploadBytes =
    storageDriver === 'pg'
      ? PG_UPLOAD_LIMIT
      : Number.isFinite(requestedMax) && requestedMax > 0
        ? Math.floor(requestedMax * MB)
        : 100 * MB;

  return {
    appName: env.APP_NAME?.trim() || 'Hush',
    databaseUrl: env.DATABASE_URL?.trim() || null,
    adminUsername: (env.ADMIN_USERNAME?.trim() || 'admin').toLowerCase(),
    adminPassword: env.ADMIN_PASSWORD || null,
    adminPasswordHash: env.ADMIN_PASSWORD_HASH || null,
    storageDriver,
    s3:
      storageDriver === 's3' && s3Ready
        ? {
            endpoint,
            region: env.S3_REGION?.trim() || 'us-east-1',
            bucket: bucket as string,
            accessKeyId: accessKeyId as string,
            secretAccessKey: secretAccessKey as string,
            forcePathStyle: env.S3_FORCE_PATH_STYLE === '1' || env.S3_FORCE_PATH_STYLE === 'true',
            prefix: (env.S3_PREFIX || 'hush/').replace(/^\/+/, ''),
          }
        : null,
    maxUploadBytes,
    autoMigrate: env.AUTO_MIGRATE !== '0' && env.AUTO_MIGRATE !== 'false',
    sessionDays: positiveNumber(env.SESSION_DAYS, 30),
    ai: loadAiConfig(env),
  };
}

function loadAiConfig(env: Record<string, string | undefined>): AiConfig | null {
  const baseUrl = env.AI_BASE_URL?.trim().replace(/\/+$/, '');
  const model = env.AI_MODEL?.trim();
  if (!baseUrl || !model || !/^https?:\/\//i.test(baseUrl)) return null;
  return {
    baseUrl,
    apiKey: env.AI_API_KEY?.trim() || null,
    model,
    timeoutMs: Math.floor(positiveNumber(env.AI_TIMEOUT_SECONDS, 9) * 1000),
    maxTokens: Math.floor(positiveNumber(env.AI_MAX_TOKENS, 1024)),
    hourlyLimit: Math.floor(positiveNumber(env.AI_HOURLY_LIMIT, 30)),
  };
}

/** 給前端用的非敏感設定。 */
export function publicConfig(config: Config) {
  return {
    appName: config.appName,
    storageDriver: config.storageDriver,
    maxUploadBytes: config.maxUploadBytes,
    sessionDays: config.sessionDays,
    aiEnabled: Boolean(config.ai),
  };
}