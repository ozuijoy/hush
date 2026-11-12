/**
 * 稽核紀錄：管理員的每一個管理動作都會留下痕跡。
 */
import type { Sql } from './types';

export interface AuditActor {
  id: string;
  name: string;
}

export async function recordAudit(
  sql: Sql,
  actor: AuditActor | null,
  action: string,
  target?: { type: string; id: string },
  detail?: unknown,
): Promise<void> {
  try {
    await sql.query(
      `insert into audit_log (actor_id, actor_name, action, target_type, target_id, detail)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        actor?.id ?? null,
        actor?.name ?? null,
        action,
        target?.type ?? null,
        target?.id ?? null,
        detail === undefined ? null : JSON.stringify(detail),
      ],
    );
  } catch {
    // 稽核失敗不應阻斷主要操作。
  }
}