import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";

export type ToastVariant = "success" | "error" | "info" | "warning";

export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  duration?: number;
}

interface ToastContextValue {
  addToast: (message: string, variant?: ToastVariant, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_ICON: Record<ToastVariant, string> = {
  success: "circle-check",
  error: "circle-x",
  warning: "alert-triangle",
  info: "info-circle",
};

/** Clears and removes a pending auto-dismiss timer for the given toast id. */
function clearToastTimer(
  timerRefs: MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>,
  id: string,
) {
  const timer = timerRefs.current.get(id);
  if (timer) {
    clearTimeout(timer);
    timerRefs.current.delete(id);
  }
}

/** Clears and removes all pending auto-dismiss timers. */
function clearAllToastTimers(timerRefs: MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>) {
  for (const timer of timerRefs.current.values()) {
    clearTimeout(timer);
  }
  timerRefs.current.clear();
}

/** Provides toast state and renders a fixed notification stack (max 5, auto-dismiss). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timerRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => () => clearAllToastTimers(timerRefs), []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    clearToastTimer(timerRefs, id);
  }, []);

  const addToast = useCallback(
    (message: string, variant: ToastVariant = "info", duration = 4000) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setToasts((prev) => {
        const withoutDup = prev.filter((t) => !(t.message === message && t.variant === variant));
        for (const toast of prev) {
          if (!withoutDup.some((t) => t.id === toast.id)) {
            clearToastTimer(timerRefs, toast.id);
          }
        }
        const kept = withoutDup.slice(-4);
        const keptIds = new Set(kept.map((t) => t.id));
        for (const toast of withoutDup) {
          if (!keptIds.has(toast.id)) {
            clearToastTimer(timerRefs, toast.id);
          }
        }
        return [...kept, { id, message, variant, duration }];
      });
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timerRefs.current.set(id, timer);
      }
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div
        className="at-toast-stack"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`at-toast at-toast--${toast.variant}`}
            data-testid="at-toast"
            data-variant={toast.variant}
          >
            <i
              className={`ti ti-${TOAST_ICON[toast.variant]} at-toast__icon`}
              aria-hidden="true"
            />
            <span className="at-toast__message">{toast.message}</span>
            <button
              type="button"
              className="at-toast__dismiss"
              aria-label="Dismiss"
              onClick={() => dismiss(toast.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Returns `addToast` from the nearest `ToastProvider`; throws when used outside the provider. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
