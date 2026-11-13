import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { downloadFile, uploadFile } from '../lib/api';
import { fileKind, formatBytes, formatDay, formatTime, isSameDay } from '../lib/format';
import type { Message, User } from '../lib/types';
import { useChat } from '../lib/useChat';
import {
  AlertIcon,
  DownloadIcon,
  LockIcon,
  PaperclipIcon,
  PinIcon,
  SearchIcon,
  SendIcon,
  TrashIcon,
  XIcon,
} from '../components/Icons';
import { SearchPanel } from './SearchPanel';
import { Avatar, Badge, Button, EmptyState, FileGlyph, Modal, Spinner, cx, IconButton } from '../components/ui';
import { useToast } from '../components/Toast';

export function ChatView({
  user,
  members,
  onUploaded,
}: {
  user: User;
  members: User[];
  onUploaded: () => void;
}) {
  const memberCount = members.length;
  const { messages, pinned, pin, unpin, loading, error, hasMore, loadOlder, send, remove, refresh } =
    useChat();
  const [searchOpen, setSearchOpen] = useState(false);
  const [contextId, setContextId] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [pinning, setPinning] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [confirm, setConfirm] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (stick.current) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = '0px';
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [draft]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft('');
    stick.current = true;
    try {
      await send(text, { id: user.id, name: user.displayName, color: user.color });
    } catch (caught) {
      setDraft(text);
      toast(caught instanceof Error ? caught.message : '訊息送出失敗。', 'error');
    } finally {
      setSending(false);
      textarea.current?.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const pickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    setUploading((count) => count + list.length);
    let done = 0;
    for (const file of list) {
      try {
        await uploadFile(file);
        done += 1;
      } catch (caught) {
        toast(caught instanceof Error ? caught.message : '檔案上傳失敗。', 'error');
      } finally {
        setUploading((count) => Math.max(0, count - 1));
      }
    }
    if (done) {
      toast(`已分享 ${done} 個檔案。`, 'success');
      await refresh();
      onUploaded();
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  const download = async (file: NonNullable<Message['file']>) => {
    try {
      await downloadFile({
        id: file.id,
        name: file.name,
        mime: file.mime,
        size: file.size,
        createdAt: '',
        uploader: null,
      });
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '無法取得下載網址。', 'error');
    }
  };

  /** 訊息已在畫面中就捲過去並閃一下；否則回傳 false，交給搜尋面板顯示前後文。 */
  const scrollToMessage = (id: string): boolean => {
    const element = document.getElementById(`msg-${id}`);
    if (!element) return false;
    stick.current = false;
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHighlighted(id);
    window.setTimeout(() => setHighlighted((current) => (current === id ? null : current)), 2200);
    return true;
  };

  const openPinned = () => {
    if (!pinned) return;
    if (scrollToMessage(pinned.message.id)) return;
    setContextId(pinned.message.id);
    setSearchOpen(true);
  };

  const togglePin = async (message: Message) => {
    if (pinning) return;
    setPinning(true);
    try {
      if (pinned?.message.id === message.id) {
        await unpin();
        toast('已取消置頂。', 'success');
      } else {
        await pin(message.id);
        toast(pinned ? '已置頂，並取代原本的置頂訊息。' : '已置頂。', 'success');
      }
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '置頂失敗。', 'error');
    } finally {
      setPinning(false);
    }
  };

  const removePin = async () => {
    try {
      await unpin();
      toast('已取消置頂。', 'success');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '取消置頂失敗。', 'error');
    }
  };

  const confirmDelete = async () => {
    if (!confirm) return;
    setDeleting(true);
    try {
      await remove(confirm.id);
      toast('訊息已移除。', 'success');
      setConfirm(null);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '移除失敗。', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3.5 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-[#a99bff]">
            <LockIcon size={16} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[14.5px] font-semibold tracking-tight text-white">大廳</h2>
            <p className="truncate text-[11px] text-white/35">{memberCount} 位成員 · 只有成員看得到</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <IconButton
            label="搜尋訊息"
            onClick={() => {
              setContextId(null);
              setSearchOpen(true);
            }}
          >
            <SearchIcon size={17} />
          </IconButton>
          <Badge tone="success">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            自動更新
          </Badge>
        </div>
      </header>

      {pinned ? (
        <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#7c6cff]/[0.06] px-4 py-2 lg:px-8">
          <button
            type="button"
            onClick={openPinned}
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            title="跳到置頂訊息"
          >
            <PinIcon size={15} className="shrink-0 text-[#a99bff]" />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] text-[#a99bff]/80">
                置頂訊息 · {pinned.message.author?.name ?? '已移除的成員'}
              </span>
              <span className="block truncate text-[13px] text-white/80">
                {pinned.message.body || (pinned.message.file ? `📎 ${pinned.message.file.name}` : '')}
              </span>
            </span>
          </button>
          {user.role === 'admin' ? (
            <IconButton label="取消置頂" onClick={() => void removePin()} className="h-7 w-7 shrink-0">
              <XIcon size={14} />
            </IconButton>
          ) : null}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={() => {
          const element = scrollRef.current;
          if (!element) return;
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-5 lg:px-8"
      >
        <div className="mx-auto max-w-3xl">
          {error ? (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
              <AlertIcon size={14} /> {error}
            </div>
          ) : null}

          {hasMore ? (
            <div className="mb-5 flex justify-center">
              <button
                type="button"
                onClick={() => void loadOlder()}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11.5px] text-white/45 transition hover:bg-white/[0.07] hover:text-white/70"
              >
                載入更早的訊息
              </button>
            </div>
          ) : null}

          {loading && messages.length === 0 ? (
            <div className="space-y-5 py-6">
              {[0, 1, 2].map((row) => (
                <div key={row} className={cx('flex gap-3', row === 1 && 'flex-row-reverse')}>
                  <div className="h-8 w-8 animate-pulse rounded-full bg-white/[0.06]" />
                  <div className="h-16 w-56 animate-pulse rounded-2xl bg-white/[0.04]" />
                </div>
              ))}
            </div>
          ) : null}

          {!loading && messages.length === 0 ? (
            <EmptyState
              icon={<LockIcon size={20} />}
              title="這裏還很安靜"
              description="這是只屬於你們的空間。送出第一則訊息，或直接拖曳檔案進來。"
            />
          ) : null}

          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const newDay = !previous || !isSameDay(previous.createdAt, message.createdAt);
            const own = message.author?.id === user.id;
            const grouped =
              !newDay &&
              Boolean(previous) &&
              previous.author?.id === message.author?.id &&
              previous.kind !== 'system' &&
              message.kind !== 'system';

            return (
              <Fragment key={message.id}>
                {newDay ? (
                  <div className="my-6 flex items-center gap-3 first:mt-0">
                    <span className="h-px flex-1 bg-white/[0.06]" />
                    <span className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-white/25">
                      {formatDay(message.createdAt)}
                    </span>
                    <span className="h-px flex-1 bg-white/[0.06]" />
                  </div>
                ) : null}

                {message.kind === 'system' ? (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-full bg-white/[0.04] px-3 py-1 text-[11px] text-white/35">
                      {message.body}
                    </span>
                  </div>
                ) : (
                  <div
                    id={`msg-${message.id}`}
                    className={cx(
                      'group flex gap-2.5 rounded-2xl transition-colors duration-700',
                      own ? 'flex-row-reverse' : 'mt-1',
                      highlighted === message.id && 'bg-[#7c6cff]/15',
                    )}
                  >
                    {!own ? (
                      <div className="w-8 shrink-0">
                        {!grouped ? (
                          <Avatar
                            name={message.author?.name ?? '?'}
                            color={message.author?.color ?? '#6d5df6'}
                            size={32}
                          />
                        ) : null}
                      </div>
                    ) : null}

                    <div
                      className={cx(
                        'flex min-w-0 max-w-[min(84%,40rem)] flex-col',
                        own ? 'items-end' : 'items-start',
                      )}
                    >
                      {!own && !grouped ? (
                        <div className="mb-1 flex items-baseline gap-2 px-1">
                          <span className="text-[12.5px] font-medium text-white/70">
                            {message.author?.name ?? '已移除的成員'}
                          </span>
                          <span className="text-[10.5px] tabular-nums text-white/25">
                            {formatTime(message.createdAt)}
                          </span>
                        </div>
                      ) : null}

                      <div className={cx('flex items-center gap-1.5', own && 'flex-row-reverse')}>
                        {message.kind === 'deleted' ? (
                          <div className="rounded-xl border border-dashed border-white/[0.09] px-3 py-1.5 text-[12px] italic text-white/30">
                            此訊息已由管理員移除
                          </div>
                        ) : message.kind === 'file' && message.file ? (
                          <div className={cx('flex flex-col gap-1.5', own ? 'items-end' : 'items-start')}>
                            {message.body ? (
                              <div
                                className={cx(
                                  'max-w-full whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[14.5px] leading-relaxed',
                                  own
                                    ? 'rounded-br-md bg-gradient-to-br from-[#7b68ff] to-[#5f4ce8] text-white'
                                    : 'rounded-bl-md border border-white/[0.06] bg-[#141722] text-white/90',
                                )}
                              >
                                {message.body}
                              </div>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void download(message.file!)}
                              className="flex w-[280px] max-w-full items-center gap-3 rounded-2xl border border-white/[0.08] bg-[#151824] p-2.5 pr-3 text-left transition hover:border-white/[0.16] hover:bg-[#1a1e2b]"
                            >
                              <FileGlyph kind={fileKind(message.file.name, message.file.mime)} size={38} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium text-white/85">
                                  {message.file.name}
                                </span>
                                <span className="block text-[11px] text-white/35">
                                  {formatBytes(message.file.size)}
                                  {message.file.deleted ? ' · 已由管理員移除' : ''}
                                </span>
                              </span>
                              <DownloadIcon size={16} className="shrink-0 text-white/35" />
                            </button>
                          </div>
                        ) : (
                          <div
                            className={cx(
                              'max-w-full whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[14.5px] leading-relaxed',
                              own
                                ? 'rounded-br-md bg-gradient-to-br from-[#7b68ff] to-[#5f4ce8] text-white shadow-[0_10px_30px_-14px_rgba(99,80,240,0.9)]'
                                : 'rounded-bl-md border border-white/[0.06] bg-[#141722] text-white/90',
                            )}
                          >
                            {message.body}
                          </div>
                        )}

                        {user.role === 'admin' && message.kind !== 'deleted' && !message.pending ? (
                          <button
                            type="button"
                            onClick={() => void togglePin(message)}
                            className={cx(
                              'transition group-hover:opacity-100 focus-visible:opacity-100',
                              pinned?.message.id === message.id ? 'opacity-100' : 'opacity-0',
                            )}
                            aria-label={pinned?.message.id === message.id ? '取消置頂' : '置頂訊息'}
                            title={pinned?.message.id === message.id ? '取消置頂' : '置頂訊息'}
                          >
                            <PinIcon
                              size={14}
                              className={
                                pinned?.message.id === message.id
                                  ? 'text-[#a99bff]'
                                  : 'text-white/30 hover:text-[#a99bff]'
                              }
                            />
                          </button>
                        ) : null}

                        {user.role === 'admin' && message.kind !== 'deleted' ? (
                          <button
                            type="button"
                            onClick={() => setConfirm(message)}
                            className="opacity-0 transition hover:text-rose-300 group-hover:opacity-100 focus-visible:opacity-100"
                            aria-label="移除訊息"
                            title="移除訊息"
                          >
                            <TrashIcon size={14} className="text-white/30 hover:text-rose-300" />
                          </button>
                        ) : null}
                      </div>

                      {message.pending ? (
                        <span className="mt-1 px-1 text-[10.5px] text-white/25">傳送中…</span>
                      ) : null}
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })}
          <div ref={bottomRef} className="h-1" />
        </div>
      </div>

      <div className="border-t border-white/[0.06] bg-[#08090d]/60 px-3 py-3 backdrop-blur-xl lg:px-8 lg:py-4">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-2xl border border-white/[0.08] bg-[#0e1017]/90 p-2 transition focus-within:border-[#7c6cff]/45 focus-within:ring-4 focus-within:ring-[#7c6cff]/10">
            <textarea
              ref={textarea}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="輸入訊息…"
              className="max-h-40 w-full resize-none bg-transparent px-3 py-2 text-[14.5px] leading-relaxed text-white placeholder:text-white/25 focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2 px-1 pb-0.5">
              <div className="flex items-center gap-1">
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  hidden
                  onChange={(event) => void pickFiles(event.target.files)}
                />
                <IconButton
                  label="附加檔案"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading > 0}
                >
                  {uploading > 0 ? <Spinner size={15} /> : <PaperclipIcon size={17} />}
                </IconButton>
                <span className="text-[11px] text-white/25">
                  {uploading > 0 ? `上傳中（${uploading}）` : '可直接拖曳檔案'}
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="hidden text-[10.5px] text-white/25 sm:inline">
                  Enter 送出 · Shift+Enter 換行
                </span>
                <Button
                  size="sm"
                  className="h-9 w-9 rounded-xl p-0"
                  onClick={() => void submit()}
                  loading={sending}
                  disabled={!draft.trim()}
                  aria-label="送出訊息"
                >
                  {sending ? null : <SendIcon size={16} />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <SearchPanel
        open={searchOpen}
        members={members}
        contextId={contextId}
        onClose={() => {
          setSearchOpen(false);
          setContextId(null);
        }}
        onSelect={scrollToMessage}
      />

      <Modal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title="移除這則訊息？"
        description="訊息會從聊天室消失，其他成員只會看到「已由管理員移除」。這個動作無法復原。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} loading={deleting}>
              移除訊息
            </Button>
          </>
        }
      />
    </section>
  );
}