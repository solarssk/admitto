import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Spinner } from "@admitto/ui";
import { fetchEventMailSettings, fetchSetupChecks } from "../api/client.js";
import type {
  EventMailSettingsResponse,
  MailerStatus,
  RoleAssignment,
  SetupCheckResult,
  SetupChecksResponse,
} from "../api/types.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { useLoadingGate, useMinimumBusy } from "../hooks/useDelayedLoading.js";
import { useBusyEndCount } from "../hooks/useRetry.js";
import { SETTINGS_INDEX_PATH } from "../settings/settingsTabs.js";
import { loadWithTimeout, rejectOnAbort } from "../utils/load-timeout.js";
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

/** The icon at the end of a row that has its answer (a row still being checked has the kit's `Spinner` there instead). */
const ROW_CHECK_ICON: Record<ResolvedRowState, string> = {
  ok: "circle-check",
  degraded: "alert-triangle",
  down: "circle-x",
};

/** Plain-language only — no product/vendor names (PostgreSQL, Redis, ENCRYPTION_KEY). An
 * event manager needs to know "is it working", not what runs it; the technical detail
 * still lives in System logs (Settings → Security) for whoever needs it. `worker` never
 * actually reaches `down` (see `checkWorker` in setup-checks-routes.ts), but the table
 * stays total rather than a partial keyed only on the two states that occur. */
const PLAIN_DETAIL: Record<"database" | "redis" | "encryption" | "worker", Record<ResolvedRowState, string>> = {
  database: { ok: "Connected", degraded: "Responding slowly", down: "Not reachable" },
  redis: { ok: "Connected", degraded: "Responding slowly", down: "Not reachable" },
  encryption: { ok: "Active", degraded: "Needs attention", down: "Not configured" },
  worker: { ok: "Running", degraded: "Needs attention", down: "Not reachable" },
};

const TRIGGER_META: Record<RowState, { dot: string; label: string; shortLabel: string }> = {
  ok: { dot: "sys-status__dot--ok", label: "All systems normal", shortLabel: "OK" },
  degraded: { dot: "sys-status__dot--warn", label: "Degraded performance", shortLabel: "Degraded" },
  down: { dot: "sys-status__dot--err", label: "Action needed", shortLabel: "Alert" },
  pending: { dot: "sys-status__dot--pending", label: "Checking systems…", shortLabel: "Checking…" },
};

/** In-memory cache for `GET /api/admin/setup/checks` — StaffShell (and SystemStatus with
 * it) remounts on every top-level shell switch (EventsListShell/AdminShell/
 * InstanceSettingsShell aren't nested under one another), so without this a superadmin
 * clicking between them re-issues the same health check every few seconds. Module-level
 * so it survives the remount; a short TTL keeps it from ever showing very stale data. Use
 * `resetSystemStatusCache()` between tests to avoid leaking state across cases. */
const CHECKS_CACHE_MS = 30_000;

/** What the menu says (to assistive tech, whether or not it is open) when the checks did not answer. */
const CHECKS_FAILED_TEXT = "The system checks did not answer.";
let checksCache: { data: SetupChecksResponse; expiresAt: number } | null = null;

type EventMailSummary = { configured: boolean; hasEventOverride: boolean; failedDeliveries: number };

/** What the first read of one event's mail transport has said: its answer, or `null` when the read failed or ran out of time (the row
 * then falls back to the organization-level status). Keyed by the event, so the answer for another event is never taken for this one's. */
type EventMailRead = { eventId: string; summary: EventMailSummary | null };

/** Resolved (event → org fallback) mail transport for one event, as seen by a superadmin
 * viewing that event — mirrors `checksCache` above, keyed by `eventId` since it changes as
 * the superadmin navigates between events. */
let eventMailCache: { eventId: string; data: EventMailSummary; expiresAt: number } | null = null;

/** What a Retry does when no read is owned by the component (a viewer who is not a superadmin has no checks to ask for). */
const NO_RETRY = () => Promise.resolve();

export function resetSystemStatusCache(): void {
  checksCache = null;
  eventMailCache = null;
}

/** What one polled thing (the setup checks, an event's mail settings) remembers between its reads. */
interface PollState {
  /** The reads on their way, so that leaving aborts all of them, not only the newest. */
  inFlight: Set<AbortController>;
  /** How many reads have started: one that started later is the newer one. */
  started: number;
  /** The newest read whose answer has been applied. */
  answered: number;
}

function newPollState(): PollState {
  return { inFlight: new Set(), started: 0, answered: 0 };
}

