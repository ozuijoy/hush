/**
 * 外接 AI：呼叫 OpenAI 相容的 /chat/completions，預設用串流（stream: true）。
 *
 * 端點、金鑰、模型全部來自環境變數（AI_BASE_URL、AI_API_KEY、AI_MODEL，三個都必填），
 * 程式碼不寫死任何供應商。上游的錯誤內容不回傳給前端，只記在伺服器日誌。
 */
import type { AiConfig } from './config';
import { HttpError } from './http';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type AiFetch = (url: string, init: RequestInit) => Promise<Response>;

/** base URL 可以填到 /v1，也可以直接填完整的 /chat/completions。 */
export function completionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

/**
 * 關閉推理（思考）用的參數。OpenAI 相容端點沒有統一寫法，所以把常見的幾種一起送：
 * - reasoning_effort: 'none'：OpenAI、Groq 等
 * - enable_thinking: false：Qwen／DashScope、部分相容服務
 * - chat_template_kwargs.enable_thinking: false：vLLM、SGLang 自架
 * - reasoning.enabled: false：OpenRouter
 * - think: false：Ollama
 * 端點不認得而回 400／422 時，自動拿掉這些參數重送一次，並記住這個端點不收。
 */
export const REASONING_OFF: Readonly<Record<string, unknown>> = Object.freeze({
  reasoning_effort: 'none',
  enable_thinking: false,
  chat_template_kwargs: { enable_thinking: false },
  reasoning: { enabled: false },
  think: false,
});

/** Qwen3 等模型認得的軟開關，加在 system 訊息最後。 */
export const NO_THINK_TAG = '/no_think';

/** 不接受關閉推理參數的端點＋模型（記在記憶體，冷啟動後重新判斷）。 */
const hintsRejected = new Set<string>();

export function resetReasoningCache() {
  hintsRejected.clear();
}

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

/** s 結尾和 tag 開頭重疊的最長長度（標籤可能被切在兩個片段之間）。 */
function partialSuffix(s: string, tag: string): number {
  for (let k = Math.min(tag.length - 1, s.length); k > 0; k -= 1) {
    if (s.endsWith(tag.slice(0, k))) return k;
  }
  return 0;
}

export interface StreamPiece {
  /** text：正式回覆；thinking：推理模型的思考過程（只給前端看進度，不算回覆內容）。 */
  kind: 'text' | 'thinking';
  text: string;
}

/**
 * 把推理模型的 <think>…</think> 分出來當「思考」，標籤被切在不同片段也能處理；
 * 同時去掉正式回覆開頭的空白。
 */
export class ThinkFilter {
  private buffer = '';
  private inThink = false;
  private started = false;

  push(chunk: string): StreamPiece[] {
    this.buffer += chunk;
    const pieces: StreamPiece[] = [];
    for (;;) {
      if (this.inThink) {
        const end = this.buffer.indexOf(THINK_CLOSE);
        if (end < 0) {
          const keep = partialSuffix(this.buffer, THINK_CLOSE);
          this.add(pieces, 'thinking', this.buffer.slice(0, this.buffer.length - keep));
          this.buffer = this.buffer.slice(this.buffer.length - keep);
          break;
        }
        this.add(pieces, 'thinking', this.buffer.slice(0, end));
        this.buffer = this.buffer.slice(end + THINK_CLOSE.length);
        this.inThink = false;
        continue;
      }
      const start = this.buffer.indexOf(THINK_OPEN);
      if (start >= 0) {
        this.add(pieces, 'text', this.buffer.slice(0, start));
        this.buffer = this.buffer.slice(start + THINK_OPEN.length);
        this.inThink = true;
        continue;
      }
      const keep = partialSuffix(this.buffer, THINK_OPEN);
      this.add(pieces, 'text', this.buffer.slice(0, this.buffer.length - keep));
      this.buffer = this.buffer.slice(this.buffer.length - keep);
      break;
    }
    return pieces;
  }

  flush(): StreamPiece[] {
    const pieces: StreamPiece[] = [];
    this.add(pieces, this.inThink ? 'thinking' : 'text', this.buffer);
    this.buffer = '';
    return pieces;
  }

  private add(pieces: StreamPiece[], kind: StreamPiece['kind'], text: string) {
    if (kind === 'text' && !this.started) {
      text = text.replace(/^\s+/, '');
      if (text) this.started = true;
    }
    if (text) pieces.push({ kind, text });
  }
}

type ChoicePart = { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };

/** 取出正式內容與思考內容；思考欄位各家叫法不同（reasoning_content、reasoning）。 */
function partsOf(data: unknown, key: 'delta' | 'message'): { content: string; reasoning: string } {
  const part = (data as { choices?: Array<Record<string, ChoicePart | undefined>> })?.choices?.[0]?.[key];
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  return { content: text(part?.content), reasoning: text(part?.reasoning_content) || text(part?.reasoning) };
}

