import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchSetupChecks } from "../api/client.js";
import type { MailerStatus, RoleAssignment, SetupCheckResult, SetupChecksResponse } from "../api/types.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { CONNECTION_ROW_DETAIL, CONNECTION_SEVERITY, mapConnectionState } from "../checkin/ConnectionBanner.js";
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

/** In-memory cache for `GET /api/admin/setup/checks` — StaffShell (and SystemStatus with
 * it) remounts on every top-level shell switch (EventsListShell/AdminShell/
 * InstanceSettingsShell aren't nested under one another), so without this a superadmin
 * clicking between them re-issues the same health check every few seconds. Module-level
 * so it survives the remount; a short TTL keeps it from ever showing very stale data. Use
 * `resetSystemStatusCache()` between tests to avoid leaking state across cases. */
const CHECKS_CACHE_MS = 30_000;
let checksCache: { data: SetupChecksResponse["checks"]; expiresAt: number } | null = null;

export function resetSystemStatusCache(): void {
  checksCache = null;
}

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

/** `null` when mailer status hasn't reached this session at all (e.g. a superadmin whose
 * first page load landed on an operator route, which doesn't return it) — that's "we don't
 * know", not "not configured", so the row is omitted entirely rather than shown as a false
 * alarm. Not superadmin-gated: unlike the setup-checks endpoint, mailer status already
 * reaches every role, so this row shows for everyone once it's available. Deliberately
 * doesn't name the provider (SMTP/Graph/Power Automate) the old MailerStatusBadge's
 * tooltip did — plain-language scope decision (PO review), the provider name is a
 * Settings → Mail concern, not a topbar-glance one. */
function mailerRow(mailerStatus: MailerStatus | null | undefined): StatusRow | null {
  if (mailerStatus == null) return null;
  const configured = mailerStatus.configured;
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
  failed: boolean,
): StatusRow {
  if (failed) return { key, icon, label, state: "down", detail: "Unavailable" };
  if (!loaded) return { key, icon, label, state: "pending", detail: "Checking…" };
  const state: "ok" | "degraded" | "down" = !result || !result.ok ? "down" : result.warn ? "degraded" : "ok";
  return { key, icon, label, state, detail: PLAIN_DETAIL[key][state] };
}

/** Topbar system-health dropdown. Database/Session storage/Data encryption are
 * superadmin-only, matching `GET /api/admin/setup/checks`'s own server-side authorization
 * exactly; Email sending and Check-in connection aren't gated by anything and show for
 * every role, since operators and admins rely on them too. */
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
  const [checks, setChecks] = useState<SetupChecksResponse["checks"] | null>(checksCache?.data ?? null);
  const [checksFailed, setChecksFailed] = useState(false);

  useEffect(() => {
    if (!superadmin) return;
    if (checksCache && checksCache.expiresAt > Date.now()) {
      setChecks(checksCache.data);
      return;
    }
    const ac = new AbortController();
    setChecksFailed(false);
    void (async () => {
      try {
        const data = await fetchSetupChecks(ac.signal);
        if (ac.signal.aborted) return;
        setChecks(data.checks);
        checksCache = { data: data.checks, expiresAt: Date.now() + CHECKS_CACHE_MS };
      } catch {
        if (!ac.signal.aborted) setChecksFailed(true);
      }
    })();
    return () => ac.abort();
  }, [superadmin]);

  const mailer = mailerRow(mailerStatus);
  const rows: StatusRow[] = superadmin
    ? [
        setupCheckRow("database", "database", "Database", checks?.database, checks !== null, checksFailed),
        setupCheckRow("redis", "server-2", "Session storage", checks?.redis, checks !== null, checksFailed),
        ...(mailer ? [mailer] : []),
        setupCheckRow("encryption", "lock", "Data encryption", checks?.encryption, checks !== null, checksFailed),
        connectionRow(connectionState),
      ]
    : [...(mailer ? [mailer] : []), connectionRow(connectionState)];

  const worst: "ok" | "degraded" | "down" = rows.some((r) => r.state === "down")
    ? "down"
    : rows.some((r) => r.state === "degraded")
      ? "degraded"
      : "ok";

  // Only the superadmin's "View system logs" row is an actionable menuitem — for every
  // other role the panel is purely informational, so it shouldn't claim ARIA menu
  // semantics (useDropdownMenu's focus-management already no-ops safely either way, but a
  // screen reader announcing "menu" with zero menuitem children is an invalid structure).
  const hasMenuItem = superadmin;

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        type="button"
        className="sys-status__trigger"
        aria-haspopup={hasMenuItem ? "menu" : "true"}
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
        <div
          className="user-menu__panel sys-status__panel"
          role={hasMenuItem ? "menu" : "group"}
          aria-label={hasMenuItem ? undefined : "System status"}
          ref={panelRef}
        >
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