/**
 * One read of something that is polled. A read somebody waits for (`silent` false: the first one, a Retry) has the 30 second
 * limit (AGENTS.md "Admin SPA loading and busy states"); a tick of the poll has none. Reads can overlap (a tick falls due while
 * a Retry is on its way), so they are numbered: an answer is applied unless a read that started later has answered already, so
 * an older snapshot never replaces a newer one, and a failure is reported only for a read somebody waits for and only when no
 * answer has been applied while it ran (a tick that worked meanwhile is the better news, and it is not turned into a failure).
 */
async function pollRead<T>(
  state: PollState,
  silent: boolean,
  fetcher: (signal: AbortSignal) => Promise<T>,
  onAnswer: (data: T) => void,
  onFailure: () => void,
): Promise<void> {
  const ac = new AbortController();
  state.inFlight.add(ac);
  const mine = ++state.started;
  const answeredWhenStarted = state.answered;
  const limit = silent ? null : loadWithTimeout(ac.signal);
  const signal = limit?.signal ?? ac.signal;
  try {
    const data = await rejectOnAbort(fetcher(signal), signal);
    if (ac.signal.aborted || mine < state.answered) return;
    state.answered = mine;
    onAnswer(data);
  } catch {
    if (!ac.signal.aborted && !silent && state.answered === answeredWhenStarted) onFailure();
  } finally {
    limit?.done();
    state.inFlight.delete(ac);
  }
}

