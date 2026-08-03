import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { fetchEventMailSettings, fetchSetupChecks } from "../api/client.js";
import type {
  EventMailSettingsResponse,
  MailerStatus,
  RoleAssignment,
  SetupCheckResult,
  SetupChecksResponse,
} from "../api/types.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { SETTINGS_INDEX_PATH } from "../settings/settingsTabs.js";
import { useDropdownMenu } from "./useDropdownMenu.js";

/** The 3 states a resolved (non-pending) row/trigger can be in. */
type ResolvedRowState = "ok" | "degraded" | "down";
type RowState = ResolvedRowState | "pending";

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
const PLAIN_DETAIL: Record<"database" | "redis" | "encryption", Record<ResolvedRowState, string>> = {
  database: { ok: "Connected", degraded: "Responding slowly", down: "Not reachable" },
  redis: { ok: "Connected", degraded: "Responding slowly", down: "Not reachable" },
  encryption: { ok: "Active", degraded: "Needs attention", down: "Not configured" },
};

const TRIGGER_META: Record<ResolvedRowState, { dot: string; label: string; shortLabel: string }> = {
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

type EventMailSummary = { configured: boolean; hasEventOverride: boolean; failedDeliveries: number };

/** Resolved (event → org fallback) mail transport for one event, as seen by a superadmin
 * viewing that event — mirrors `checksCache` above, keyed by `eventId` since it changes as
 * the superadmin navigates between events. */
let eventMailCache: { eventId: string; data: EventMailSummary; expiresAt: number } | null = null;

export function resetSystemStatusCache(): void {
  checksCache = null;
  eventMailCache = null;
}

/** Same "is it actually configured" check as `attendees/useMailConfigured.ts` (kept
 * duplicated rather than shared — that hook is stateful with no caching or override info,
 * this needs both). Reword one, check the other still matches. `export_only` is a real,
 * saved provider value but never actually delivers mail, so it doesn't count as configured. */
function summarizeEventMail(data: EventMailSettingsResponse): EventMailSummary {
  const provider = data.fields.provider.value;
  return {
    configured: provider === "smtp" || provider === "graph" || provider === "powerautomate",
    hasEventOverride: data.hasEventOverride,
    failedDeliveries: data.failedDeliveries,
  };
}

/** Org-level `mailerStatus` is `null` when it hasn't reached this session at all (e.g. a
 * superadmin whose first page load landed on an operator route, which doesn't return it) —
 * that's "we don't know", not "not configured", so the row is omitted entirely rather than
 * shown as a false alarm. Not superadmin-gated: unlike the setup-checks endpoint, mailer
 * status already reaches every role, so this row shows for everyone once it's available.
 *
 * `eventMail` (superadmin + a specific event in view only, see the fetch in SystemStatus)
 * is preferred whenever it's available and stands on its own — not merely a modifier of the
 * org-level row — because org-level `mailerStatus` is `null` on every `/operator/*` route
 * (see above), so a superadmin checking themselves in at an event would otherwise never see
 * this row at all even though the event-level fetch succeeded. When configured, a nonzero
 * `failedDeliveries` degrades the row instead of a flat "ok" — it can reflect a bounce from
 * weeks ago rather than something actively failing right now (see `failedDeliveries`'s own
 * doc comment in api/types.ts), so the wording deliberately avoids implying recency.
 *
 * Deliberately doesn't name the provider (SMTP/Graph/Power Automate) the old
 * MailerStatusBadge's tooltip did — plain-language scope decision (PO review), the provider
 * name is a Settings → Mail concern, not a topbar-glance one. */
function eventMailState(eventMail: EventMailSummary): ResolvedRowState {
  if (!eventMail.configured) return "down";
  if (eventMail.failedDeliveries > 0) return "degraded";
  return "ok";
}

function eventMailDetail(state: ResolvedRowState, eventMail: EventMailSummary): string {
  if (state === "down") return "Not configured";
  if (state === "degraded") return "Delivery failures need attention";
  return eventMail.hasEventOverride ? "Connected · event" : "Connected · organization";
}

function mailerRow(
  mailerStatus: MailerStatus | null | undefined,
  eventMail: EventMailSummary | null,
): StatusRow | null {
  if (eventMail) {
    const state = eventMailState(eventMail);
    const detail = eventMailDetail(state, eventMail);
    return { key: "mailer", icon: "mail", label: "Email sending", state, detail };
  }
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

function resolveCheckState(result: SetupCheckResult | undefined): ResolvedRowState {
  if (!result?.ok) return "down";
  if (result.warn) return "degraded";
  return "ok";
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
  const state = resolveCheckState(result);
  // Migrations-pending is `ok: false` same as a real connection failure (the wizard's
  // completion gate treats both as blocking), but it isn't "not reachable" — the DB
  // answered fine, schema drift is a different problem. Special-cased inline rather than
  // reshaping PLAIN_DETAIL, since it's the one cell out of nine that needs this.
  const detail =
    key === "database" && state === "down" && result?.reason === "migrations_pending"
      ? "Schema update pending"
      : PLAIN_DETAIL[key][state];
  return { key, icon, label, state, detail };
}

function rowClassName(state: RowState): string {
  if (state === "ok") return "sys-status__row";
  return `sys-status__row sys-status__row--${state}`;
}

/** All-clear should recede, not compete for attention — only degraded/down pick up the
 * heavier weight (see the matching `.sys-status__label--{degraded,down}` rule in staff.css). */
function triggerLabelClassName(modifier: string, worst: ResolvedRowState): string {
  const base = `sys-status__label ${modifier}`;
  return worst === "ok" ? base : `${base} sys-status__label--${worst}`;
}

function checkIconClassName(state: RowState): string {
  const base = `ti ti-${ROW_CHECK_ICON[state]} sys-status__check`;
  return state === "ok" ? base : `${base} sys-status__check--${state}`;
}

function worstRowState(rows: StatusRow[]): ResolvedRowState {
  if (rows.some((row) => row.state === "down")) return "down";
  if (rows.some((row) => row.state === "degraded")) return "degraded";
  return "ok";
}

/** Topbar system-health dropdown, trimmed to what's actionable day-to-day: Database/Session
 * storage/Data encryption are superadmin-only, matching `GET /api/admin/setup/checks`'s own
 * server-side authorization (the endpoint also returns a `base_url` check, used by the setup
 * wizard, but this component doesn't render or factor it into `worst` — Instance URL is a
 * one-time-setup concern, not an ongoing health signal). Email sending isn't gated by
 * anything and shows for every role, since operators and admins rely on it too. Check-in
 * connection state has its own dedicated banner on the Check-in page and operator picker
 * instead of a row here — see `checkin/ConnectionBanner.tsx`. When there's nothing to show
 * (e.g. a non-superadmin on a route where mailer status hasn't reached this session either),
 * the trigger renders nothing rather than a misleading "All systems normal" over an empty
 * panel. */
export function SystemStatus({
  assignments,
  mailerStatus,
  eventId,
}: Readonly<{
  assignments: RoleAssignment[];
  mailerStatus: MailerStatus | null | undefined;
  /** The event currently in view, if any (AdminShell/OperatorShell have one, EventsListShell/
   * InstanceSettingsShell don't). Lets a superadmin's Email sending row reflect that event's
   * own resolved transport instead of only ever the organization-level status. */
  eventId?: string;
}>) {
  const navigate = useNavigate();
  const { open, setOpen, close, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>();
  const superadmin = isSuperadmin(assignments);
  const [checks, setChecks] = useState<SetupChecksResponse["checks"] | null>(
    checksCache && checksCache.expiresAt > Date.now() ? checksCache.data : null,
  );
  const [checksFailed, setChecksFailed] = useState(false);
  const [eventMail, setEventMail] = useState<EventMailSummary | null>(
    eventId && eventMailCache?.eventId === eventId && eventMailCache.expiresAt > Date.now()
      ? eventMailCache.data
      : null,
  );

  // Re-polls every CHECKS_CACHE_MS instead of only fetching once on mount — otherwise the
  // panel only ever updates on a full page reload or a switch between top-level shells (the
  // only things that remount SystemStatus). A poll tick always hits the network (bypassing
  // the cache, which only exists to dedupe *mount*-time fetches) and updates silently: it
  // never re-arms the pending/"Checking…" state or flips to "Unavailable" on its own — only
  // the very first, non-silent fetch does that. One flaky background tick shouldn't blank out
  // a perfectly good last-known reading; the next tick 30s later just tries again.
  useEffect(() => {
    if (!superadmin) return;
    let currentAbort: AbortController | null = null;

    async function load(silent: boolean) {
      if (!silent && checksCache && checksCache.expiresAt > Date.now()) {
        setChecks(checksCache.data);
        return;
      }
      const ac = new AbortController();
      currentAbort = ac;
      if (!silent) setChecksFailed(false);
      try {
        const data = await fetchSetupChecks(ac.signal);
        if (ac.signal.aborted) return;
        setChecks(data.checks);
        setChecksFailed(false);
        checksCache = { data: data.checks, expiresAt: Date.now() + CHECKS_CACHE_MS };
      } catch {
        if (!ac.signal.aborted && !silent) setChecksFailed(true);
      }
    }

    void load(false);
    const intervalId = setInterval(() => void load(true), CHECKS_CACHE_MS);
    return () => {
      currentAbort?.abort();
      clearInterval(intervalId);
    };
  }, [superadmin]);

  useEffect(() => {
    if (!superadmin || !eventId) {
      setEventMail(null);
      return;
    }
    const currentEventId = eventId;
    let currentAbort: AbortController | null = null;

    async function load(silent: boolean) {
      if (!silent && eventMailCache?.eventId === currentEventId && eventMailCache.expiresAt > Date.now()) {
        setEventMail(eventMailCache.data);
        return;
      }
      const ac = new AbortController();
      currentAbort = ac;
      try {
        const data = await fetchEventMailSettings(currentEventId, ac.signal);
        if (ac.signal.aborted) return;
        const summary = summarizeEventMail(data);
        setEventMail(summary);
        eventMailCache = { eventId: currentEventId, data: summary, expiresAt: Date.now() + CHECKS_CACHE_MS };
      } catch {
        // Only the initial (non-silent) fetch fails closed to "no event-level answer" —
        // mailerRow then falls back to the org-level mailerStatus prop, same as before this
        // row existed. A silent poll tick failing just keeps the last-known value on screen
        // and retries next tick, rather than flickering back to the org-level fallback.
        if (!ac.signal.aborted && !silent) setEventMail(null);
      }
    }

    void load(false);
    const intervalId = setInterval(() => void load(true), CHECKS_CACHE_MS);
    return () => {
      currentAbort?.abort();
      clearInterval(intervalId);
    };
  }, [superadmin, eventId]);

  const mailer = mailerRow(mailerStatus, eventMail);
  let rows: StatusRow[];
  if (superadmin) {
    rows = [
      setupCheckRow("database", "database", "Database", checks?.database, checks !== null, checksFailed),
      setupCheckRow("redis", "server-2", "Session storage", checks?.redis, checks !== null, checksFailed),
      setupCheckRow("encryption", "lock", "Data encryption", checks?.encryption, checks !== null, checksFailed),
      ...(mailer ? [mailer] : []),
    ];
  } else {
    rows = mailer ? [mailer] : [];
  }

  if (rows.length === 0) return null;

  const worst = worstRowState(rows);

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
        aria-haspopup={hasMenuItem ? "menu" : undefined}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        ref={triggerRef}
      >
        <span className={`sys-status__dot ${TRIGGER_META[worst].dot}`} />
        <span className={triggerLabelClassName("sys-status__label--short", worst)}>
          {TRIGGER_META[worst].shortLabel}
        </span>
        <span className={triggerLabelClassName("sys-status__label--full", worst)}>{TRIGGER_META[worst].label}</span>
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
            <div key={row.key} className={rowClassName(row.state)}>
              <span className="user-menu__item-icon">
                <i className={`ti ti-${row.icon}`} aria-hidden="true" />
              </span>
              <span className="user-menu__item-text">
                <strong>{row.label}</strong>
                <span>{row.detail}</span>
              </span>
              <i className={checkIconClassName(row.state)} aria-hidden="true" />
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
                  navigate(`${SETTINGS_INDEX_PATH}?tab=health`);
                }}
              >
                <span className="user-menu__item-icon">
                  <i className="ti ti-heartbeat" aria-hidden="true" />
                </span>
                <span className="user-menu__item-text">
                  <strong>View health check</strong>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="user-menu__item"
                onClick={() => {
                  close();
                  navigate(`${SETTINGS_INDEX_PATH}?tab=logs`);
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
