import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import type { SessionPayload } from '../lib/types';
import { AlertIcon, EyeIcon, EyeOffIcon, LockIcon } from '../components/Icons';
import { BrandMark, Button, Field } from '../components/ui';

export function Login({
  setup,
  onSuccess,
}: {
  setup: SessionPayload['setup'];
  onSuccess: (session: SessionPayload) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await api.login(username.trim(), password);
      onSuccess(session);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '無法連線到伺服器，請稍後再試。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-5 py-12">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-52 left-1/2 h-[560px] w-[820px] -translate-x-1/2 rounded-full bg-[#6350f0]/22 blur-[130px]" />
        <div className="absolute -bottom-40 -right-24 h-[420px] w-[420px] rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="absolute inset-0 opacity-[0.16] [background-image:linear-gradient(rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.055)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_72%)]" />
      </div>

      <div className="relative w-full max-w-[408px]">
        <div className="mb-9 flex flex-col items-center text-center">
          <BrandMark size={54} />
          <h1 className="mt-5 text-[30px] font-semibold tracking-[-0.03em] text-white">Hush</h1>
          <p className="mt-2 text-[13.5px] text-white/40">私密羣組 · 內部檔案</p>
        </div>

        <form onSubmit={submit} className="panel p-6 backdrop-blur-2xl sm:p-7">
          <div className="space-y-4">
            <Field
              label="帳號"
              hint="由管理員建立"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="your-name"
              required
            />

            <div className="relative">
              <Field
                label="密碼"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute bottom-0 right-1 flex h-11 w-10 items-center justify-center text-white/35 transition hover:text-white/70"
                aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
              >
                {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
              </button>
            </div>
          </div>

          {error ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-rose-200">
              <AlertIcon size={15} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {!setup.hasAdmin && !setup.adminConfigured ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.08] px-3 py-2.5 text-[12.5px] leading-relaxed text-amber-200">
              <LockIcon size={15} className="mt-0.5 shrink-0" />
              <span>
                尚未建立管理員。請在部署環境設定 <code className="text-amber-100">ADMIN_PASSWORD</code>
                後重新整理；第一次登入會自動建立管理員帳號。
              </span>
            </div>
          ) : null}

          <Button type="submit" className="mt-6 w-full" loading={busy} disabled={!username || !password}>
            進入 Hush
          </Button>
        </form>

        <p className="mt-7 text-center text-[11.5px] text-white/25">
          僅限受邀成員。Hush 不會公開任何內容，也沒有註冊入口。
        </p>
      </div>
    </div>
  );
}