import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchSetupChecks } from "../api/client.js";
import type { MailerStatus, RoleAssignment, SetupCheckResult, SetupChecksResponse } from "../api/types.js";
import { isSuperadmin } from "../auth/capabilities.js";
import {
  type CheckinConnectionVisual,
  CONNECTION_SEVERITY,
  mapConnectionState,
} from "../checkin/ConnectionBanner.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import type { ConnectionState } from "../connection/types.js";
import { SETTINGS_INDEX_PATH } from "../settings/settingsTabs.js";
import { useDropdownMenu } from "./useDropdownMenu.js";

type RowState = "ok" | "degraded" | "down" | "pending";

interface StatusRow {
  key: string;
  icon: string;
  label: string;
  detail: string;
  state: RowState;
}

const ROW_CHECK_ICON: Record<RowState, string> = {
  ok: "circle-check",
  degraded: "alert-triangle",
  down: "circle-x",
  pending: "loader-2",
};

/** Plain-language only — no product/vendor names (PostgreSQL, Redis, ENCRYPTION_KEY). An
 * event manager needs to know "is it working", not what runs it; the technical detail
 * still lives in System logs (Settings → Security) for whoever needs it. */
const PLAIN_DETAIL: Record<"database" | "redis" | "encryption", Record<"ok" | "degraded" | "down", string>> = {
  database: { ok: "Connected", degraded: "Responding slowly", down: "Not reachable" },
  redis: { ok: "Connected", degraded: "Responding slowly", down: "Not reachable" },
  encryption: { ok: "Active", degraded: "Needs attention", down: "Not configured" },
};

const SEVERITY_TO_ROW_STATE: Record<"ok" | "warn" | "error", RowState> = {
  ok: "ok",
  warn: "degraded",
  error: "down",
};

const TRIGGER_META: Record<"ok" | "degraded" | "down", { dot: string; label: string; shortLabel: string }> = {
  ok: { dot: "sys-status__dot--ok", label: "All systems normal", shortLabel: "OK" },
  degraded: { dot: "sys-status__dot--warn", label: "Degraded performance", shortLabel: "Degraded" },
  down: { dot: "sys-status__dot--err", label: "Action needed", shortLabel: "Alert" },
};

/** Short form for this row specifically — the full explanatory sentence from
 * `CONNECTION_COPY` (shared with the check-in page banner/live-region) reads fine as a
 * standalone alert but is too long next to every other row's one-word status here. */
const CONNECTION_ROW_DETAIL: Record<CheckinConnectionVisual, string> = {
  connected: "Connected",
  offline: "Offline",
  degraded: "Connection error",
  session_ended: "Session ended",
};

function connectionRow(state: ConnectionState): StatusRow {
  const visual = mapConnectionState(state) ?? "connected";
  return {
    key: "connection",
    icon: "plug-connected",
    label: "Check-in connection",
    state: SEVERITY_TO_ROW_STATE[CONNECTION_SEVERITY[visual]],
    detail: CONNECTION_ROW_DETAIL[visual],
  };
}

function mailerRow(mailerStatus: MailerStatus | null | undefined): StatusRow {
  const configured = !!mailerStatus?.configured;
  return {
    key: "mailer",
    icon: "mail",
    label: "Email sending",
    state: configured ? "ok" : "down",
    detail: configured ? "Connected" : "Not configured",
  };
}

function setupCheckRow(
  key: "database" | "redis" | "encryption",
  icon: string,
  label: string,
  result: SetupCheckResult | undefined,
  loaded: boolean,
): StatusRow {
  if (!loaded) return { key, icon, label, state: "pending", detail: "Checking…" };
  const state: "ok" | "degraded" | "down" = !result || !result.ok ? "down" : result.warn ? "degraded" : "ok";
  return { key, icon, label, state, detail: PLAIN_DETAIL[key][state] };
}

/** Topbar system-health dropdown. Superadmins (the only role authorized to call
 * `GET /api/admin/setup/checks`) see the full instance-health picture; everyone else
 * still gets the check-in connection row, since operators rely on it during check-in. */
export function SystemStatus({
  assignments,
  mailerStatus,
}: {
  assignments: RoleAssignment[];
  mailerStatus: MailerStatus | null | undefined;
}) {
  const navigate = useNavigate();
  const { state: connectionState } = useConnectionState();
  const { open, setOpen, close, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>();
  const superadmin = isSuperadmin(assignments);
  const [checks, setChecks] = useState<SetupChecksResponse["checks"] | null>(null);

  useEffect(() => {
    if (!superadmin) return;
    const ac = new AbortController();
    void (async () => {
      try {
        const data = await fetchSetupChecks(ac.signal);
        if (!ac.signal.aborted) setChecks(data.checks);
      } catch {
        // Leave checks null — the affected rows fall back to "Unavailable" below.
      }
    })();
    return () => ac.abort();
  }, [superadmin]);

  const rows: StatusRow[] = superadmin
    ? [
        setupCheckRow("database", "database", "Database", checks?.database, checks !== null),
        setupCheckRow("redis", "server-2", "Session storage", checks?.redis, checks !== null),
        mailerRow(mailerStatus),
        setupCheckRow("encryption", "lock", "Data encryption", checks?.encryption, checks !== null),
        connectionRow(connectionState),
      ]
    : [connectionRow(connectionState)];

  const worst: "ok" | "degraded" | "down" = rows.some((r) => r.state === "down")
    ? "down"
    : rows.some((r) => r.state === "degraded")
      ? "degraded"
      : "ok";

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        type="button"
        className="sys-status__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        ref={triggerRef}
      >
        <span className={`sys-status__dot ${TRIGGER_META[worst].dot}`} />
        <span className="sys-status__label sys-status__label--short">{TRIGGER_META[worst].shortLabel}</span>
        <span className="sys-status__label sys-status__label--full">{TRIGGER_META[worst].label}</span>
        <i className="ti ti-chevron-down user-menu__chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="user-menu__panel sys-status__panel" role="menu" ref={panelRef}>
          {rows.map((row) => (
            <div
              key={row.key}
              className={`sys-status__row${row.state !== "ok" ? ` sys-status__row--${row.state}` : ""}`}
            >
              <span className="user-menu__item-icon">
                <i className={`ti ti-${row.icon}`} aria-hidden="true" />
              </span>
              <span className="user-menu__item-text">
                <strong>{row.label}</strong>
                <span>{row.detail}</span>
              </span>
              <i
                className={`ti ti-${ROW_CHECK_ICON[row.state]} sys-status__check${row.state !== "ok" ? ` sys-status__check--${row.state}` : ""}`}
                aria-hidden="true"
              />
            </div>
          ))}
          {superadmin && (
            <>
              <div className="user-menu__divider" />
              <button
                type="button"
                role="menuitem"
                className="user-menu__item"
                onClick={() => {
                  close();
                  navigate(`${SETTINGS_INDEX_PATH}?tab=security`);
                }}
              >
                <span className="user-menu__item-icon">
                  <i className="ti ti-list-details" aria-hidden="true" />
                </span>
                <span className="user-menu__item-text">
                  <strong>View system logs</strong>
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
