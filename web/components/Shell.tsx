import { useState } from 'react';
import type { User } from '../lib/types';
import type { View } from '../lib/types';
import {
  ChatIcon,
  ChevronRightIcon,
  FolderIcon,
  KeyIcon,
  LockIcon,
  LogOutIcon,
  MenuIcon,
  ShieldIcon,
  UsersIcon,
  XIcon,
} from './Icons';
import { Avatar, Badge, BrandMark, cx, IconButton } from './ui';

const NAV = [
  { view: 'chat' as const, label: '聊天', icon: ChatIcon },
  { view: 'files' as const, label: '檔案', icon: FolderIcon },
  { view: 'members' as const, label: '成員', icon: UsersIcon },
  { view: 'admin' as const, label: '管理', icon: ShieldIcon, adminOnly: true },
];

export function Sidebar({
  view,
  onChange,
  user,
  memberCount,
  fileCount,
  onLogout,
  onChangePassword,
  className,
}: {
  view: View;
  onChange: (view: View) => void;
  user: User;
  memberCount: number;
  fileCount: number;
  onLogout: () => void;
  onChangePassword: () => void;
  className?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const items = NAV.filter((item) => !item.adminOnly || user.role === 'admin');

  return (
    <div className={cx('flex h-full w-full flex-col', className)}>
      <div className="flex items-center gap-3 px-5 pb-7 pt-6">
        <BrandMark size={38} />
        <div className="min-w-0">
          <p className="text-[16.5px] font-semibold leading-tight tracking-[-0.02em] text-white">Hush</p>
          <p className="truncate text-[11px] text-white/35">私密羣組 · 內部檔案</p>
        </div>
      </div>

      <div className="px-3">
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/25">
          空間
        </p>
        <nav className="space-y-1">
          {items.map((item) => {
            const active = view === item.view;
            const Icon = item.icon;
            const badge =
              item.view === 'files' ? fileCount : item.view === 'members' ? memberCount : null;
            return (
              <button
                key={item.view}
                type="button"
                onClick={() => onChange(item.view)}
                className={cx(
                  'group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] transition-colors',
                  active
                    ? 'bg-white/[0.07] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                    : 'text-white/55 hover:bg-white/[0.04] hover:text-white/85',
                )}
                aria-current={active ? 'page' : undefined}
              >
                <Icon
                  size={17}
                  className={active ? 'text-[#a99bff]' : 'text-white/35 group-hover:text-white/60'}
                />
                <span className="flex-1 text-left">{item.label}</span>
                {badge ? (
                  <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] tabular-nums text-white/40">
                    {badge}
                  </span>
                ) : null}
                {active ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#8b7bff] shadow-[0_0_10px_rgba(139,123,255,0.9)]" />
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="mx-3 mt-5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
        <div className="flex items-center gap-2 text-[11px] font-medium text-white/45">
          <LockIcon size={13} />
          僅限受邀成員
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-white/25">
          {memberCount} 位成員 · {fileCount} 個檔案
        </p>
      </div>

      <div className="mt-auto p-3">
        <div className="relative">
          {menuOpen ? (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden="true" />
              <div className="absolute bottom-full left-0 z-20 mb-2 w-full overflow-hidden rounded-xl border border-white/[0.09] bg-[#12141c] p-1 shadow-2xl">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onChangePassword();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] text-white/70 transition hover:bg-white/[0.06] hover:text-white"
                >
                  <KeyIcon size={15} /> 修改密碼
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onLogout();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] text-white/70 transition hover:bg-rose-500/10 hover:text-rose-200"
                >
                  <LogOutIcon size={15} /> 登出
                </button>
              </div>
            </>
          ) : null}

          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            className="flex w-full items-center gap-2.5 rounded-xl border border-transparent p-2 text-left transition hover:border-white/[0.06] hover:bg-white/[0.04]"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <Avatar name={user.displayName} color={user.color} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-medium text-white/85">{user.displayName}</p>
              <p className="truncate text-[10.5px] text-white/30">@{user.username}</p>
            </div>
            <ChevronRightIcon size={14} className="text-white/25" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function MobileBar({ user, onOpen }: { user: User; onOpen: () => void }) {
  return (
    <header className="flex items-center justify-between border-b border-white/[0.06] bg-[#0a0c12]/70 px-4 py-3 backdrop-blur-xl lg:hidden">
      <IconButton label="開啟選單" onClick={onOpen}>
        <MenuIcon size={18} />
      </IconButton>
      <div className="flex items-center gap-2">
        <BrandMark size={26} />
        <span className="text-[14px] font-semibold tracking-tight">Hush</span>
        {user.role === 'admin' ? <Badge tone="brand">管理員</Badge> : null}
      </div>
      <Avatar name={user.displayName} color={user.color} size={28} />
    </header>
  );
}

export function MobileDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative h-full w-[286px] border-r border-white/[0.07] bg-[#0a0c12] shadow-2xl">
        <div className="absolute right-3 top-3 z-10">
          <IconButton label="關閉選單" onClick={onClose}>
            <XIcon size={16} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}