/** Leaving: every read still on its way is abandoned, and the poll stops. */
function stopPolling(state: PollState, intervalId: ReturnType<typeof setInterval>): void {
  for (const ac of state.inFlight) ac.abort();
  clearInterval(intervalId);
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
 * A superadmin in an event is told the event's own answer or nothing: until that read has
 * answered (`eventMailPending`) the row is being checked, and the organization-level status
 * does not stand in for it (an event can override the organization's transport, so "Connected"
 * there could be false here). It is only the fallback for a read that failed or ran out of time.
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
  eventMailPending: boolean,
): StatusRow | null {
  if (eventMail) {
    const state = eventMailState(eventMail);
    const detail = eventMailDetail(state, eventMail);
    return { key: "mailer", icon: "mail", label: "Email sending", state, detail };
  }
  if (eventMailPending) return { key: "mailer", icon: "mail", label: "Email sending", state: "pending", detail: "Checking…" };
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
  key: "database" | "redis" | "encryption" | "worker",
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
function triggerLabelClassName(modifier: string, worst: RowState): string {
  const base = `sys-status__label ${modifier}`;
  return worst === "ok" || worst === "pending" ? base : `${base} sys-status__label--${worst}`;
}

function checkIconClassName(state: ResolvedRowState): string {
  const base = `ti ti-${ROW_CHECK_ICON[state]} sys-status__check`;
  return state === "ok" ? base : `${base} sys-status__check--${state}`;
}

/** The end of a row: the icon of its answer, or, while the row is still being checked, a spinner (decoration: the row's own
 * text says "Checking…"). */
function RowCheck({ state }: Readonly<{ state: RowState }>) {
  if (state === "pending") return <Spinner size="sm" aria-hidden="true" className="sys-status__check sys-status__check--pending" />;
  return <i className={checkIconClassName(state)} aria-hidden="true" />;
}

/** The rows of the menu: the four setup checks (superadmin only), then Email sending when there is something to say about it. */
function statusRows(
  superadmin: boolean,
  checks: SetupChecksResponse | null,
  checksFailed: boolean,
  mailer: StatusRow | null,
): StatusRow[] {
  const mailerRows = mailer ? [mailer] : [];
  if (!superadmin) return mailerRows;
  const loaded = checks !== null;
  return [
    setupCheckRow("database", "database", "Database", checks?.checks.database, loaded, checksFailed),
    setupCheckRow("redis", "server-2", "Session storage", checks?.checks.redis, loaded, checksFailed),
    setupCheckRow("encryption", "lock", "Data encryption", checks?.checks.encryption, loaded, checksFailed),
    setupCheckRow("worker", "cpu", "Background worker", checks?.worker, loaded, checksFailed),
    ...mailerRows,
  ];
}

/**
 * What the trigger says: a verdict, or that no verdict is in yet (`pending`: no row has failed, and some are still being
 * checked). A failure is shown as soon as it is known, even while other rows are still being checked; "ok" is only said when
 * every row has answered.
 */
function worstRowState(rows: StatusRow[]): RowState {
  if (rows.some((row) => row.state === "down")) return "down";
  if (rows.some((row) => row.state === "degraded")) return "degraded";
  if (rows.some((row) => row.state === "pending")) return "pending";
  return "ok";
}

/**
 * The setup checks, read when the component mounts and then every CHECKS_CACHE_MS instead of only once — otherwise the panel only
 * ever updates on a full page reload or a switch between top-level shells (the only things that remount SystemStatus). A tick
 * always hits the network (bypassing the cache, which only exists to dedupe *mount*-time reads) and updates silently: it never
 * re-arms the pending/"Checking…" state or flips to "Unavailable" on its own — only the very first read, or a Retry of it, does
 * that. One flaky tick shouldn't blank out a perfectly good last-known reading; the next one 30s later just tries again. The first
 * read and a Retry have the 30 second limit (`pollRead`): a server that does not answer ends in "Unavailable" and an offer to ask
 * again, not in "Checking…" for ever. `retry` is busy for at least 400ms, so a retry that fails at once still shows that it ran.
 */
function useSetupChecks(enabled: boolean) {
  const [checks, setChecks] = useState<SetupChecksResponse | null>(
    checksCache && checksCache.expiresAt > Date.now() ? checksCache.data : null,
  );
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const retryBusy = useMinimumBusy(retrying);
  // Asks again, for the Retry of a first read that failed or ran out of time (set by the effect that owns the reads).
  const retryRef = useRef<() => Promise<void>>(NO_RETRY);

  useEffect(() => {
    if (!enabled) return;
    const state = newPollState();
    const read = (silent: boolean, byRetry: boolean): Promise<void> => {
      // A Retry keeps the failure on screen, with its busy button, until the answer is in.
      if (!silent && !byRetry) setFailed(false);
      return pollRead(
        state,
        silent,
        fetchSetupChecks,
        (data) => {
          setChecks(data);
          setFailed(false);
          checksCache = { data, expiresAt: Date.now() + CHECKS_CACHE_MS };
        },
        () => setFailed(true),
      );
    };
    retryRef.current = () => read(false, true);
    // The mount-time read is served from the cache while it is fresh; a Retry and a tick always ask.
    if (checksCache && checksCache.expiresAt > Date.now()) setChecks(checksCache.data);
    else void read(false, false);
    const intervalId = setInterval(() => void read(true, false), CHECKS_CACHE_MS);
    return () => {
      retryRef.current = NO_RETRY;
      stopPolling(state, intervalId);
    };
  }, [enabled]);

  const retry = useCallback(() => {
    setRetrying(true);
    return retryRef.current().finally(() => setRetrying(false));
  }, []);
  return { checks, failed, retry, retrying: retryBusy };
}

/**
 * What the first read of the event's own mail transport has said, read the same way (a superadmin in an event only). `null`
 * until it has settled, or for another event than the one in view: a read for another event is never taken for this one's.
 */
function useEventMailRead(enabled: boolean, eventId: string | undefined): EventMailRead | null {
  const [read, setRead] = useState<EventMailRead | null>(
    eventId && eventMailCache?.eventId === eventId && eventMailCache.expiresAt > Date.now()
      ? { eventId, summary: eventMailCache.data }
      : null,
  );

  useEffect(() => {
    if (!enabled || !eventId) {
      setRead(null);
      return;
    }
    const currentEventId = eventId;
    const state = newPollState();
    const readOnce = (silent: boolean): Promise<void> =>
      pollRead(
        state,
        silent,
        (signal) => fetchEventMailSettings(currentEventId, signal),
        (data) => {
          const summary = summarizeEventMail(data);
          setRead({ eventId: currentEventId, summary });
          eventMailCache = { eventId: currentEventId, data: summary, expiresAt: Date.now() + CHECKS_CACHE_MS };
        },
        // Only the initial (non-silent) read fails closed to "no event-level answer" — mailerRow then falls back to the
        // org-level mailerStatus prop, same as before this row existed (also when it ran out of its 30 seconds). A tick
        // failing just keeps the last-known value on screen and retries next tick, rather than flickering back to the
        // org-level fallback.
        () => setRead({ eventId: currentEventId, summary: null }),
      );
    // The mount-time read is served from the cache while it is fresh; a tick always asks.
    if (eventMailCache?.eventId === currentEventId && eventMailCache.expiresAt > Date.now()) {
      setRead({ eventId: currentEventId, summary: eventMailCache.data });
    } else {
      void readOnce(false);
    }
    const intervalId = setInterval(() => void readOnce(true), CHECKS_CACHE_MS);
    return () => stopPolling(state, intervalId);
  }, [enabled, eventId]);

  return read;
}

/**
 * The Retry of the checks, as a row of the menu itself: the menu moves focus over its `menuitem`s with the arrow keys, Home and
 * End, so a button that is not one would be reached only by going backwards with Shift+Tab. Busy like `<Button loading>`: it is
 * `aria-disabled` (never `disabled`, which would drop the focus of the button that has just been pressed), swallows the click
 * while it works, and shows a spinner in place of its icon.
 */
function CheckAgainItem({ busy, onCheck }: Readonly<{ busy: boolean; onCheck: () => void }>) {
  return (
    <button
      type="button"
      role="menuitem"
      className="user-menu__item sys-status__check-again"
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) onCheck();
      }}
    >
      <span className="user-menu__item-icon">
        {busy ? <Spinner size="sm" aria-hidden="true" /> : <i className="ti ti-refresh" aria-hidden="true" />}
      </span>
      <span className="user-menu__item-text">
        <strong>Check again</strong>
        <span>The system checks did not answer</span>
      </span>
    </button>
  );
}

