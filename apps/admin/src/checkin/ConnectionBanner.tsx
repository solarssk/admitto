import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import type { ConnectionState } from "../connection/types.js";

export type CheckinConnectionVisual = "connected" | "offline" | "degraded" | "session_ended";

function mapConnectionState(state: ConnectionState): CheckinConnectionVisual | null {
  switch (state) {
    case "connected":
      return "connected";
    case "offline":
      return "offline";
    case "reconnecting":
    case "server_unavailable":
      return "degraded";
    case "session_ended":
      return "session_ended";
    default:
      return "degraded";
  }
}

const COPY: Record<CheckinConnectionVisual, { icon: string; message: string }> = {
  connected: {
    icon: "ti-circle-check",
    message: "Connected — all scans confirmed by server",
  },
  offline: {
    icon: "ti-wifi-off",
    message: "Offline — new check-ins are blocked until connection returns",
  },
  degraded: {
    icon: "ti-alert-circle",
    message: "Connection error — check network",
  },
  session_ended: {
    icon: "ti-logout",
    message: "Your session has ended. Redirecting to sign in…",
  },
};

/** Admin check-in only — operator shell renders its own `ConnectionBanner`. */
export function CheckinConnectionBanner() {
  const { state } = useConnectionState();
  const visual = mapConnectionState(state);
  if (!visual) return null;

  return (
    <div
      className={`ck-connection ck-connection--${visual}`}
      role="status"
      aria-live="polite"
      data-connection={state}
    >
      <i className={`ti ${COPY[visual].icon}`} aria-hidden="true" />
      <span>{COPY[visual].message}</span>
    </div>
  );
}
