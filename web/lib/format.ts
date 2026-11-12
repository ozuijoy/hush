const dayFormatter = new Intl.DateTimeFormat('zh-TW', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('zh-TW', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const relativeFormatter = new Intl.RelativeTimeFormat('zh-TW', { numeric: 'auto' });

export function formatTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

export function formatDay(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(date, today)) return '今天';
  if (isSameDay(date, yesterday)) return '昨天';
  return dayFormatter.format(date);
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 1) return '剛剛';
  if (Math.abs(minutes) < 60) return relativeFormatter.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeFormatter.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return relativeFormatter.format(-days, 'day');
  return dayFormatter.format(new Date(iso));
}

export function isSameDay(a: Date | string, b: Date | string): boolean {
  const first = new Date(a);
  const second = new Date(b);
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const latin = trimmed.split(/\s+/);
  if (latin.length > 1 && /^[A-Za-z]/.test(trimmed)) {
    return (latin[0][0] + latin[latin.length - 1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export type FileKind = 'image' | 'pdf' | 'doc' | 'sheet' | 'slide' | 'archive' | 'audio' | 'video' | 'code' | 'text' | 'other';

export function fileKind(name: string, mime = ''): FileKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) return 'archive';
  if (['xls', 'xlsx', 'csv', 'ods', 'numbers'].includes(ext)) return 'sheet';
  if (['ppt', 'pptx', 'key', 'odp'].includes(ext)) return 'slide';
  if (['doc', 'docx', 'odt', 'pages', 'rtf'].includes(ext)) return 'doc';
  if (['js', 'ts', 'tsx', 'jsx', 'json', 'css', 'html', 'py', 'go', 'rs', 'java', 'sh', 'sql', 'yml', 'yaml'].includes(ext))
    return 'code';
  if (mime.startsWith('text/') || ['txt', 'md', 'log'].includes(ext)) return 'text';
  return 'other';
}