/** Topbar system-health dropdown, trimmed to what's actionable day-to-day: Database/Session
 * storage/Data encryption/Background worker are superadmin-only, matching `GET
 * /api/admin/setup/checks`'s own server-side authorization (the endpoint also returns a
 * `base_url` check, used by the setup wizard, but this component doesn't render or factor it
 * into `worst` — Instance URL is a one-time-setup concern, not an ongoing health signal).
 * Background worker *is* rendered and does factor into `worst` — unlike Instance URL, it's an
 * ongoing signal the Health check tab already tracks, and leaving it off here is exactly what
 * let this pill show "All systems normal" while that tab showed a stale worker. Email sending
 * isn't gated by anything and shows for every role, since operators and admins rely on it too.
 * Check-in connection state has its own dedicated banner on the Check-in page and operator
 * picker instead of a row here — see `checkin/ConnectionBanner.tsx`. When there's nothing to
 * show (e.g. a non-superadmin on a route where mailer status hasn't reached this session
 * either), the trigger renders nothing rather than a misleading "All systems normal" over an
 * empty panel. */
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
  const { open, setOpen, close, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>({
    align: "end",
    gap: 8,
  });
  const superadmin = isSuperadmin(assignments);
  const { checks, failed: checksFailed, retry: checkAgain, retrying: checkingAgain } = useSetupChecks(superadmin);
  const eventMailRead = useEventMailRead(superadmin, eventId);
  // The panel exists only while it is open, so a failure that arises in the background is said by a region that is always there
  // (and said again, as a new element, when a retry ends with the checks still not answering).
  const checkAgainEnds = useBusyEndCount(checkingAgain);

  // What was read for another event is not this event's answer. A superadmin in an event has no answer for its Email sending row
  // until the read of that event has settled (answered, failed or ran out of time).
  const eventMailAnswer = eventMailRead?.eventId === eventId ? eventMailRead : null;
  const eventMailPending = superadmin && Boolean(eventId) && eventMailAnswer === null;
  const mailer = mailerRow(mailerStatus, eventMailAnswer?.summary ?? null, eventMailPending);
  const rows = statusRows(superadmin, checks, checksFailed, mailer);

  const verdict = worstRowState(rows);
  // No verdict yet is not "All systems normal" (a slow or failing backend would keep saying so while it hangs). The trigger holds
  // its room, invisible, for the first 200ms, so a quick answer shows only the verdict; a "Checking systems…" that did appear
  // stays for at least 400ms (AGENTS.md "Admin SPA loading and busy states").
  const gate = useLoadingGate(verdict === "pending");
  const worst: RowState = gate.showContent ? verdict : "pending";

  if (rows.length === 0) return null;

  // Only the superadmin's "View system logs" row is an actionable menuitem — for every
  // other role the panel is purely informational, so it shouldn't claim ARIA menu
  // semantics (useDropdownMenu's focus-management already no-ops safely either way, but a
  // screen reader announcing "menu" with zero menuitem children is an invalid structure).
  const hasMenuItem = superadmin;

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        type="button"
        className={worst === "pending" && !gate.showIndicator ? "sys-status__trigger at-loading-hold" : "sys-status__trigger"}
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
      {superadmin && (
        <div key={checkAgainEnds} className="sr-only" role="alert">
          {checksFailed ? CHECKS_FAILED_TEXT : ""}
        </div>
      )}
      {open && (
        <div
          className="user-menu__panel sys-status__panel"
          role={hasMenuItem ? "menu" : "group"}
          aria-label={hasMenuItem ? undefined : "System status"}
          ref={panelRef}
          style={panelStyle}
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
              <RowCheck state={row.state} />
            </div>
          ))}
          {superadmin && (
            <>
              <div className="user-menu__divider" />
              {/* The rows above say "Unavailable"; this offers to ask again (the poll does so every 30 seconds by itself). */}
              {checksFailed && <CheckAgainItem busy={checkingAgain} onCheck={() => void checkAgain()} />}
              <button
                type="button"
                role="menuitem"
                className="user-menu__item"
                onClick={() => {
                  close();
                  void navigate(`${SETTINGS_INDEX_PATH}?tab=health`);
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
                  void navigate(`${SETTINGS_INDEX_PATH}?tab=logs`);
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
