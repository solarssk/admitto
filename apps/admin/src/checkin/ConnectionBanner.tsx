import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import type { ConnectionState } from "../connection/types.js";

export type CheckinConnectionVisual = "connected" | "offline" | "degraded" | "session_ended";

/** Collapses the 5 raw connection states to the 4 the UI distinguishes — reused by the
 * check-in page banner and live-region. */
export function mapConnectionState(state: ConnectionState): CheckinConnectionVisual | null {
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

export const CONNECTION_COPY: Record<CheckinConnectionVisual, { icon: string; message: string }> = {
  connected: {
    icon: "ti-circle-check",
    message: "Connected. All scans confirmed by server",
  },
  offline: {
    icon: "ti-wifi-off",
    message: "Offline. New check-ins are blocked until connection returns",
  },
  degraded: {
    icon: "ti-alert-circle",
    message: "Connection error. Check network",
  },
  session_ended: {
    icon: "ti-logout",
    message: "Your session has ended. Redirecting to sign in…",
  },
};

/** Screen-reader announcements for all connection states in one stable live region. */
export function CheckinConnectionLiveRegion() {
  const { state } = useConnectionState();
  const visual = mapConnectionState(state);
  if (!visual) return null;

  return (
    <div
      className="ck-connection-live sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="checkin-connection-live"
    >
      {CONNECTION_COPY[visual].message}
    </div>
  );
}

/** Check-in page banner — operator event picker uses global `ConnectionBanner` in `OperatorShell`. */
export function CheckinConnectionBanner() {
  const { state } = useConnectionState();
  const visual = mapConnectionState(state);
  if (!visual || visual === "connected") return null;

  return (
    <div
      className={`ck-connection ck-connection--${visual}`}
      data-connection={state}
      aria-hidden="true"
    >
      <i className={`ti ${CONNECTION_COPY[visual].icon}`} aria-hidden="true" />
      <span>{CONNECTION_COPY[visual].message}</span>
    </div>
  );
}
