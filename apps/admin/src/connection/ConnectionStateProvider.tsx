import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiError, fetchMe } from "../api/client.js";
import type { ConnectionContextValue, ConnectionState } from "./types.js";

const HEARTBEAT_MS = 30_000;
const TIMEOUT_MS = 5_000;

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

function loginRedirect(reason: string): void {
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`/login?reason=${reason}&next=${next}`);
}

export function ConnectionStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConnectionState>("reconnecting");
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const mounted = useRef(true);

  const reportApiError = useCallback((status: number) => {
    if (status === 401) {
      setState("session_ended");
      loginRedirect("session_ended");
      return;
    }
    if (status >= 500) {
      setState("server_unavailable");
    }
  }, []);

  const ping = useCallback(async () => {
    if (!navigator.onLine) {
      setState("offline");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      await fetchMe(controller.signal);
      if (!mounted.current) return;
      setState("connected");
      setLastCheckedAt(Date.now());
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof Error && err.name === "AbortError") {
        setState("server_unavailable");
        return;
      }
      const status = err instanceof ApiError ? err.status : undefined;
      if (status === 401) {
        setState("session_ended");
        loginRedirect("session_ended");
        return;
      }
      if (!navigator.onLine) {
        setState("offline");
      } else {
        setState("server_unavailable");
      }
    } finally {
      window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void ping();

    const interval = window.setInterval(() => void ping(), HEARTBEAT_MS);
    const onOnline = () => void ping();
    const onOffline = () => setState("offline");
    const onVisibility = () => {
      if (document.visibilityState === "visible") void ping();
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      mounted.current = false;
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ping]);

  const value = useMemo(
    () => ({ state, lastCheckedAt, reportApiError }),
    [state, lastCheckedAt, reportApiError],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnectionState(): ConnectionContextValue {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error("useConnectionState requires ConnectionStateProvider");
  return ctx;
}

export function ConnectionBanner() {
  const { state } = useConnectionState();
  if (state === "connected" || state === "reconnecting") return null;

  const messages: Record<Exclude<ConnectionState, "connected" | "reconnecting">, string> = {
    offline: "You are offline. Changes are not being saved.",
    server_unavailable: "Server unavailable. Not connected — scans are NOT being confirmed by the server.",
    session_ended: "Your session has ended. Redirecting to sign in…",
  };

  return (
    <div className="connection-banner" role="status" data-state={state}>
      {messages[state]}
    </div>
  );
}
