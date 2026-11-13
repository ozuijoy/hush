import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { formatDay, formatTime } from '../lib/format';
import type { Message, MessageContext, User } from '../lib/types';
import { ChevronRightIcon, PaperclipIcon, SearchIcon, XIcon } from '../components/Icons';
import { Avatar, IconButton, Spinner, cx } from '../components/ui';

/** 把關鍵字標出來；只取命中位置前後一段，長訊息也能一眼看到重點。 */
function highlight(text: string, query: string, radius = 48): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const index = lower.indexOf(q.toLowerCase());
  if (index < 0) return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text;

  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + q.length + radius);
  const snippet = text.slice(start, end);
  const parts: ReactNode[] = [];
  const snippetLower = snippet.toLowerCase();
  let cursor = 0;
  let found = snippetLower.indexOf(q.toLowerCase(), cursor);
  while (found >= 0) {
    if (found > cursor) parts.push(snippet.slice(cursor, found));
    parts.push(
      <mark key={found} className="rounded bg-[#7c6cff]/35 px-0.5 text-white">
        {snippet.slice(found, found + q.length)}
      </mark>,
    );
    cursor = found + q.length;
    found = snippetLower.indexOf(q.toLowerCase(), cursor);
  }
  if (cursor < snippet.length) parts.push(snippet.slice(cursor));
  return (
    <>
      {start > 0 ? '…' : ''}
      {parts}
      {end < text.length ? '…' : ''}
    </>
  );
}

function MessageLine({
  message,
  query,
  active,
  onClick,
}: {
  message: Message;
  query: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cx(
        'flex w-full gap-2.5 rounded-xl px-2.5 py-2 text-left transition',
        onClick && 'hover:bg-white/[0.05]',
        active && 'bg-[#7c6cff]/12 ring-1 ring-[#7c6cff]/40',
      )}
    >
      <Avatar name={message.author?.name ?? '?'} color={message.author?.color ?? '#6d5df6'} size={26} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[12.5px] font-medium text-white/75">
            {message.author?.name ?? '已移除的成員'}
          </span>
          <span className="shrink-0 text-[10.5px] tabular-nums text-white/30">
            {formatDay(message.createdAt)} {formatTime(message.createdAt)}
          </span>
        </span>
        {message.kind === 'deleted' ? (
          <span className="block text-[12.5px] italic text-white/30">此訊息已由管理員移除</span>
        ) : (
          <>
            {message.body ? (
              <span className="block whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/80">
                {highlight(message.body, query)}
              </span>
            ) : null}
            {message.file ? (
              <span className="mt-0.5 flex items-center gap-1 text-[12px] text-white/50">
                <PaperclipIcon size={12} />
                <span className="truncate">{highlight(message.file.name, query)}</span>
              </span>
            ) : null}
          </>
        )}
      </span>
      {onClick ? <ChevronRightIcon size={14} className="mt-1 shrink-0 text-white/20" /> : null}
    </Tag>
  );
}

/**
 * 搜尋面板：關鍵字（內文與檔名）、發言人、只看檔案。
 * 點結果時先交給聊天室處理（訊息已載入就直接捲過去）；
 * 沒載入的舊訊息則在面板裡顯示前後文。
 */
