import { Badge } from "@admitto/ui";
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
      {COPY[visual].message}
    </div>
  );
}

/** Compact header indicator when the server link is healthy (admin check-in page header). */
export function CheckinConnectionPill() {
  const { state } = useConnectionState();
  if (mapConnectionState(state) !== "connected") return null;

  return (
    <span title="All scans confirmed by server">
      <Badge variant="ok" dot>
        Server connected
      </Badge>
    </span>
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
      <i className={`ti ${COPY[visual].icon}`} aria-hidden="true" />
      <span>{COPY[visual].message}</span>
    </div>
  );
}
