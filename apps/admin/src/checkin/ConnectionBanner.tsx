import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import type { ConnectionState } from "../connection/types.js";

export type CheckinConnectionVisual = "connected" | "offline" | "degraded";

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
      return null;
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
    message: "Offline — scans will be queued",
  },
  degraded: {
    icon: "ti-alert-circle",
    message: "Connection error — check network",
  },
};

/** Check-in connection stripe — separate from operator `ConnectionBanner` in ConnectionStateProvider. */
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