export function SearchPanel({
  open,
  members,
  contextId,
  onClose,
  onSelect,
}: {
  open: boolean;
  members: User[];
  /** 直接以前後文模式開啟（例如點置頂訊息、但它不在目前畫面中）。 */
  contextId: string | null;
  onClose: () => void;
  /** 回傳 true 代表聊天室已經捲到該訊息，面板會關閉。 */
  onSelect: (id: string) => boolean;
}) {
  const [query, setQuery] = useState('');
  const [author, setAuthor] = useState('');
  const [filesOnly, setFilesOnly] = useState(false);
  const [results, setResults] = useState<Message[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<MessageContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (open && !contextId) window.setTimeout(() => input.current?.focus(), 0);
  }, [open, contextId]);

  useEffect(() => {
    if (open && contextId) void showContext(contextId);
    if (!open) setContext(null);
  }, [open, contextId]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setNextBefore(null);
      setError(null);
      return;
    }
    const id = ++requestId.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await api.searchMessages({ q, author: author || undefined, filesOnly });
        if (id !== requestId.current) return;
        setResults(response.results);
        setNextBefore(response.nextBefore);
        setError(null);
      } catch (caught) {
        if (id === requestId.current) setError(caught instanceof Error ? caught.message : '搜尋失敗。');
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, query, author, filesOnly]);

  const loadMore = async () => {
    if (!nextBefore) return;
    setLoading(true);
    try {
      const response = await api.searchMessages({
        q: query.trim(),
        author: author || undefined,
        filesOnly,
        before: nextBefore,
      });
      setResults((previous) => [...previous, ...response.results]);
      setNextBefore(response.nextBefore);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '搜尋失敗。');
    } finally {
      setLoading(false);
    }
  };

  async function showContext(id: string) {
    setContextLoading(true);
    try {
      setContext(await api.messageContext(id));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '無法載入前後文。');
    } finally {
      setContextLoading(false);
    }
  }

  const select = (id: string) => {
    if (onSelect(id)) {
      onClose();
      return;
    }
    void showContext(id);
  };

  useEffect(() => {
    if (!context) return;
    document.getElementById(`ctx-${context.targetId}`)?.scrollIntoView({ block: 'center' });
  }, [context]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-start sm:p-6 sm:pt-[8vh]">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-[3px]" onClick={onClose} aria-hidden="true" />
      <div
        className="reveal relative flex max-h-full w-full max-w-[560px] flex-col border border-white/[0.09] bg-[#0d0f16] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)] sm:max-h-[78vh] sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="搜尋訊息"
      >
        <div className="flex items-center gap-2 border-b border-white/[0.06] p-3">
          <SearchIcon size={17} className="ml-1 shrink-0 text-white/35" />
          <input
            ref={input}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setContext(null);
            }}
            placeholder="搜尋訊息或檔名…"
            maxLength={100}
            className="h-9 min-w-0 flex-1 bg-transparent text-[14.5px] text-white placeholder:text-white/25 focus:outline-none"
          />
          {loading || contextLoading ? <Spinner size={14} /> : null}
          <IconButton label="關閉" onClick={onClose}>
            <XIcon size={16} />
          </IconButton>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-3 py-2 text-[12px]">
          <select
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            className="h-7 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-white/70 focus:outline-none"
            aria-label="發言人"
          >
            <option value="">所有人</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-1.5 text-white/55">
            <input
              type="checkbox"
              checked={filesOnly}
              onChange={(event) => setFilesOnly(event.target.checked)}
              className="accent-[#7c6cff]"
            />
            只看檔案
          </label>
          {context ? (
            <button
              type="button"
              onClick={() => setContext(null)}
              className="ml-auto rounded-lg px-2 py-1 text-white/50 transition hover:bg-white/[0.06] hover:text-white/80"
            >
              ← 回到搜尋結果
            </button>
          ) : null}
        </div>

        <div className="min-h-[200px] flex-1 overflow-y-auto overscroll-contain p-2">
          {error ? <p className="px-2 py-3 text-[12.5px] text-rose-300">{error}</p> : null}

          {context ? (
            <div className="space-y-0.5">
              {context.hasOlder ? (
                <p className="px-2 py-1 text-center text-[11px] text-white/25">更早的訊息請往聊天室上方載入</p>
              ) : null}
              {context.messages.map((message) => (
                <div key={message.id} id={`ctx-${message.id}`}>
                  <MessageLine message={message} query={query} active={message.id === context.targetId} />
                </div>
              ))}
            </div>
          ) : !query.trim() ? (
            <p className="px-2 py-8 text-center text-[12.5px] text-white/30">
              輸入關鍵字，搜尋訊息內文與檔名。
            </p>
          ) : !loading && !results.length && !error ? (
            <p className="px-2 py-8 text-center text-[12.5px] text-white/30">沒有符合的訊息。</p>
          ) : (
            <div className="space-y-0.5">
              {results.map((message) => (
                <MessageLine key={message.id} message={message} query={query} onClick={() => select(message.id)} />
              ))}
              {nextBefore ? (
                <div className="flex justify-center py-2">
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={loading}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11.5px] text-white/45 transition hover:bg-white/[0.07] hover:text-white/70"
                  >
                    載入更多結果
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
