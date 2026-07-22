import { Tooltip } from "@admitto/ui";
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

const BADGE_VARIANT: Record<CheckinConnectionVisual, "ok" | "warn" | "error"> = {
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
      {COPY[visual].message}
    </div>
  );
}

/**
 * Compact colored-icon indicator of the app-wide connection heartbeat, shown in every
 * state (not just when healthy) so a degraded/offline connection is actually visible
 * instead of the badge just disappearing. Rendered globally in StaffShell's topbar
 * (next to MailerStatusBadge), not scoped to the check-in page — the underlying
 * ConnectionStateProvider is app-wide, not check-in-specific.
 */
export function ServerConnectionBadge() {
  const { state } = useConnectionState();
  const visual = mapConnectionState(state);
  if (!visual) return null;
  const { icon, message } = COPY[visual];

  return (
    <Tooltip content={message} className={`status-circle status-circle--${BADGE_VARIANT[visual]}`}>
      {/* role="img" (not "status") — a generic <span> with just aria-label isn't reliably
          exposed to screen readers, but this renders on every page including CheckInPage,
          which already has its own role="status" aria-live region (CheckinConnectionLiveRegion
          below) for the same state; role="status" here too would double-announce there. */}
      <span role="img" aria-label={message}>
        <i className={`ti ${icon}`} aria-hidden="true" />
      </span>
    </Tooltip>
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
