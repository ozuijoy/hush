/**
 * 檔案能否在瀏覽器內預覽，以及預覽時要用的 Content-Type。
 *
 * 前後端共用：後端用它決定能不能回傳 `inline`，前端用它決定要不要顯示預覽。
 * 只放「瀏覽器直接顯示也不會執行腳本」的類型；SVG、HTML 等即使能顯示也一律當附件下載，
 * 因為 Postgres 直存模式下檔案與網站同源，inline 的 HTML/SVG 等於讓上傳者在站內執行腳本。
 */

export type PreviewKind = 'image' | 'audio' | 'video' | 'pdf' | 'text';

const IMAGE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

const AUDIO: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  weba: 'audio/webm',
};

const VIDEO: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
};

const TEXT_EXT = new Set([
  'txt', 'md', 'log', 'csv', 'tsv', 'json', 'yml', 'yaml', 'xml', 'ini', 'conf', 'toml', 'env',
  'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'htm', 'py', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp',
  'cs', 'rb', 'php', 'sh', 'sql', 'svg', 'srt', 'vtt',
]);

const IMAGE_MIMES = new Set(Object.values(IMAGE).concat(['image/jpg', 'image/pjpeg', 'image/vnd.microsoft.icon']));

/** 文字預覽的大小上限：太大的純文字直接下載比較實際。 */
export const TEXT_PREVIEW_LIMIT = 2 * 1024 * 1024;

export interface PreviewInfo {
  kind: PreviewKind;
  /** 預覽時回傳給瀏覽器的 Content-Type（一律從白名單產生，不直接沿用上傳者宣告的值）。 */
  contentType: string;
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function previewInfo(name: string, mime: string, size?: number): PreviewInfo | null {
  const ext = extOf(name);
  const type = (mime || '').split(';')[0].trim().toLowerCase();

  if (IMAGE_MIMES.has(type)) return { kind: 'image', contentType: type === 'image/jpg' || type === 'image/pjpeg' ? 'image/jpeg' : type };
  if (IMAGE[ext] && (type === '' || type === 'application/octet-stream' || type.startsWith('image/')) && type !== 'image/svg+xml')
    return { kind: 'image', contentType: IMAGE[ext] };

  if (type.startsWith('audio/') && /^audio\/[a-z0-9.+-]+$/.test(type)) return { kind: 'audio', contentType: type };
  if (AUDIO[ext]) return { kind: 'audio', contentType: AUDIO[ext] };

  if (type.startsWith('video/') && /^video\/[a-z0-9.+-]+$/.test(type)) return { kind: 'video', contentType: type };
  if (VIDEO[ext]) return { kind: 'video', contentType: VIDEO[ext] };

  if (type === 'application/pdf' || ext === 'pdf') return { kind: 'pdf', contentType: 'application/pdf' };

  // 文字一律以 text/plain 顯示：HTML、SVG 也只看原始碼，不會被瀏覽器渲染或執行。
  if (TEXT_EXT.has(ext) || type.startsWith('text/') || type === 'application/json') {
    if (size !== undefined && size > TEXT_PREVIEW_LIMIT) return null;
    return { kind: 'text', contentType: 'text/plain; charset=utf-8' };
  }
  return null;
}
