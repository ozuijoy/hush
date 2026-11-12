import { useState } from 'react';
import { api } from '../lib/api';
import { formatRelative } from '../lib/format';
import type { User } from '../lib/types';
import { KeyIcon, PlusIcon, TrashIcon, UsersIcon } from '../components/Icons';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  Spinner,
} from '../components/ui';
import { useToast } from '../components/Toast';

function suggestPassword(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export function MembersView({
  members,
  currentUser,
  onRefresh,
}: {
  members: User[];
  currentUser: User;
  onRefresh: () => Promise<void>;
}) {
  const isAdmin = currentUser.role === 'admin';
  const toast = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ displayName: '', username: '', password: suggestPassword() });
  const [busy, setBusy] = useState(false);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [removeTarget, setRemoveTarget] = useState<User | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const openAdd = () => {
    setForm({ displayName: '', username: '', password: suggestPassword() });
    setAddOpen(true);
  };

  const submitAdd = async () => {
    setBusy(true);
    try {
      await api.addMember({
        displayName: form.displayName.trim(),
        username: form.username.trim(),
        password: form.password,
      });
      toast(`已建立 ${form.displayName.trim()} 的帳號。`, 'success');
      setAddOpen(false);
      await onRefresh();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '建立失敗。', 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async () => {
    if (!resetTarget) return;
    setBusy(true);
    try {
      await api.updateMember(resetTarget.id, { password: resetPassword });
      toast('密碼已重設，該成員需要重新登入。', 'success');
      setResetTarget(null);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '重設失敗。', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (member: User) => {
    setRowBusy(member.id);
    try {
      const next = member.status === 'active' ? 'disabled' : 'active';
      await api.updateMember(member.id, { status: next });
      toast(next === 'disabled' ? '已停用這個帳號。' : '已重新啟用帳號。', 'success');
      await onRefresh();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '更新失敗。', 'error');
    } finally {
      setRowBusy(null);
    }
  };

  const submitRemove = async () => {
    if (!removeTarget) return;
    setBusy(true);
    try {
      await api.removeMember(removeTarget.id);
      toast('成員已移除。', 'success');
      setRemoveTarget(null);
      await onRefresh();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '移除失敗。', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="border-b border-white/[0.06] px-4 py-5 lg:px-8">
        <div className="mx-auto flex max-w-4xl items-end justify-between gap-4">
          <div>
            <p className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-white/25">成員</p>
            <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-white">這個圈子</h1>
            <p className="mt-1 text-[12.5px] text-white/40">
              {isAdmin ? '由你邀請成員，沒有人可以自行註冊。' : '只有管理員可以新增或移除成員。'}
            </p>
          </div>
          {isAdmin ? (
            <Button onClick={openAdd}>
              <PlusIcon size={16} /> 新增成員
            </Button>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          {members.length === 0 ? (
            <div className="panel">
              <EmptyState icon={<UsersIcon size={20} />} title="還沒有成員" />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {members.map((member) => (
                <div key={member.id} className="panel p-4">
                  <div className="flex items-start gap-3">
                    <Avatar name={member.displayName} color={member.color} size={42} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[14px] font-medium text-white/90">
                          {member.displayName}
                          {member.id === currentUser.id ? (
                            <span className="ml-1 text-[11px] text-white/30">（你）</span>
                          ) : null}
                        </p>
                        {member.role === 'admin' ? <Badge tone="brand">管理員</Badge> : null}
                        {member.status === 'disabled' ? <Badge tone="warn">已停用</Badge> : null}
                      </div>
                      <p className="text-[11.5px] text-white/35">@{member.username}</p>
                      <p className="mt-1 text-[11px] text-white/25">
                        {member.lastSeenAt
                          ? `最後上線 ${formatRelative(member.lastSeenAt)}`
                          : '尚未登入過'}
                      </p>
                    </div>
                  </div>

                  {isAdmin && member.role === 'member' ? (
                    <div className="mt-3 flex items-center gap-1 border-t border-white/[0.06] pt-3">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setResetTarget(member);
                          setResetPassword(suggestPassword());
                        }}
                      >
                        <KeyIcon size={14} /> 重設密碼
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void toggleStatus(member)}
                        disabled={rowBusy === member.id}
                      >
                        {rowBusy === member.id ? (
                          <Spinner size={13} />
                        ) : member.status === 'active' ? (
                          '停用'
                        ) : (
                          '啟用'
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto text-rose-300/80 hover:bg-rose-500/10 hover:text-rose-200"
                        onClick={() => setRemoveTarget(member)}
                      >
                        <TrashIcon size={14} /> 移除
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 rounded-2xl border border-white/[0.06] bg-white/[0.015] p-4">
            <p className="text-[12px] font-medium text-white/55">關於帳號</p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-white/30">
              成員帳號由管理員建立，沒有公開註冊、沒有第三方登入。忘記密碼時由管理員重設；重設後舊的
              session 會立即失效。管理員自己的密碼請從左下角選單修改。
            </p>
          </div>
        </div>
      </div>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="新增成員"
        description="建立一組帳號密碼，交給對方即可登入。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              取消
            </Button>
            <Button
              loading={busy}
              disabled={!form.displayName.trim() || !form.username.trim() || form.password.length < 8}
              onClick={() => void submitAdd()}
            >
              建立帳號
            </Button>
          </>
        }
      >
        <Field
          label="顯示名稱"
          value={form.displayName}
          onChange={(event) => setForm({ ...form, displayName: event.target.value })}
          placeholder="例如：小艾"
          maxLength={40}
        />
        <Field
          label="帳號"
          hint="小寫英數字"
          value={form.username}
          onChange={(event) => setForm({ ...form, username: event.target.value.toLowerCase() })}
          placeholder="alice"
          autoCapitalize="none"
          spellCheck={false}
        />
        <Field
          label="初始密碼"
          hint="至少 8 個字元"
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
          className="font-mono text-[13px]"
        />
        <button
          type="button"
          onClick={() => setForm({ ...form, password: suggestPassword() })}
          className="text-[11.5px] text-[#a99bff] transition hover:text-[#c4bbff]"
        >
          重新產生一組隨機密碼
        </button>
      </Modal>

      <Modal
        open={Boolean(resetTarget)}
        onClose={() => setResetTarget(null)}
        title={`重設 ${resetTarget?.displayName ?? ''} 的密碼`}
        description="舊密碼與所有登入狀態會立即失效。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetTarget(null)}>
              取消
            </Button>
            <Button loading={busy} disabled={resetPassword.length < 8} onClick={() => void submitReset()}>
              重設密碼
            </Button>
          </>
        }
      >
        <Field
          label="新密碼"
          value={resetPassword}
          onChange={(event) => setResetPassword(event.target.value)}
          className="font-mono text-[13px]"
        />
        <button
          type="button"
          onClick={() => setResetPassword(suggestPassword())}
          className="text-[11.5px] text-[#a99bff] transition hover:text-[#c4bbff]"
        >
          重新產生一組隨機密碼
        </button>
      </Modal>

      <Modal
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        title="移除成員？"
        description={`「${removeTarget?.displayName ?? ''}」將無法再登入，這個動作無法復原。`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
              取消
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void submitRemove()}>
              移除成員
            </Button>
          </>
        }
      />
    </section>
  );
}