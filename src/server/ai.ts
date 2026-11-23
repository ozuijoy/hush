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

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

/** s 結尾和 tag 開頭重疊的最長長度（標籤可能被切在兩個片段之間）。 */
function partialSuffix(s: string, tag: string): number {
  for (let k = Math.min(tag.length - 1, s.length); k > 0; k -= 1) {
    if (s.endsWith(tag.slice(0, k))) return k;
  }
  return 0;
}

/**
 * 去掉推理模型的 <think>…</think>，標籤被切在不同片段也能處理；
 * 同時去掉回覆開頭的空白。
 */
export class ThinkFilter {
  private buffer = '';
  private inThink = false;
  private started = false;

  push(chunk: string): string {
    this.buffer += chunk;
    let out = '';
    for (;;) {
      if (this.inThink) {
        const end = this.buffer.indexOf(THINK_CLOSE);
        if (end < 0) {
          this.buffer = this.buffer.slice(-(THINK_CLOSE.length - 1));
          break;
        }
        this.buffer = this.buffer.slice(end + THINK_CLOSE.length);
        this.inThink = false;
        continue;
      }
      const start = this.buffer.indexOf(THINK_OPEN);
      if (start >= 0) {
        out += this.buffer.slice(0, start);
        this.buffer = this.buffer.slice(start + THINK_OPEN.length);
        this.inThink = true;
        continue;
      }
      const keep = partialSuffix(this.buffer, THINK_OPEN);
      out += this.buffer.slice(0, this.buffer.length - keep);
      this.buffer = this.buffer.slice(this.buffer.length - keep);
      break;
    }
    return this.emit(out);
  }

  flush(): string {
    const rest = this.inThink ? '' : this.buffer;
    this.buffer = '';
    return this.emit(rest);
  }

  private emit(text: string): string {
    if (this.started) return text;
    const trimmed = text.replace(/^\s+/, '');
    if (trimmed) this.started = true;
    return trimmed;
  }
}

function contentOf(data: unknown, key: 'delta' | 'message'): string {
  const value = (data as { choices?: Array<Record<string, { content?: unknown } | undefined>> })?.choices?.[0]?.[
    key
  ]?.content;
  return typeof value === 'string' ? value : '';
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
): Promise<AsyncGenerator<string, void, undefined>> {
  // 只有設定 AI_TIMEOUT_SECONDS 才主動逾時；計時涵蓋整個回覆（含串流）。
  const controller = new AbortController();
  const timer = config.timeoutMs === null ? null : setTimeout(() => controller.abort(), config.timeoutMs);
  const stop = () => {
    if (timer) clearTimeout(timer);
  };

  let response: Response;
  try {
    response = await fetchImpl(completionsUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: config.stream ? 'text/event-stream' : 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: Math.min(options.maxTokens ?? config.maxTokens, config.maxTokens),
        stream: config.stream,
      }),
      signal: controller.signal,
    });
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

  async function* generate(): AsyncGenerator<string, void, undefined> {
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
        const text = filter.push(contentOf(data, 'message')) + filter.flush();
        if (text) yield text;
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
              const rest = filter.flush();
              if (rest) yield rest;
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
            const text = filter.push(contentOf(data, 'delta'));
            if (text) yield text;
          }
        }
      } finally {
        reader.releaseLock();
      }
      const rest = filter.flush();
      if (rest) yield rest;
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
