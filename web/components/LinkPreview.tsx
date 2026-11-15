import { useEffect, useState } from 'react';
import { getMediaInfo, mediaProxyUrl, type MediaInfo } from '../lib/api';
import { extractLinks, splitLinks } from '../lib/links';
import { XIcon } from './Icons';
import { useVisible } from './FilePreview';
import { IconButton, Spinner } from './ui';

/** 訊息內文：網址變成可點的連結（新分頁開啟、不送 Referer）。 */
export function MessageText({ body, own }: { body: string; own?: boolean }) {
  const parts = splitLinks(body);
  return (
    <>
      {parts.map((part, index) =>
        part.type === 'text' ? (
          <span key={index}>{part.value}</span>
        ) : (
          <a
            key={index}
            href={part.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            referrerPolicy="no-referrer"
            className={own ? 'break-all underline decoration-white/50 underline-offset-2 hover:decoration-white' : 'break-all text-[#a99bff] underline decoration-[#a99bff]/40 underline-offset-2 hover:decoration-[#a99bff]'}
          >
            {part.url}
          </a>
        ),
      )}
    </>
  );
}

function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="absolute right-3 top-3">
        <IconButton label="關閉預覽" onClick={onClose}>
          <XIcon size={18} />
        </IconButton>
      </div>
      <img src={src} alt={alt} className="max-h-[88vh] max-w-full rounded-lg object-contain" />
    </div>
  );
}

/** 單一外鏈：經後端代抓；不是媒體、超過 6 MB 或載入失敗時什麼都不顯示（連結本身仍在內文裡）。 */
function LinkMedia({ url }: { url: string }) {
  const [ref, visible] = useVisible<HTMLDivElement>();
  const [info, setInfo] = useState<MediaInfo | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    getMediaInfo(url).then((value) => !cancelled && setInfo(value));
    return () => {
      cancelled = true;
    };
  }, [url, visible]);

  if (failed || info === null || (info && (!info.previewable || !info.kind))) return null;
  const src = mediaProxyUrl(url);

  return (
    <div ref={ref} className="max-w-full">
      {info === undefined ? (
        visible ? <span className="inline-flex h-8 items-center px-1"><Spinner size={14} /></span> : <span className="block h-1" />
      ) : info.kind === 'image' ? (
        <>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="relative block overflow-hidden rounded-2xl border border-white/[0.08] bg-[#151824]"
            style={loaded ? undefined : { width: 240, height: 160 }}
            aria-label="放大圖片"
          >
            {!loaded ? (
              <span className="absolute inset-0 flex items-center justify-center">
                <Spinner size={18} />
              </span>
            ) : null}
            <img
              src={src}
              alt=""
              loading="lazy"
              decoding="async"
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
              className={loaded ? 'block max-h-[320px] max-w-[min(280px,70vw)] object-contain' : 'opacity-0'}
            />
          </button>
          {open ? <ImageLightbox src={src} alt={url} onClose={() => setOpen(false)} /> : null}
        </>
      ) : info.kind === 'audio' ? (
        <audio controls preload="metadata" src={src} onError={() => setFailed(true)} className="h-9 w-[280px] max-w-full" />
      ) : (
        <video
          controls
          playsInline
          preload="metadata"
          src={src}
          onError={() => setFailed(true)}
          className="max-h-[320px] w-[320px] max-w-[70vw] rounded-2xl bg-black"
        />
      )}
    </div>
  );
}

/** 訊息裡的外鏈媒體預覽（每則最多 3 個）。 */
export function LinkMediaList({ body }: { body: string | null | undefined }) {
  if (!body) return null;
  const urls = extractLinks(body, 3);
  if (urls.length === 0) return null;
  return (
    <>
      {urls.map((url) => (
        <LinkMedia key={url} url={url} />
      ))}
    </>
  );
}
