import {
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { initials } from '../lib/format';
import {
  ArchiveIcon,
  CodeIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  MusicIcon,
  SheetIcon,
  VideoIcon,
  XIcon,
} from './Icons';
import type { FileKind } from '../lib/format';

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'ghost' | 'subtle' | 'danger';
type ButtonSize = 'sm' | 'md';

const variantClass: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-b from-[#8b7bff] to-[#6350f0] text-white shadow-[0_10px_30px_-12px_rgba(124,108,255,0.9)] hover:brightness-110 active:brightness-95',
  ghost: 'text-white/65 hover:bg-white/[0.06] hover:text-white',
  subtle: 'border border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.08] hover:text-white',
  danger: 'bg-rose-500/10 text-rose-300 border border-rose-400/20 hover:bg-rose-500/20 hover:text-rose-200',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cx(
        'btn',
        variantClass[variant],
        size === 'sm' ? 'h-8 gap-1.5 px-3 text-[13px]' : 'h-10 px-4',
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner size={14} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/55 transition hover:bg-white/[0.07] hover:text-white',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode }) {
  const id = useId();
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1.5 flex items-baseline justify-between text-[12px] font-medium text-white/55">
        {label}
        {hint ? <span className="text-[11px] font-normal text-white/30">{hint}</span> : null}
      </span>
      <input id={id} className={cx('field h-11', className)} {...props} />
    </label>
  );
}

export function Avatar({
  name,
  color,
  size = 34,
  className,
}: {
  name: string;
  color: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full border font-semibold',
        size <= 28 ? 'text-[10px]' : 'text-[12px]',
        className,
      )}
      style={{
        width: size,
        height: size,
        color,
        backgroundColor: `${color}1f`,
        borderColor: `${color}40`,
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'brand' | 'success' | 'warn';
}) {
  const tones = {
    neutral: 'border-white/10 bg-white/[0.04] text-white/50',
    brand: 'border-[#7c6cff]/30 bg-[#7c6cff]/12 text-[#b3a8ff]',
    success: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
    warn: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
  } as const;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-white/25 border-t-white/90"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

export function BrandMark({ size = 36 }: { size?: number }) {
  const id = useId();
  return (
    <span
      className="relative inline-flex items-center justify-center rounded-[13px] bg-[#0b0d13] ring-1 ring-white/[0.09]"
      style={{ width: size, height: size }}
    >
      <span className="absolute inset-0 rounded-[13px] bg-gradient-to-br from-[#8b7bff]/25 via-transparent to-transparent" />
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} className="relative">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a99bff" />
            <stop offset="100%" stopColor="#6350f0" />
          </linearGradient>
        </defs>
        <path
          d="M12 3.4c-4.8 0-8.6 3.3-8.6 7.4 0 2.2 1.1 4.1 3 5.5L5.6 20.4l4.1-2.2c.7.2 1.5.3 2.3.3 4.8 0 8.6-3.3 8.6-7.4S16.8 3.4 12 3.4Z"
          fill={`url(#${id})`}
        />
        <circle cx="8.6" cy="10.9" r="1.05" fill="#0b0d13" />
        <circle cx="12" cy="10.9" r="1.05" fill="#0b0d13" />
        <circle cx="15.4" cy="10.9" r="1.05" fill="#0b0d13" />
      </svg>
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-black/65 backdrop-blur-[3px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="reveal relative w-full max-w-[440px] rounded-t-3xl border border-white/[0.09] bg-[#0d0f16] p-6 shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)] sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight text-white">{title}</h2>
            {description ? (
              <p className="mt-1 text-[13px] leading-relaxed text-white/45">{description}</p>
            ) : null}
          </div>
          <IconButton label="關閉" onClick={onClose}>
            <XIcon size={16} />
          </IconButton>
        </div>
        {children ? <div className="mt-5 space-y-4">{children}</div> : null}
        {footer ? <div className="mt-6 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-white/40">
        {icon}
      </div>
      <p className="text-[15px] font-medium text-white/80">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-white/40">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

const fileGlyphs: Record<FileKind, { icon: typeof FileIcon; className: string }> = {
  image: { icon: ImageIcon, className: 'text-sky-300 bg-sky-400/10' },
  pdf: { icon: FileTextIcon, className: 'text-rose-300 bg-rose-400/10' },
  doc: { icon: FileTextIcon, className: 'text-blue-300 bg-blue-400/10' },
  sheet: { icon: SheetIcon, className: 'text-emerald-300 bg-emerald-400/10' },
  slide: { icon: SheetIcon, className: 'text-orange-300 bg-orange-400/10' },
  archive: { icon: ArchiveIcon, className: 'text-amber-300 bg-amber-400/10' },
  audio: { icon: MusicIcon, className: 'text-fuchsia-300 bg-fuchsia-400/10' },
  video: { icon: VideoIcon, className: 'text-violet-300 bg-violet-400/10' },
  code: { icon: CodeIcon, className: 'text-teal-300 bg-teal-400/10' },
  text: { icon: FileTextIcon, className: 'text-slate-300 bg-slate-400/10' },
  other: { icon: FileIcon, className: 'text-white/50 bg-white/[0.06]' },
};

export function FileGlyph({ kind, size = 40 }: { kind: FileKind; size?: number }) {
  const glyph = fileGlyphs[kind] ?? fileGlyphs.other;
  const Icon = glyph.icon;
  return (
    <span
      className={cx('inline-flex shrink-0 items-center justify-center rounded-xl', glyph.className)}
      style={{ width: size, height: size }}
    >
      <Icon size={Math.round(size * 0.46)} />
    </span>
  );
}