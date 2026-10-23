import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cx } from '../ui';

interface Toast {
  id: number;
  tone: 'ok' | 'error';
  message: string;
  action?: { label: string; run: () => void };
}

type Push = (t: Omit<Toast, 'id'>) => void;

const ToastContext = createContext<Push>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback<Push>(
    (t) => {
      const id = Date.now() + Math.random();
      setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === 'error' ? 9000 : 6000);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto flex max-w-[560px] items-start gap-2.5 rounded-lg border bg-ink-850 px-3.5 py-2.5 text-[13px] shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6)] [animation:toast-in_240ms_var(--ease-out-expo)]',
              t.tone === 'ok' ? 'border-ink-600' : 'border-danger/50',
            )}
          >
            {t.tone === 'ok' ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" />}
            <span className="min-w-0 break-words">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="shrink-0 font-medium text-signal hover:underline"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" aria-label="Dismiss" className="shrink-0 text-paper-mute hover:text-paper" onClick={() => dismiss(t.id)}>
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
