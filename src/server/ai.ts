/**
 * 外接 AI：呼叫 OpenAI 相容的 /chat/completions。
 *
 * 端點、金鑰、模型全部來自環境變數（AI_BASE_URL、AI_API_KEY、AI_MODEL），
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

export async function chatComplete(
  config: AiConfig,
  messages: ChatMessage[],
  fetchImpl: AiFetch = fetch,
  options: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(completionsUrl(config.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: Math.min(options.maxTokens ?? config.maxTokens, config.maxTokens),
        stream: false,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new HttpError(504, 'ai_timeout', 'AI 回應逾時，請稍後再試或縮小範圍。');
    }
    console.error('[hush] ai request failed', (error as Error).message);
    throw new HttpError(502, 'ai_unreachable', '連不上 AI 服務。');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[hush] ai upstream error', response.status, detail.slice(0, 500));
    if (response.status === 429) {
      throw new HttpError(429, 'ai_rate_limited', 'AI 服務忙碌或額度已用完，請稍後再試。');
    }
    throw new HttpError(502, 'ai_failed', `AI 服務回應錯誤（HTTP ${response.status}）。`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new HttpError(502, 'ai_failed', 'AI 服務回傳的內容無法解析。');
  }
  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]
    ?.message?.content;
  // 部分推理模型會把思考過程放在 <think>…</think>，不顯示給成員。
  const text = typeof content === 'string' ? content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() : '';
  if (!text) throw new HttpError(502, 'ai_empty', 'AI 沒有回覆內容。');
  return text;
}
