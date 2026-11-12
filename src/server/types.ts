/**
 * 與執行環境無關的型別定義。
 */

export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export type Role = 'admin' | 'member';

export interface UserRow {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  status: 'active' | 'disabled';
  color: string;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface SessionUser extends UserRow {
  sessionId: string;
}