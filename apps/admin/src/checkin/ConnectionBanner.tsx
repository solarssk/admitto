import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import type { ConnectionState } from "../connection/types.js";

export type CheckinConnectionVisual = "connected" | "offline" | "degraded" | "session_ended";

/** Collapses the 5 raw connection states to the 4 the UI distinguishes — reused by the
 * check-in page banner/live-region and by SystemStatus's topbar connection row. */
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

/** Short form of `CONNECTION_COPY`'s message, for SystemStatus's topbar row — the full
 * sentence reads fine as a standalone banner/live-region alert but is too long next to
 * every other row's one-word status there. Kept next to `CONNECTION_COPY` on purpose: if
 * you reword one, check whether the other still matches. */
export const CONNECTION_ROW_DETAIL: Record<CheckinConnectionVisual, string> = {
  connected: "Connected",
  offline: "Offline",
  degraded: "Connection error",
  session_ended: "Session ended",
};

export const CONNECTION_SEVERITY: Record<CheckinConnectionVisual, "ok" | "warn" | "error"> = {
  connected: "ok",
  offline: "error",
  degraded: "warn",
  session_ended: "error",
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
