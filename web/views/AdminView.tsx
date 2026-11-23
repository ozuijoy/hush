import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatBytes, formatRelative } from '../lib/format';
import type { AuditEntry, Overview, User } from '../lib/types';
import {
  ArchiveIcon,
  ChatIcon,
  FolderIcon,
  RefreshIcon,
  ShieldIcon,
  UsersIcon,
} from '../components/Icons';
import { Badge, Button, EmptyState, Spinner } from '../components/ui';

const ACTIONS: Record<string, { label: string; tone: 'brand' | 'success' | 'warn' | 'neutral' }> = {
  'message.delete': { label: '移除訊息', tone: 'warn' },
  'file.upload': { label: '上傳檔案', tone: 'success' },
  'file.delete': { label: '移除檔案', tone: 'warn' },
  'member.create': { label: '新增成員', tone: 'brand' },
  'member.update': { label: '更新成員', tone: 'neutral' },
  'member.delete': { label: '移除成員', tone: 'warn' },
  'ai.chat': { label: 'AI 問答', tone: 'neutral' },
  'ai.summarize': { label: 'AI 摘要', tone: 'neutral' },
  'ai.translate': { label: 'AI 翻譯', tone: 'neutral' },
  'ai.polish': { label: 'AI 潤稿', tone: 'neutral' },
};

function detailLabel(entry: AuditEntry): string | null {
  const detail = entry.detail as { name?: string; username?: string; status?: string } | null;
  if (!detail) return null;
  return detail.name ?? detail.username ?? detail.status ?? null;
}

export function AdminView({ user }: { user: User }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextOverview, nextAudit] = await Promise.all([api.overview(), api.audit()]);
      setOverview(nextOverview);
      setEntries(nextAudit.entries);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '無法載入管理資訊。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = overview?.stats;

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="border-b border-white/[0.06] px-4 py-5 lg:px-8">
        <div className="mx-auto flex max-w-4xl items-end justify-between gap-4">
          <div>
            <p className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-white/25">管理</p>
            <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-white">空間狀態</h1>
            <p className="mt-1 text-[12.5px] text-white/40">成員、容量與最近的管理動作。</p>
          </div>
          <Button variant="subtle" onClick={() => void load()} loading={loading}>
            <RefreshIcon size={15} /> 重新整理
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-8">
        <div className="mx-auto max-w-4xl space-y-5">
          {error ? (
            <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-200">
              {error}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: '成員', value: stats ? String(stats.members) : '—', icon: UsersIcon },
              { label: '訊息', value: stats ? String(stats.messages) : '—', icon: ChatIcon },
              { label: '檔案', value: stats ? String(stats.files) : '—', icon: FolderIcon },
              { label: '已用容量', value: stats ? formatBytes(stats.bytes) : '—', icon: ArchiveIcon },
            ].map((stat) => {
              const Icon = stat.icon;
              return (
                <div key={stat.label} className="panel p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[10.5px] uppercase tracking-[0.12em] text-white/30">
                      {stat.label}
                    </p>
                    <Icon size={15} className="text-white/25" />
                  </div>
                  <p className="mt-2 text-[20px] font-semibold tracking-tight text-white/90">
                    {stat.value}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="panel p-5">
              <h2 className="text-[13px] font-semibold text-white/75">儲存與限制</h2>
              <dl className="mt-4 space-y-3 text-[12.5px]">
                {[
                  {
                    term: '儲存方式',
                    value:
                      overview?.config.storageDriver === 's3'
                        ? 'S3 相容物件儲存'
                        : 'Postgres 直存（後備）',
                  },
                  {
                    term: '單檔上限',
                    value: overview ? formatBytes(overview.config.maxUploadBytes) : '—',
                  },
                  { term: '登入有效期限', value: `${overview?.config.sessionDays ?? 30} 天` },
                  { term: '資料庫結構', value: `v${overview?.schemaVersion ?? 1}` },
                  { term: '管理員', value: `@${user.username}` },
                ].map((row) => (
                  <div key={row.term} className="flex items-center justify-between gap-4">
                    <dt className="text-white/35">{row.term}</dt>
                    <dd className="text-right font-medium text-white/70">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="panel flex flex-col justify-between p-5">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldIcon size={16} className="text-[#a99bff]" />
                  <h2 className="text-[13px] font-semibold text-white/75">管理員權限</h2>
                </div>
                <ul className="mt-4 space-y-2.5 text-[12px] leading-relaxed text-white/40">
                  <li>· 移除任何聊天訊息（保留「已移除」墓碑，不留下內容）</li>
                  <li>· 移除檔案並同步刪除物件儲存中的檔案</li>
                  <li>· 新增成員、重設密碼、停用或移除帳號</li>
                  <li>· 所有管理動作都會寫入稽核紀錄</li>
                </ul>
              </div>
              <p className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-white/30">
                全站僅有一個管理員帳號。成員無法自行註冊、無法刪除訊息或檔案。
              </p>
            </div>
          </div>

          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
              <h2 className="text-[13px] font-semibold text-white/75">稽核紀錄</h2>
              {loading ? <Spinner size={14} /> : <Badge tone="neutral">{entries.length} 筆</Badge>}
            </div>
            {entries.length === 0 && !loading ? (
              <EmptyState
                icon={<ShieldIcon size={20} />}
                title="還沒有管理動作"
                description="新增成員、上傳或移除檔案時，這裡會留下紀錄。"
              />
            ) : (
              <ul className="divide-y divide-white/[0.05]">
                {entries.map((entry) => {
                  const action = ACTIONS[entry.action] ?? { label: entry.action, tone: 'neutral' as const };
                  const detail = detailLabel(entry);
                  return (
                    <li key={entry.id} className="flex items-center gap-3 px-5 py-3">
                      <Badge tone={action.tone}>{action.label}</Badge>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-white/45">
                        {entry.actorName ?? '系統'}
                        {detail ? ` · ${detail}` : ''}
                      </span>
                      <span
                        className="shrink-0 text-[11px] text-white/25"
                        title={new Date(entry.createdAt).toLocaleString('zh-TW')}
                      >
                        {formatRelative(entry.createdAt)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}