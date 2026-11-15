import { useEffect, useRef, useState, type ReactNode } from 'react';
import { previewInfo } from '../../src/shared/preview';
import { getPreviewTarget, type FileTarget } from '../lib/api';
import { fileKind, formatBytes } from '../lib/format';
import { DownloadIcon, XIcon } from './Icons';
import { Button, FileGlyph, IconButton, Spinner } from './ui';

export interface PreviewableFile {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export function canPreview(file: { name: string; mime: string; size: number; deleted?: boolean }): boolean {
  return !file.deleted && previewInfo(file.name, file.mime, file.size) !== null;
}

/** 只在元素進入畫面附近時才取得網址，避免一打開聊天室就替每張圖簽名。 */
function useVisible<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || visible) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  return [ref, visible];
}

/** 取得預覽網址；`retry()` 會強制重新簽名（網址過期或載入失敗時）。 */
function usePreviewTarget(fileId: string | null, enabled = true) {
  const [state, setState] = useState<{ fileId: string; target: FileTarget } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!fileId || !enabled) return;
    let cancelled = false;
    setError(null);
    getPreviewTarget(fileId, attempt > 0).then(
      (value) => !cancelled && setState({ fileId, target: value }),
      (caught: unknown) => !cancelled && setError(caught instanceof Error ? caught.message : '無法取得預覽。'),
    );
    return () => {
      cancelled = true;
    };
  }, [fileId, enabled, attempt]);

  // 只回傳屬於目前這個檔案的網址，避免切換檔案時短暫顯示上一個。
  const target = state && state.fileId === fileId ? state.target : null;
  return { target, error, retry: () => setAttempt((count) => count + 1), attempt };
}

/** 聊天室內的圖片縮圖。載入失敗會重簽一次，仍失敗就交回檔案卡片。 */
export function ImageThumb({ file, onOpen }: { file: PreviewableFile; onOpen: () => void }) {
  const [ref, visible] = useVisible<HTMLButtonElement>();
  const { target, error, retry, attempt } = usePreviewTarget(file.id, visible);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (failed || error) return null;

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      className="relative block overflow-hidden rounded-2xl border border-white/[0.08] bg-[#151824]"
      style={loaded ? undefined : { width: 240, height: 160 }}
      aria-label={`預覽 ${file.name}`}
    >
      {!loaded ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner size={18} />
        </span>
      ) : null}
      {target ? (
        <img
          src={target.url}
          alt={file.name}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => (attempt === 0 ? retry() : setFailed(true))}
          className={loaded ? 'block max-h-[320px] max-w-[min(280px,70vw)] object-contain' : 'opacity-0'}
        />
      ) : null}
    </button>
  );
}

/** 聊天室內的音訊播放器。 */
export function AudioInline({ file }: { file: PreviewableFile }) {
  const [ref, visible] = useVisible<HTMLDivElement>();
  const { target, error, retry, attempt } = usePreviewTarget(file.id, visible);
  return (
    <div ref={ref} className="w-[280px] max-w-full">
      {target && !error ? (
        <audio
          controls
          preload="metadata"
          src={target.url}
          onError={() => attempt === 0 && retry()}
          className="h-9 w-full"
        />
      ) : null}
    </div>
  );
}

function TextBody({ target }: { target: FileTarget }) {
  const [text, setText] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(target.url, { credentials: target.mode === 'proxy' ? 'same-origin' : 'omit' })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.text();
      })
      .then(
        (value) => !cancelled && setText(value),
        // 物件儲存沒開 GET 的 CORS 時讀不到內容，改用 iframe 直接顯示。
        () => !cancelled && setFallback(true),
      );
    return () => {
      cancelled = true;
    };
  }, [target]);

  if (fallback) {
    return <iframe title="文字預覽" src={target.url} className="h-[75vh] w-full rounded-xl bg-white" />;
  }
  if (text === null) return <Spinner size={22} />;
  return (
    <pre className="max-h-[75vh] w-full overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/[0.06] bg-[#0b0d13] p-4 text-left font-mono text-[12.5px] leading-relaxed text-white/80">
      {text}
    </pre>
  );
}

function PdfBody({ target }: { target: FileTarget }) {
  const [src, setSrc] = useState<string | null>(target.mode === 'presigned' ? target.url : null);
  useEffect(() => {
    if (target.mode === 'presigned') return;
    // 同源 proxy 回應帶 X-Frame-Options，改成 blob 網址再放進 iframe。
    let url: string | null = null;
    let cancelled = false;
    fetch(target.url, { credentials: 'same-origin' })
      .then((response) => response.blob())
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [target]);
  if (!src) return <Spinner size={22} />;
  return <iframe title="PDF 預覽" src={src} className="h-[78vh] w-full rounded-xl bg-white" />;
}

/** 全螢幕預覽：圖片、影片、音訊、PDF、文字。 */
export function FilePreview({
  file,
  onClose,
  onDownload,
}: {
  file: PreviewableFile | null;
  onClose: () => void;
  onDownload: (file: PreviewableFile) => void;
}) {
  const { target, error, retry, attempt } = usePreviewTarget(file?.id ?? null);
  const [mediaError, setMediaError] = useState(false);
  const kind = file ? previewInfo(file.name, file.mime, file.size)?.kind ?? null : null;

  useEffect(() => {
    setMediaError(false);
  }, [file?.id]);

  useEffect(() => {
    if (!file) return;
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
  }, [file, onClose]);

  if (!file) return null;

  const onMediaError = () => (attempt === 0 ? retry() : setMediaError(true));
  const current = target;

  let body: ReactNode = <Spinner size={22} />;
  if (error || mediaError || !kind || (current && !current.inline)) {
    body = (
      <div className="flex flex-col items-center gap-3 text-center">
        <FileGlyph kind={fileKind(file.name, file.mime)} size={56} />
        <p className="text-[13px] text-white/55">{error ?? '這個檔案無法在瀏覽器內預覽。'}</p>
        <Button onClick={() => onDownload(file)}>
          <DownloadIcon size={16} /> 下載檔案
        </Button>
      </div>
    );
  } else if (current) {
    if (kind === 'image') {
      body = (
        <img
          src={current.url}
          alt={file.name}
          onError={onMediaError}
          className="max-h-[80vh] max-w-full rounded-lg object-contain"
        />
      );
    } else if (kind === 'video') {
      body = (
        <video
          src={current.url}
          controls
          autoPlay
          playsInline
          onError={onMediaError}
          className="max-h-[80vh] max-w-full rounded-lg bg-black"
        />
      );
    } else if (kind === 'audio') {
      body = (
        <div className="flex w-full max-w-md flex-col items-center gap-5">
          <FileGlyph kind="audio" size={72} />
          <audio src={current.url} controls autoPlay onError={onMediaError} className="w-full" />
        </div>
      );
    } else if (kind === 'pdf') {
      body = <PdfBody target={current} />;
    } else {
      body = <TextBody target={current} />;
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={file.name}>
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        <FileGlyph kind={fileKind(file.name, file.mime)} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium text-white/90">{file.name}</p>
          <p className="text-[11px] text-white/40">{formatBytes(file.size)}</p>
        </div>
        <IconButton label="下載" onClick={() => onDownload(file)}>
          <DownloadIcon size={17} />
        </IconButton>
        <IconButton label="關閉預覽" onClick={onClose}>
          <XIcon size={18} />
        </IconButton>
      </div>
      <div
        className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4 sm:p-8"
        onClick={(event) => event.target === event.currentTarget && onClose()}
      >
        {body}
      </div>
    </div>
  );
}
