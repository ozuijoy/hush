import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AI_TRUNCATED_NOTICE, api, type AiChatMessage } from '../lib/api';
import { SendIcon, SparklesIcon } from './Icons';
import { Button, Modal, Spinner, cx } from './ui';
import { useToast } from './Toast';

const MAX_SHARE = 4000;

/** 個人 AI 助手：對話只存在這個分頁的記憶體裡，重新整理就清空，伺服器不保存。 */
export function AiAssistant({
  open,
  onClose,
  onShare,
}: {
  open: boolean;
  onClose: () => void;
  onShare: (text: string) => Promise<void>;
}) {
  const [history, setHistory] = useState<AiChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState<number | null>(null);
  const [thinking, setThinking] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (open) bottom.current?.scrollIntoView({ block: 'end' });
  }, [open, history, busy]);

  const ask = async () => {
    const question = draft.trim();
    if (!question || busy) return;
    const next: AiChatMessage[] = [...history, { role: 'user', content: question }];
    setHistory(next);
    setDraft('');
    setBusy(true);
    setThinking('');
    const controller = new AbortController();
    abort.current = controller;
    let partial = '';
    try {
      // 串流：邊收邊顯示。
      await api.aiChat(next, {
        signal: controller.signal,
        onThinking: setThinking,
        onTruncated: () => toast(AI_TRUNCATED_NOTICE, 'error'),
        onText: (text) => {
          partial = text;
          setHistory([...next, { role: 'assistant', content: text }]);
        },
      });
    } catch (caught) {
      if (partial) {
        // 已經收到一部分就保留，讓使用者自己判斷。
        setHistory([...next, { role: 'assistant', content: `${partial}…` }]);
      } else {
        setHistory(history);
        setDraft(question);
      }
      if (!controller.signal.aborted) {
        toast(caught instanceof Error ? caught.message : 'AI 暫時無法回答。', 'error');
      }
    } finally {
      abort.current = null;
      setBusy(false);
      setThinking('');
    }
  };

  const share = async (index: number) => {
    const answer = history[index];
    const question = history[index - 1];
    const text = `${question ? `問：${question.content}\n` : ''}AI：${answer.content}`.slice(0, MAX_SHARE);
    setSharing(index);
    try {
      await onShare(text);
      toast('已分享到聊天室。', 'success');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '分享失敗。', 'error');
    } finally {
      setSharing(null);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void ask();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AI 助手"
      description="只有你看得到這段對話，伺服器不保存；重新整理頁面就會清空。"
    >
      <div className="flex max-h-[60vh] flex-col">
        <div className="min-h-[120px] flex-1 space-y-3 overflow-y-auto pr-1">
          {history.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-white/35">問點什麼吧，例如「幫我想三個週末活動」。</p>
          ) : null}
          {history.map((item, index) => (
            <div key={index} className={cx('flex flex-col', item.role === 'user' ? 'items-end' : 'items-start')}>
              <div
                className={cx(
                  'max-w-[90%] whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-2xl px-3 py-2 text-[13.5px] leading-relaxed',
                  item.role === 'user'
                    ? 'rounded-br-md bg-[#6350f0] text-white'
                    : 'rounded-bl-md border border-white/[0.06] bg-[#141722] text-white/90',
                )}
              >
                {item.content}
              </div>
              {item.role === 'assistant' && !(busy && index === history.length - 1) ? (
                <button
                  type="button"
                  onClick={() => void share(index)}
                  disabled={sharing !== null}
                  className="mt-1 px-1 text-[11px] text-white/35 hover:text-[#a99bff] disabled:opacity-40"
                >
                  {sharing === index ? '分享中…' : '分享到聊天室'}
                </button>
              ) : null}
            </div>
          ))}
          {busy && history[history.length - 1]?.role === 'user' ? (
            <div className="flex items-center gap-2 text-[12px] text-white/40">
              <Spinner size={13} /> 思考中…
              {thinking ? <ThinkingTail text={thinking} /> : null}
            </div>
          ) : null}
          <div ref={bottom} />
        </div>
        <div className="mt-3 flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={4000}
            placeholder="輸入問題…（Enter 送出）"
            className="field flex-1 resize-none py-2 text-[13.5px]"
          />
          {busy ? (
            <Button variant="ghost" className="h-10 shrink-0 px-3" onClick={() => abort.current?.abort()}>
              停止
            </Button>
          ) : (
            <Button className="h-10 w-10 shrink-0 p-0" onClick={() => void ask()} disabled={!draft.trim()} aria-label="送出問題">
              <SendIcon size={16} />
            </Button>
          )}
        </div>
        {history.length > 0 ? (
          <button
            type="button"
            onClick={() => setHistory([])}
            disabled={busy}
            className="mt-2 self-start text-[11px] text-white/30 hover:text-white/60"
          >
            清空對話
          </button>
        ) : null}
      </div>
    </Modal>
  );
}

/** 聊天摘要：把最近的訊息交給 AI 整理重點與待辦。 */
export function AiSummary({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [limit, setLimit] = useState(100);
  const [summary, setSummary] = useState<{ text: string; count: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState('');
  const toast = useToast();

  const generate = async () => {
    setBusy(true);
    let count = 0;
    setSummary(null);
    setThinking('');
    try {
      await api.aiSummarize(limit, {
        onThinking: setThinking,
        onTruncated: () => toast(AI_TRUNCATED_NOTICE, 'error'),
        onMeta: (meta) => {
          count = Number(meta.count ?? 0);
          setSummary({ text: '', count });
        },
        onText: (text) => setSummary({ text, count }),
      });
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : '摘要失敗。', 'error');
    } finally {
      setBusy(false);
      setThinking('');
    }
  };

  const copy = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary.text);
      toast('已複製摘要。', 'success');
    } catch {
      toast('無法複製，請手動選取。', 'error');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AI 聊天摘要"
      description="整理最近訊息的重點、決定與待辦。訊息內容會送到管理員設定的 AI 服務。"
      footer={
        <>
          {summary?.text && !busy ? (
            <Button variant="ghost" onClick={() => void copy()}>
              複製
            </Button>
          ) : null}
          <Button onClick={() => void generate()} loading={busy}>
            <SparklesIcon size={15} />
            {summary ? '重新摘要' : '產生摘要'}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex items-center gap-2 text-[12.5px] text-white/55">
        範圍
        {[50, 100, 200].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setLimit(value)}
            className={cx(
              'rounded-lg border px-2.5 py-1 transition',
              limit === value
                ? 'border-[#7c6cff]/50 bg-[#7c6cff]/15 text-white'
                : 'border-white/10 text-white/50 hover:text-white/80',
            )}
          >
            最近 {value} 則
          </button>
        ))}
      </div>
      {busy && !summary?.text ? (
        <div className="flex items-center gap-2 text-[12px] text-white/40">
          <Spinner size={13} /> 思考中…
          {thinking ? <ThinkingTail text={thinking} /> : null}
        </div>
      ) : null}
      {summary?.text ? (
        <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-[#141722] p-3 text-[13.5px] leading-relaxed text-white/85">
          <p className="mb-2 text-[11px] text-white/35">根據 {summary.count} 則訊息</p>
          {summary.text}
        </div>
      ) : null}
    </Modal>
  );
}

/** 只顯示思考過程最後一小段，讓使用者知道模型還在動。 */
function ThinkingTail({ text }: { text: string }) {
  const tail = text.replace(/\s+/g, ' ').slice(-80);
  return <span className="min-w-0 flex-1 truncate italic text-white/25">{tail}</span>;
}
