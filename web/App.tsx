import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './lib/api';
import type { FileItem, SessionPayload, User, View } from './lib/types';
import { AdminView } from './views/AdminView';
import { ChatView } from './views/ChatView';
import { FilesView } from './views/FilesView';
import { Login } from './views/Login';
import { MembersView } from './views/MembersView';
import { MobileBar, MobileDrawer, Sidebar } from './components/Shell';
import { ToastProvider, useToast } from './components/Toast';
import { AlertIcon } from './components/Icons';
import { BrandMark, Button, Field, Modal, Spinner } from './components/ui';

interface FileState {
  files: FileItem[];
  totalBytes: number;
  storageDriver: 's3' | 'pg';
  maxUploadBytes: number;
}

export default function App() {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);

  const boot = useCallback(async () => {
    setBooting(true);
    setBootError(null);
    try {
      setSession(await api.me());
    } catch (caught) {
      setBootError(
        caught instanceof Error ? caught.message : '無法連線到 Hush，請確認網路與部署設定。',
      );
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  if (booting) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-5">
        <BrandMark size={48} />
        <Spinner size={18} />
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6">
        <div className="panel w-full max-w-sm p-6 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-500/10 text-rose-300">
            <AlertIcon size={19} />
          </div>
          <p className="mt-4 text-[15px] font-medium text-white/85">無法啟動 Hush</p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-white/40">{bootError}</p>
          <Button className="mt-5 w-full" onClick={() => void boot()}>
            重試
          </Button>
        </div>
      </div>
    );
  }

  if (!session?.user) {
    return (
      <Login
        setup={session?.setup ?? { hasAdmin: false, adminConfigured: false }}
        onSuccess={setSession}
      />
    );
  }

  return (
    <ToastProvider>
      <Workspace session={session} onSession={setSession} />
    </ToastProvider>
  );
}

function Workspace({
  session,
  onSession,
}: {
  session: SessionPayload;
  onSession: (session: SessionPayload) => void;
}) {
  const user = session.user as User;
  const toast = useToast();
  const [view, setView] = useState<View>('chat');
  const [navOpen, setNavOpen] = useState(false);
  const [members, setMembers] = useState<User[]>([]);
  const [fileState, setFileState] = useState<FileState>({
    files: [],
    totalBytes: 0,
    storageDriver: session.config.storageDriver,
    maxUploadBytes: session.config.maxUploadBytes,
  });
  const [passwordOpen, setPasswordOpen] = useState(false);

  const handleAuthError = useCallback(
    (caught: unknown): boolean => {
      if (caught instanceof ApiError && caught.status === 401) {
        onSession({ ...session, user: null });
        return true;
      }
      return false;
    },
    [onSession, session],
  );

  const refreshFiles = useCallback(async () => {
    try {
      setFileState(await api.files());
    } catch (caught) {
      if (!handleAuthError(caught)) {
        toast(caught instanceof Error ? caught.message : '無法載入檔案。', 'error');
      }
    }
  }, [handleAuthError, toast]);

  const refreshMembers = useCallback(async () => {
    try {
      const response = await api.members();
      setMembers(response.members);
    } catch (caught) {
      if (!handleAuthError(caught)) {
        toast(caught instanceof Error ? caught.message : '無法載入成員。', 'error');
      }
    }
  }, [handleAuthError, toast]);

  useEffect(() => {
    void refreshFiles();
    void refreshMembers();
  }, [refreshFiles, refreshMembers]);

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // 就算登出請求失敗，前端也只保留登入畫面。
    } finally {
      onSession({ ...session, user: null });
    }
  };

  const navigate = (next: View) => {
    setView(next);
    setNavOpen(false);
  };

  const sidebar = (
    <Sidebar
      view={view}
      onChange={navigate}
      user={user}
      memberCount={members.length}
      fileCount={fileState.files.length}
      onLogout={() => void logout()}
      onChangePassword={() => setPasswordOpen(true)}
    />
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-[272px] shrink-0 border-r border-white/[0.06] bg-[#0a0c12]/60 backdrop-blur-2xl lg:block">
        {sidebar}
      </aside>

      <MobileDrawer open={navOpen} onClose={() => setNavOpen(false)}>
        {sidebar}
      </MobileDrawer>

      <main className="flex min-w-0 flex-1 flex-col">
        <MobileBar user={user} onOpen={() => setNavOpen(true)} />

        <div className="min-h-0 flex-1">
          {view === 'chat' ? (
            <ChatView
              user={user}
              members={members}
              aiEnabled={session.config.aiEnabled}
              onUploaded={() => void refreshFiles()}
            />
          ) : null}
          {view === 'files' ? (
            <FilesView
              files={fileState.files}
              totalBytes={fileState.totalBytes}
              storageDriver={fileState.storageDriver}
              maxUploadBytes={fileState.maxUploadBytes}
              user={user}
              onRefresh={refreshFiles}
            />
          ) : null}
          {view === 'members' ? (
            <MembersView members={members} currentUser={user} onRefresh={refreshMembers} />
          ) : null}
          {view === 'admin' && user.role === 'admin' ? <AdminView user={user} /> : null}
        </div>
      </main>

      <PasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}

function PasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setCurrent('');
      setNext('');
      setAgain('');
    }
  }, [open]);

  const mismatch = again.length > 0 && next !== again;
  const canSubmit = current.length > 0 && next.length >= 8 && next === again;

  const submit = async () => {
    setBusy(true);
    try {
      await api.changePassword(current, next);
      toast('密碼已更新，其他裝置的登入已失效。', 'success');
      onClose();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '更新失敗。', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="修改密碼"
      description="更新後，其他裝置上的登入狀態會全部失效。"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button loading={busy} disabled={!canSubmit} onClick={() => void submit()}>
            更新密碼
          </Button>
        </>
      }
    >
      <Field
        label="目前密碼"
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(event) => setCurrent(event.target.value)}
      />
      <Field
        label="新密碼"
        hint="至少 8 個字元"
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={(event) => setNext(event.target.value)}
      />
      <Field
        label="再次輸入新密碼"
        type="password"
        autoComplete="new-password"
        value={again}
        onChange={(event) => setAgain(event.target.value)}
        aria-invalid={mismatch}
      />
      {mismatch ? <p className="text-[11.5px] text-rose-300">兩次輸入的新密碼不一致。</p> : null}
    </Modal>
  );
}