/**
 * 送出請求並回傳逐段文字。
 *
 * 連線失敗、HTTP 錯誤、逾時這類「開始前」的問題會直接丟 HttpError（路由回對應狀態碼）；
 * 開始串流之後的問題由迭代器丟出，路由改用串流裡的 error 事件告知前端。
 */
export async function openChatStream(
  config: AiConfig,
  messages: ChatMessage[],
  fetchImpl: AiFetch = fetch,
  options: { maxTokens?: number; temperature?: number } = {},
): Promise<AsyncGenerator<StreamPiece, void, undefined>> {
  // 只有設定 AI_TIMEOUT_SECONDS 才主動逾時；計時涵蓋整個回覆（含串流）。
  const controller = new AbortController();
  const timer = config.timeoutMs === null ? null : setTimeout(() => controller.abort(), config.timeoutMs);
  const stop = () => {
    if (timer) clearTimeout(timer);
  };

  const key = `${config.baseUrl}|${config.model}`;
  const withNoThink = messages.map((message, index) =>
    index === 0 && message.role === 'system'
      ? { ...message, content: `${message.content}\n${NO_THINK_TAG}` }
      : message,
  );
  const send = (hints: boolean) =>
    fetchImpl(completionsUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: config.stream ? 'text/event-stream' : 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        // 順序：關推理參數 → 自訂參數（AI_EXTRA_BODY 可以改寫前者）→ 核心欄位（不會被蓋掉）。
        ...(hints ? REASONING_OFF : {}),
        ...config.extraBody,
        model: config.model,
        messages: withNoThink,
        temperature: options.temperature ?? 0.3,
        max_tokens: Math.min(options.maxTokens ?? config.maxTokens, config.maxTokens),
        stream: config.stream,
      }),
      signal: controller.signal,
    });

  let response: Response;
  try {
    const hints = !hintsRejected.has(key);
    response = await send(hints);
    if (hints && (response.status === 400 || response.status === 422)) {
      const detail = await response.text().catch(() => '');
      console.warn('[hush] ai endpoint rejected reasoning-off params, retrying without', detail.slice(0, 300));
      hintsRejected.add(key);
      response = await send(false);
    }
  } catch (error) {
    stop();
    if (controller.signal.aborted) {
      throw new HttpError(504, 'ai_timeout', 'AI 回應逾時，請稍後再試或縮小範圍。');
    }
    console.error('[hush] ai request failed', (error as Error).message);
    throw new HttpError(502, 'ai_unreachable', '連不上 AI 服務。');
  }

  if (!response.ok) {
    stop();
    const detail = await response.text().catch(() => '');
    console.error('[hush] ai upstream error', response.status, detail.slice(0, 500));
    if (response.status === 429) {
      throw new HttpError(429, 'ai_rate_limited', 'AI 服務忙碌或額度已用完，請稍後再試。');
    }
    throw new HttpError(502, 'ai_failed', `AI 服務回應錯誤（HTTP ${response.status}）。`);
  }

  const isEventStream = (response.headers.get('content-type') ?? '').includes('text/event-stream');

  async function* generate(): AsyncGenerator<StreamPiece, void, undefined> {
    const filter = new ThinkFilter();
    try {
      // 關閉串流（AI_STREAM=false），或端點不支援串流而直接回 JSON：整段一次送出。
      if (!isEventStream || !response.body) {
        let data: unknown;
        try {
          data = await response.json();
        } catch {
          throw new HttpError(502, 'ai_failed', 'AI 服務回傳的內容無法解析。');
        }
        const { content, reasoning } = partsOf(data, 'message');
        if (reasoning) yield { kind: 'thinking', text: reasoning };
        yield* filter.push(content);
        yield* filter.flush();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            if (payload === '[DONE]') {
              yield* filter.flush();
              return;
            }
            let data: unknown;
            try {
              data = JSON.parse(payload);
            } catch {
              continue;
            }
            if ((data as { error?: unknown })?.error) {
              console.error('[hush] ai stream error', payload.slice(0, 500));
              throw new HttpError(502, 'ai_failed', 'AI 服務在回覆途中出錯。');
            }
            const { content, reasoning } = partsOf(data, 'delta');
            if (reasoning) yield { kind: 'thinking', text: reasoning };
            if (content) yield* filter.push(content);
          }
        }
      } finally {
        reader.releaseLock();
      }
      yield* filter.flush();
    } catch (error) {
      if (controller.signal.aborted) {
        throw new HttpError(504, 'ai_timeout', 'AI 回應逾時，回覆可能不完整。');
      }
      throw error;
    } finally {
      stop();
      // 前端中途離開時停止上游請求。
      controller.abort();
    }
  }

  return generate();
}
