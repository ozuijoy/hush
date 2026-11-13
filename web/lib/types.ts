export type Role = 'admin' | 'member';

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  status: 'active' | 'disabled';
  color: string;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface FileItem {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
  uploader: { id: string; name: string; color: string } | null;
}

export interface Message {
  id: string;
  kind: 'text' | 'file' | 'system' | 'deleted';
  body: string | null;
  deleted: boolean;
  createdAt: string;
  author: { id: string; name: string; color: string } | null;
  file: { id: string; name: string; mime: string; size: number; deleted: boolean } | null;
  pending?: boolean;
}

export interface PinnedMessage {
  message: Message;
  pinnedAt: string;
  pinnedBy: string | null;
}

export interface MessageContext {
  messages: Message[];
  targetId: string;
  hasOlder: boolean;
  hasNewer: boolean;
}

export interface AppConfig {
  appName: string;
  storageDriver: 's3' | 'pg';
  maxUploadBytes: number;
  sessionDays: number;
}

export interface SessionPayload {
  user: User | null;
  config: AppConfig;
  setup: { hasAdmin: boolean; adminConfigured: boolean };
}

export interface AuditEntry {
  id: string;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: unknown;
  createdAt: string;
}

export interface Overview {
  stats: { members: number; messages: number; files: number; bytes: number; sessions: number };
  config: AppConfig;
  schemaVersion: number;
}
export type View = 'chat' | 'files' | 'members' | 'admin';
