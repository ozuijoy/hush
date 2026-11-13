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
    request<{ url: string; expiresIn: number; mode: 'presigned' | 'proxy' }>(`/api/files/${fileId}/url`),
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