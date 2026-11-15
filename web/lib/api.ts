import type {
  AuditEntry,
  FileItem,
  Message,
  MessageContext,
  Overview,
  PinnedMessage,
  SessionPayload,
  User,
} from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(path, { credentials: 'same-origin', ...init, headers });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'request_failed',
      error?.message ?? `請求失敗（HTTP ${response.status}）`,
    );
  }
  return data as T;
}

const body = (value: unknown) => JSON.stringify(value);

export interface PresignResponse {
  fileId: string;
  upload: {
    url: string;
    method: 'PUT';
    headers: Record<string, string>;
    expiresIn: number;
    mode: 's3' | 'pg';
  };
}

export interface FileTarget {
  url: string;
  expiresIn: number;
  mode: 'presigned' | 'proxy';
  inline: boolean;
  preview: 'image' | 'audio' | 'video' | 'pdf' | 'text' | null;
}

export const api = {
  me: () => request<SessionPayload>('/api/auth/me'),
  login: (username: string, password: string) =>
    request<SessionPayload>('/api/auth/login', { method: 'POST', body: body({ username, password }) }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, nextPassword: string) =>
    request<{ ok: true }>('/api/auth/password', {
      method: 'POST',
      body: body({ currentPassword, nextPassword }),
    }),

  messages: (after?: string, limit = 80) =>
    request<{ messages: Message[]; pinned: PinnedMessage | null; lastId: string; serverTime: string }>(
      `/api/messages?limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ''}`,
    ),
  messagesBefore: (before: string, limit = 60) =>
    request<{ messages: Message[]; lastId: string; serverTime: string }>(
      `/api/messages?limit=${limit}&before=${encodeURIComponent(before)}`,
    ),
  sendMessage: (text: string) =>
    request<{ message: Message }>('/api/messages', { method: 'POST', body: body({ body: text }) }),
  deleteMessage: (id: string) => request<{ ok: true; id: string }>(`/api/messages/${id}`, { method: 'DELETE' }),
  pinMessage: (id: string) =>
    request<{ pinned: PinnedMessage | null }>(`/api/messages/${id}/pin`, { method: 'PUT' }),
  unpinMessage: () => request<{ pinned: null }>('/api/messages/pin', { method: 'DELETE' }),
  searchMessages: (query: { q: string; author?: string; filesOnly?: boolean; before?: string }) => {
    const params = new URLSearchParams({ q: query.q });
    if (query.author) params.set('author', query.author);
    if (query.filesOnly) params.set('files', '1');
    if (query.before) params.set('before', query.before);
    return request<{ results: Message[]; hasMore: boolean; nextBefore: string | null }>(
      `/api/messages/search?${params.toString()}`,
    );
  },
  messageContext: (id: string) => request<MessageContext>(`/api/messages/${id}/context`),

  files: () =>
    request<{ files: FileItem[]; totalBytes: number; storageDriver: 's3' | 'pg'; maxUploadBytes: number }>(
      '/api/files',
    ),
  presign: (name: string, size: number, mime: string) =>
    request<PresignResponse>('/api/files/presign', {
      method: 'POST',
      body: body({ name, size, mime }),
    }),
  completeFile: (fileId: string, caption = '') =>
    request<{ file: FileItem; message: Message }>(`/api/files/${fileId}/complete`, {
      method: 'POST',
      body: body({ caption }),
    }),
  fileUrl: (fileId: string) =>
    request<FileTarget>(`/api/files/${fileId}/url`),
  previewUrl: (fileId: string) => request<FileTarget>(`/api/files/${fileId}/url?inline=1`),
  deleteFile: (fileId: string) =>
    request<{ ok: true; id: string }>(`/api/files/${fileId}`, { method: 'DELETE' }),

  members: () => request<{ members: User[] }>('/api/members'),
  addMember: (payload: { username: string; displayName: string; password: string }) =>
    request<{ member: User }>('/api/members', { method: 'POST', body: body(payload) }),
  updateMember: (
    id: string,
    payload: { displayName?: string; password?: string; status?: 'active' | 'disabled' },
  ) => request<{ member: User }>(`/api/members/${id}`, { method: 'PATCH', body: body(payload) }),
  removeMember: (id: string) =>
    request<{ ok: true; id: string }>(`/api/members/${id}`, { method: 'DELETE' }),

  overview: () => request<Overview>('/api/admin/overview'),
  audit: () => request<{ entries: AuditEntry[] }>('/api/admin/audit'),
};

/** 兩段式上傳：先取得預簽名網址，再把檔案直接送到物件儲存。 */
export async function uploadFile(file: File): Promise<{ file: FileItem; message: Message }> {
  const presigned = await api.presign(file.name, file.size, file.type || 'application/octet-stream');

  const response = await fetch(presigned.upload.url, {
    method: 'PUT',
    headers: presigned.upload.headers,
    body: file,
  });
  if (!response.ok) {
    throw new ApiError(
      response.status,
      'upload_failed',
      '檔案上傳失敗。若使用 S3 模式，請確認 bucket 的 CORS 允許 PUT。',
    );
  }
  return api.completeFile(presigned.fileId);
}

/** 取得短效網址後觸發下載。 */
export async function downloadFile(file: FileItem): Promise<void> {
  const target = await api.fileUrl(file.id);
  const anchor = document.createElement('a');
  anchor.href = target.url;
  anchor.download = file.name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
const previewCache = new Map<string, { target: Promise<FileTarget>; expiresAt: number }>();

/**
 * 取得 inline 預覽網址，並在效期內重複使用（聊天室裏同一張圖不用每次重新簽）。
 * `force` 用在圖片/影片載入失敗時重新取得。
 */
export function getPreviewTarget(fileId: string, force = false): Promise<FileTarget> {
  const cached = previewCache.get(fileId);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.target;

  const target = api.previewUrl(fileId);
  const entry = { target, expiresAt: Number.POSITIVE_INFINITY };
  previewCache.set(fileId, entry);
  target.then(
    (value) => {
      // 提前 2 分鐘視為過期；proxy 模式（expiresIn 0）不會過期。
      entry.expiresAt = value.expiresIn > 0 ? Date.now() + (value.expiresIn - 120) * 1000 : Number.POSITIVE_INFINITY;
    },
    () => previewCache.delete(fileId),
  );
  return target;
}

export interface MediaInfo {
  kind: 'image' | 'audio' | 'video' | null;
  size: number | null;
  previewable: boolean;
  reason: 'too_large' | 'not_media' | 'unreachable' | null;
  limit: number;
}

/** 外鏈媒體經 Hush 代抓的網址：瀏覽器只連到自己的網站。 */
export function mediaProxyUrl(url: string): string {
  return `/api/media?url=${encodeURIComponent(url)}`;
}

const mediaInfoCache = new Map<string, Promise<MediaInfo | null>>();

/** 查詢外鏈是否為可預覽的媒體；同一個網址只查一次，失敗視為不可預覽。 */
export function getMediaInfo(url: string): Promise<MediaInfo | null> {
  let cached = mediaInfoCache.get(url);
  if (!cached) {
    cached = request<MediaInfo>(`/api/media/info?url=${encodeURIComponent(url)}`).catch(() => null);
    mediaInfoCache.set(url, cached);
  }
  return cached;
}
