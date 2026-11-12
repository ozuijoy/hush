import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertIcon, CheckIcon } from './Icons';

type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

type PushToast = (message: string, kind?: ToastKind) => void;

const ToastContext = createContext<PushToast>(() => {});

export function useToast(): PushToast {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback<PushToast>((message, kind = 'info') => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((list) => [...list.slice(-2), { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((list) => list.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="reveal pointer-events-auto flex max-w-md items-center gap-2.5 rounded-2xl border border-white/10 bg-[#12141c]/95 px-4 py-2.5 text-[13px] text-white/90 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.9)] backdrop-blur-xl"
            role="status"
          >
            <span
              className={
                toast.kind === 'error'
                  ? 'text-rose-400'
                  : toast.kind === 'success'
                    ? 'text-emerald-400'
                    : 'text-[#a99bff]'
              }
            >
              {toast.kind === 'error' ? <AlertIcon size={16} /> : <CheckIcon size={16} />}
            </span>
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}