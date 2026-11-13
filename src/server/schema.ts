/**
 * 資料庫結構。
 *
 * 以「一句一語句」的陣列保存，避免在函式裡拆分 SQL 字串；
 * 遷移腳本與自動遷移都共用這份唯一真源。
 */

export const SCHEMA_VERSION = 2;

export const SCHEMA_STATEMENTS: string[] = [
  `create table if not exists schema_migrations (
     version integer primary key,
     applied_at timestamptz not null default now()
   )`,

  `create table if not exists users (
     id uuid primary key,
     username text not null,
     display_name text not null,
     role text not null default 'member',
     password_hash text not null,
     color text not null default '#6d5df6',
     status text not null default 'active',
     created_at timestamptz not null default now(),
     last_seen_at timestamptz,
     constraint users_role_check check (role in ('admin', 'member')),
     constraint users_status_check check (status in ('active', 'disabled'))
   )`,

  `create unique index if not exists users_username_lower_idx on users (lower(username))`,

  `create table if not exists sessions (
     id uuid primary key,
     token_hash text not null unique,
     user_id uuid not null references users(id) on delete cascade,
     user_agent text,
     created_at timestamptz not null default now(),
     expires_at timestamptz not null
   )`,

  `create index if not exists sessions_user_idx on sessions (user_id)`,

  `create table if not exists files (
     id uuid primary key,
     name text not null,
     mime text not null,
     size_bytes bigint not null,
     storage_driver text not null,
     storage_key text not null,
     status text not null default 'pending',
     uploader_id uuid references users(id) on delete set null,
     created_at timestamptz not null default now(),
     deleted_at timestamptz,
     deleted_by uuid,
     constraint files_status_check check (status in ('pending', 'ready'))
   )`,

  `create index if not exists files_created_idx on files (created_at desc)`,

  `create table if not exists messages (
     id bigserial primary key,
     author_id uuid references users(id) on delete set null,
     kind text not null default 'text',
     body text,
     file_id uuid references files(id) on delete set null,
     created_at timestamptz not null default now(),
     deleted_at timestamptz,
     deleted_by uuid,
     constraint messages_kind_check check (kind in ('text', 'file', 'system'))
   )`,

  `create index if not exists messages_created_idx on messages (created_at)`,

  `create table if not exists file_chunks (
     file_id uuid not null references files(id) on delete cascade,
     idx integer not null,
     data_b64 text not null,
     primary key (file_id, idx)
   )`,

  `create table if not exists login_throttle (
     throttle_key text primary key,
     failures integer not null default 0,
     locked_until timestamptz,
     updated_at timestamptz not null default now()
   )`,

  `create table if not exists audit_log (
     id bigserial primary key,
     actor_id uuid,
     actor_name text,
     action text not null,
     target_type text,
     target_id text,
     detail jsonb,
     created_at timestamptz not null default now()
   )`,

  `create index if not exists audit_created_idx on audit_log (created_at desc)`,

  // v2：置頂。單列資料表（id 固定為 1），由資料庫保證同時只有一則置頂。
  `create table if not exists chat_pin (
     id smallint primary key default 1,
     message_id bigint not null references messages(id) on delete cascade,
     pinned_by uuid references users(id) on delete set null,
     pinned_at timestamptz not null default now(),
     constraint chat_pin_single check (id = 1)
   )`,
];

/**
 * 可選語句：失敗不會中斷遷移。
 * pg_trgm 讓中文與英文的關鍵字搜尋（ILIKE '%…%'）能走索引；
 * 若資料庫不允許建立擴充，搜尋仍可用，只是改成循序掃描。
 */
export const OPTIONAL_SCHEMA_STATEMENTS: string[] = [
  `create extension if not exists pg_trgm`,
  `create index if not exists messages_body_trgm_idx on messages using gin (body gin_trgm_ops)`,
  `create index if not exists files_name_trgm_idx on files using gin (name gin_trgm_ops)`,
];

/** 所有查詢共用的時間格式：固定輸出 ISO-8601 UTC，跨驅動結果一致。 */
export const ISO_TIME = (column: string) =>
  `to_char(${column} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;