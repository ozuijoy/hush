import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { Message, PinnedMessage } from './types';

const POLL_INTERVAL = 2500;

function sortMessages(list: Message[]): Message[] {
  return [...list].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [pinned, setPinned] = useState<PinnedMessage | null>(null);
  const cursor = useRef('0');
  const inFlight = useRef(false);

  const merge = useCallback((incoming: Message[]) => {
    if (!incoming.length) return;
    setMessages((previous) => {
      const map = new Map(previous.map((message) => [message.id, message]));
      for (const message of incoming) {
        const existing = map.get(message.id);
        map.set(message.id, existing ? { ...existing, ...message, pending: false } : message);
      }
      return sortMessages([...map.values()]);
    });
  }, []);

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await api.messages(cursor.current === '0' ? undefined : cursor.current);
      if (response.messages.length) merge(response.messages);
      setPinned(response.pinned ?? null);
      if (cursor.current === '0') setHasMore(response.messages.length >= 80);
      cursor.current = response.lastId;
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '無法載入訊息。');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [merge]);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void poll();
    }, POLL_INTERVAL);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [poll]);

  const loadOlder = useCallback(async () => {
    const oldest = messages[0];
    if (!oldest) return;
    try {
      const response = await api.messagesBefore(oldest.id);
      merge(response.messages);
      setHasMore(response.messages.length >= 60);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '無法載入更早的訊息。');
    }
  }, [messages, merge]);

  const send = useCallback(async (text: string, author: { id: string; name: string; color: string }) => {
    const tempId = `tmp-${Date.now()}`;
    const optimistic: Message = {
      id: tempId,
      kind: 'text',
      body: text,
      deleted: false,
      createdAt: new Date().toISOString(),
      author,
      file: null,
      pending: true,
    };
    setMessages((previous) => sortMessages([...previous, optimistic]));

    try {
      const response = await api.sendMessage(text);
      setMessages((previous) => {
        const withoutTemp = previous.filter((message) => message.id !== tempId);
        const map = new Map(withoutTemp.map((message) => [message.id, message]));
        map.set(response.message.id, response.message);
        return sortMessages([...map.values()]);
      });
      // 不要把游標直接跳到自己這則：期間別人送出的訊息 id 比較小，會被輪詢略過。
      // 下次輪詢會把自己這則再拿一次，merge 會去重。
    } catch (caught) {
      setMessages((previous) => previous.filter((message) => message.id !== tempId));
      throw caught;
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    await api.deleteMessage(id);
    setMessages((previous) =>
      previous.map((message) =>
        message.id === id
          ? { ...message, deleted: true, kind: 'deleted' as const, body: null }
          : message,
      ),
    );
    setPinned((current) => (current?.message.id === id ? null : current));
  }, []);

  const pin = useCallback(async (id: string) => {
    const response = await api.pinMessage(id);
    setPinned(response.pinned);
  }, []);

  const unpin = useCallback(async () => {
    await api.unpinMessage();
    setPinned(null);
  }, []);

  return {
    messages,
    pinned,
    pin,
    unpin,
    loading,
    error,
    hasMore,
    loadOlder,
    send,
    remove,
    refresh: poll,
  };
}