import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, Card, EmptyState, PageHeader, Select, Skeleton, TICKET_TYPE_COLORS, useToast } from "@admitto/ui";
import {
  ApiError,
  eventReportsPrintUrl,
  exportEventReportsCsv,
  fetchEventReports,
  fetchTicketTypes,
} from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventReportsResponse, RsvpStatus, TicketTypeDto } from "../api/types.js";
import { RSVP_LABELS, RSVP_VARIANTS } from "../attendees/rsvpStatusBadge.js";
import { TicketTypeBadge } from "../attendees/ticketTypeBadge.js";
import { isAdmitDedupHit, registerAdmitDedup } from "../checkin/admitDedup.js";
import { useDropdownMenu } from "../components/useDropdownMenu.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { useEventStream, type StreamCheckinEvent } from "../hooks/useEventStream.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import { calendarDateInZone, formatEventDateTime, formatEventTime } from "../utils/event-dates.js";
import "./reports-page.css";

const LOG_PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const LOG_PAGE_SIZE_DEFAULT = 50;
const REPORT_SUBTITLE = "Admission statistics and event-day analytics";

const STATUS_DOT_COLOR: Record<"neutral" | "ok" | "warn" | "error", string> = {
  neutral: "var(--at-gray-400)",
  ok: "var(--status-ok)",
  warn: "var(--status-warn)",
  error: "var(--status-error)",
};

const CHECKIN_METHOD_LABELS: Record<"scan" | "manual", string> = {
  scan: "QR scan",
  manual: "Manual search",
};
const CHECKIN_METHOD_COLOR: Record<"scan" | "manual", string> = {
  scan: "var(--primary)",
  manual: "var(--status-info)",
};

type ExportFormat = "csv" | "pdf";

const EXPORT_FORMATS: { key: ExportFormat; label: string; icon: string; hint: string }[] = [
  { key: "csv", label: "CSV", icon: "file-text", hint: "Raw data, opens in Excel/Sheets" },
  { key: "pdf", label: "PDF", icon: "file-type-pdf", hint: "Formatted summary for sharing" },
];

interface ReportsExportMenuProps {
  readonly exporting: boolean;
  readonly disabled: boolean;
  readonly onExport: (format: ExportFormat) => void;
}

/** Single "Export report" entry point for CSV/PDF, replacing two separate buttons - same
 * useDropdownMenu-backed pattern as the Attendees list's own Export menu. */
function ReportsExportMenu({ exporting, disabled, onExport }: Readonly<ReportsExportMenuProps>) {
  const { open, setOpen, close, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>();

  return (
    <div className="reports-export-menu" ref={rootRef}>
      <Button
        ref={triggerRef}
        type="button"
        variant="secondary"
        icon={<i className="ti ti-download" aria-hidden="true" />}
        hasMenu
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || exporting}
        onClick={() => setOpen((current) => !current)}
      >
        {exporting ? "Exporting…" : "Export report"}
      </Button>
      {open && (
        <div className="reports-export-menu__panel" role="menu" ref={panelRef}>
          {EXPORT_FORMATS.map((format) => (
            <button
              key={format.key}
              type="button"
              role="menuitem"
              className="reports-export-menu__item"
              onClick={() => {
                close();
                onExport(format.key);
              }}
            >
              <span className="reports-export-menu__item-icon">
                <i className={`ti ti-${format.icon}`} aria-hidden="true" />
              </span>
              <span className="reports-export-menu__item-text">
                <strong>{format.label}</strong>
                <span>{format.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function admissionLogSpansMultipleDates(
  log: EventReportsResponse["admission_log"],
  timeZone: string,
): boolean {
  const dates = new Set(log.map((row) => calendarDateInZone(row.admitted_at, timeZone)));
  return dates.size > 1;
}

function formatAdmittedTime(iso: string, timeZone: string, includeDate: boolean): string {
  if (includeDate) return formatEventDateTime(iso, timeZone);
  return formatEventTime(iso, timeZone);
}

interface ReportStatProps {
  readonly icon: ReactNode;
  readonly variant: "neutral" | "ok" | "warn" | "info";
  readonly value: string;
  readonly label: string;
  readonly sub: string;
}

/** Reports-page-scoped KPI tile - deliberately not the shared @admitto/ui `Stat` component,
 * which is used on 6 other pages and stays out of scope for this redesign. */
function ReportStat({ icon, variant, value, label, sub }: ReportStatProps) {
  return (
    <div className="reports-stat">
      <div className={`reports-stat__icon reports-stat__icon--${variant}`} aria-hidden="true">
        {icon}
      </div>
      <div className="reports-stat__body">
        <span className="reports-stat__value">{value}</span>
        <span className="reports-stat__label">{label}</span>
        <span className="reports-stat__sub">{sub}</span>
      </div>
    </div>
  );
}

// The mockup's own example window (08-16) is 9 hours - a couple of widely-spaced check-ins
// padded by just 1 hour on each side (#383) rendered as a handful of bars adrift in a wide
// card, so sparse data now pads out symmetrically to this same minimum width instead, capped
// at the actual 24-hour array bounds.
const MIN_VISIBLE_HOURS = 9;

function visibleHourRange(byHour: EventReportsResponse["by_hour"]): EventReportsResponse["by_hour"] {
  const nonZero = byHour.filter((row) => row.count > 0);
  if (nonZero.length === 0) return byHour;

  const firstIdx = byHour.indexOf(nonZero[0]!);
  const lastIdx = byHour.indexOf(nonZero.at(-1)!);
  let start = Math.max(0, firstIdx - 1);
  let end = Math.min(byHour.length - 1, lastIdx + 1);

  while (end - start + 1 < MIN_VISIBLE_HOURS && (start > 0 || end < byHour.length - 1)) {
    if (start > 0) start -= 1;
    if (end - start + 1 >= MIN_VISIBLE_HOURS) break;
    if (end < byHour.length - 1) end += 1;
  }

  return byHour.slice(start, end + 1);
}

function HourlyChart({
  byHour,
  peakHour,
}: Readonly<{ byHour: EventReportsResponse["by_hour"]; peakHour: string | null }>) {
  const visible = visibleHourRange(byHour);
  const max = Math.max(...visible.map((row) => row.count), 1);
  // Bars start at 0 height and grow into place once mounted, rather than snapping straight to
  // their final height - a double rAF (not a single one) guarantees the browser has actually
  // painted the 0% state before the CSS transition below has something to animate from.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(raf2);
    });
    return () => cancelAnimationFrame(raf1);
  }, []);

  return (
    <div>
      <div className="reports-chart" aria-hidden="true">
        {visible.map((row, index) => {
          const isPeak = row.hour === peakHour;
          return (
            <div key={row.hour} className="reports-chart__bar-wrap">
              <div className={`reports-chart__count${isPeak ? " reports-chart__count--peak" : ""}`}>
                {row.count > 0 ? row.count : ""}
              </div>
              <div className="reports-chart__track">
                <div
                  className={`reports-chart__bar${isPeak ? " reports-chart__bar--peak" : ""}`}
                  style={{
                    height: mounted ? `${(row.count / max) * 100}%` : "0%",
                    transitionDelay: `${Math.min(index * 25, 300)}ms`,
                  }}
                />
              </div>
              <div className={`reports-chart__label${isPeak ? " reports-chart__label--peak" : ""}`}>
                {row.hour.slice(0, 2)}
              </div>
            </div>
          );
        })}
      </div>
      <table className="sr-only">
        <caption>Hourly admissions</caption>
        <thead>
          <tr>
            <th scope="col">Hour</th>
            <th scope="col">Admissions</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.hour}>
              <td>{row.hour}</td>
              <td>{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Sentinel select/key value for the "(none)" bucket - <select> options (and React list keys) are
 * always strings, but a row's ticket_type (and its matching by_ticket_type entry) can genuinely
 * be null. Real keys are always rendered/matched with a "type:" prefix (below) so this sentinel
 * can never collide with an actual stored ticket_type value - including an unmatched/legacy one,
 * which (unlike a catalog-created key) isn't constrained to the slugified key format and could in
 * principle be any string, e.g. literally "__none__" or "none" (Codex review). */
const NONE_TYPE_KEY = "__none__";

function encodeTypeFilterValue(key: string | null): string {
  return key === null ? NONE_TYPE_KEY : `type:${key}`;
}

const NONE_DEVICE_KEY = "__none_device__";

function encodeDeviceFilterValue(deviceId: string | null): string {
  return deviceId === null ? NONE_DEVICE_KEY : `device:${deviceId}`;
}

interface BreakdownRow {
  readonly id: string;
  readonly label: string;
  readonly meta: string;
  readonly pct: number;
  readonly color: string;
}

/** Shared dot + name + meta text + progress-bar row, reused by the ticket-type, attendance
 * confirmation, and check-in method breakdown cards. `meta` is caller-formatted display text
 * (a "3/4 (75%)" fraction for ticket type, a "18 · 4%" count for the other two) rather than a
 * fixed shape, since each card's real-world meaning of the number differs. */
function BreakdownRows({ rows }: Readonly<{ rows: BreakdownRow[] }>) {
  // Same grow-on-mount treatment as the hourly chart's bars - a double rAF guarantees the
  // browser has painted the 0%-width state before the CSS transition has something to animate
  // from, rather than snapping straight to each row's final width.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(raf2);
    });
    return () => cancelAnimationFrame(raf1);
  }, []);

  if (rows.length === 0) {
    return <p className="reports-muted">No data yet.</p>;
  }

  return (
    <div className="reports-breakdown-list">
      {rows.map((row, index) => (
        <div key={row.id} className="reports-breakdown-row">
          <div className="reports-breakdown-row__head">
            <span className="reports-breakdown-row__dot" style={{ background: row.color }} aria-hidden="true" />
            <span className="reports-breakdown-row__name">{row.label}</span>
            <span className="reports-breakdown-row__meta">{row.meta}</span>
          </div>
          <div className="reports-breakdown-row__track">
            <div
              style={{
                width: mounted ? `${row.pct}%` : "0%",
                transitionDelay: `${Math.min(index * 25, 300)}ms`,
                background: row.color,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ticketTypeBreakdownRows(rows: EventReportsResponse["by_ticket_type"]): BreakdownRow[] {
  return rows.map((row) => {
    const swatch = TICKET_TYPE_COLORS[row.color] ?? TICKET_TYPE_COLORS.gray;
    return {
      id: encodeTypeFilterValue(row.key),
      label: row.type,
      meta: `${row.admitted}/${row.total} (${row.admission_pct}%)`,
      pct: row.admission_pct,
      color: swatch.solid,
    };
  });
}

/** Always renders all 5 RSVP statuses (even at 0), in RSVP_LABELS' own order, so the card reads
 * as a complete status breakdown rather than only whichever buckets happen to have admissions. */
function rsvpBreakdownRows(
  byRsvpStatus: EventReportsResponse["by_rsvp_status"],
  admitted: number,
): BreakdownRow[] {
  const countByStatus = new Map(byRsvpStatus.map((row) => [row.status, row.count]));
  return (Object.keys(RSVP_LABELS) as RsvpStatus[]).map((status) => {
    const count = countByStatus.get(status) ?? 0;
    const pct = admitted > 0 ? Math.round((count / admitted) * 100) : 0;
    return {
      id: status,
      label: RSVP_LABELS[status],
      meta: `${count} · ${pct}%`,
      pct,
      color: STATUS_DOT_COLOR[RSVP_VARIANTS[status]],
    };
  });
}

/** "scan"/"manual" are the only two check-in sources that represent an admission method - see
 * the matching backend filter in reports-routes.ts. */
function checkinMethodBreakdownRows(
  byCheckinMethod: EventReportsResponse["by_checkin_method"],
  admitted: number,
): BreakdownRow[] {
  const countByMethod = new Map(byCheckinMethod.map((row) => [row.method, row.count]));
  return (["scan", "manual"] as const).map((method) => {
    const count = countByMethod.get(method) ?? 0;
    const pct = admitted > 0 ? Math.round((count / admitted) * 100) : 0;
    return {
      id: method,
      label: CHECKIN_METHOD_LABELS[method],
      meta: `${count} · ${pct}%`,
      pct,
      color: CHECKIN_METHOD_COLOR[method],
    };
  });
}

/** Ranked by admissions handled, not a fixed category set like the two breakdowns above - device
 * labels are free text an operator chose (DeviceLabelStep), so one consistent color reads better
 * than implying a categorical meaning between rows. */
function deviceBreakdownRows(
  byDevice: EventReportsResponse["by_device"],
  admitted: number,
): BreakdownRow[] {
  return byDevice.map((row) => {
    const pct = admitted > 0 ? Math.round((row.count / admitted) * 100) : 0;
    return {
      id: row.device_id ?? "__unlabeled__",
      label: row.device_id ?? "(unlabeled device)",
      meta: `${row.count} · ${pct}%`,
      pct,
      color: "var(--primary)",
    };
  });
}

interface AdmissionLogProps {
  readonly eventId: string;
  readonly log: EventReportsResponse["admission_log"];
  readonly byTicketType: EventReportsResponse["by_ticket_type"];
  readonly byDevice: EventReportsResponse["by_device"];
  readonly ticketTypes: TicketTypeDto[];
  readonly timeZone: string;
  readonly truncated: boolean;
  readonly totalAdmitted: number;
}

function AdmissionLog({
  eventId,
  log,
  byTicketType,
  byDevice,
  ticketTypes,
  timeZone,
  truncated,
  totalAdmitted,
}: AdmissionLogProps) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [deviceFilter, setDeviceFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(LOG_PAGE_SIZE_DEFAULT);
  const isDesktop = useIsDesktop();
  // Own trigger+panel dropdown, same mechanism as the Export menu above and Attendees' own
  // "Filters" button (AttendeesTable.tsx's FilterToolbar) - splitting the selects out of the
  // card header into a floating panel keeps the header a single row at any viewport, instead of
  // wrapping or squeezing selects inline on narrow screens.
  const { open: filtersOpen, setOpen: setFiltersOpen, rootRef, triggerRef, panelRef } =
    useDropdownMenu<HTMLButtonElement, HTMLFieldSetElement>();

  const includeAdmissionDate = useMemo(
    () => admissionLogSpansMultipleDates(log, timeZone),
    [log, timeZone],
  );

  let filtered = log;
  if (typeFilter === NONE_TYPE_KEY) {
    filtered = filtered.filter((row) => row.ticket_type === null);
  } else if (typeFilter !== "all") {
    filtered = filtered.filter((row) => encodeTypeFilterValue(row.ticket_type) === typeFilter);
  }
  if (deviceFilter === NONE_DEVICE_KEY) {
    filtered = filtered.filter((row) => row.device_id === null);
  } else if (deviceFilter !== "all") {
    filtered = filtered.filter((row) => encodeDeviceFilterValue(row.device_id) === deviceFilter);
  }
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Derived, not stored - if a live reconcile (ADR 0014) shrinks the filtered set out from
  // under a page 2+ view (e.g. an admission gets revoked elsewhere while an operator is
  // filtered/paged in), this clamps back to the last real page instead of slicing past the
  // end and showing "No admissions match the filter" despite matching rows still existing.
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const activeFilterCount = (typeFilter !== "all" ? 1 : 0) + (deviceFilter !== "all" ? 1 : 0);

  return (
    <Card
      title="Admission log"
      padded={false}
      actions={
        <div className="reports-log-filters-menu" ref={rootRef}>
          <Button
            ref={triggerRef}
            type="button"
            variant="secondary"
            size="sm"
            icon={<i className="ti ti-filter" aria-hidden="true" />}
            hasMenu
            aria-haspopup="true"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((current) => !current)}
          >
            Filters
            {activeFilterCount > 0 && (
              <span className="reports-log-filters-menu__count">{activeFilterCount}</span>
            )}
          </Button>
          {filtersOpen && (
            <fieldset className="reports-log-filters-menu__panel" ref={panelRef}>
              <legend className="sr-only">Filters</legend>
              <div className="reports-log-filters-menu__field">
                <Select
                  id="reports-log-ticket-type-filter"
                  aria-label="Filter by ticket type"
                  value={typeFilter}
                  onChange={(e) => {
                    setTypeFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">All ticket types</option>
                  {byTicketType.map((row) => (
                    <option key={encodeTypeFilterValue(row.key)} value={encodeTypeFilterValue(row.key)}>
                      {row.type}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="reports-log-filters-menu__field">
                <Select
                  id="reports-log-device-filter"
                  aria-label="Filter by device"
                  value={deviceFilter}
                  onChange={(e) => {
                    setDeviceFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">All devices</option>
                  {byDevice.map((row) => (
                    <option
                      key={encodeDeviceFilterValue(row.device_id)}
                      value={encodeDeviceFilterValue(row.device_id)}
                    >
                      {row.device_id ?? "(unlabeled device)"}
                    </option>
                  ))}
                </Select>
              </div>
            </fieldset>
          )}
        </div>
      }
    >
      {truncated && (
        <p className="reports-log-truncated">
          Showing the first {log.length} of {totalAdmitted} admissions. Export CSV for the full log
          (up to 10,000 rows).
        </p>
      )}
      {isDesktop ? (
        <div className="reports-log-table-wrap">
          <table className="reports-log-table">
            <thead>
              <tr>
                <th>Attendee</th>
                <th>Ticket type</th>
                <th>Admitted at</th>
                <th>Device</th>
                <th>Items</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((row) => (
                <tr key={row.attendee_id}>
                  <td>
                    <Link
                      to={`/admin/events/${eventId}/attendees/${row.attendee_id}`}
                      className="reports-log-user reports-log-user-link"
                    >
                      <strong>{row.name}</strong>
                      <span className="reports-mono reports-muted">{row.email}</span>
                    </Link>
                  </td>
                  <td>
                    {row.ticket_type === null ? (
                      <Badge variant="neutral">(none)</Badge>
                    ) : (
                      <TicketTypeBadge ticketType={row.ticket_type} catalog={ticketTypes} />
                    )}
                  </td>
                  <td className="reports-mono">
                    {formatAdmittedTime(row.admitted_at, timeZone, includeAdmissionDate)}
                  </td>
                  <td className="reports-muted">{row.device_id ?? "—"}</td>
                  <td className="reports-muted">{row.items.length > 0 ? row.items.join(", ") : "—"}</td>
                </tr>
              ))}
              {paged.length === 0 && (
                <tr>
                  <td colSpan={5} className="reports-log-empty">
                    No admissions match the filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="reports-log-cards">
          {paged.map((row) => (
            <Link
              key={row.attendee_id}
              to={`/admin/events/${eventId}/attendees/${row.attendee_id}`}
              className="reports-log-card"
            >
              <div className="reports-log-card__top">
                <span className="reports-log-card__name">{row.name}</span>
                <span className="reports-log-card__time reports-mono">
                  {formatAdmittedTime(row.admitted_at, timeZone, includeAdmissionDate)}
                </span>
              </div>
              <div className="reports-log-card__meta">
                {row.ticket_type === null ? (
                  <Badge variant="neutral">(none)</Badge>
                ) : (
                  <TicketTypeBadge ticketType={row.ticket_type} catalog={ticketTypes} />
                )}
                {/* Icon-prefixed, not bare text - two plain <span>s back to back (e.g.
                    "scanner-01 Badge, Gift bag") read as one ambiguous string with nothing
                    marking where the device label ends and the issued items begin (PO review). */}
                <span className="reports-log-card__meta-item">
                  <i className="ti ti-device-desktop" aria-hidden="true" />
                  {row.device_id ?? "—"}
                </span>
                <span className="reports-log-card__meta-item">
                  <i className="ti ti-package" aria-hidden="true" />
                  {row.items.length > 0 ? row.items.join(", ") : "—"}
                </span>
              </div>
            </Link>
          ))}
          {paged.length === 0 && <p className="reports-log-empty">No admissions match the filter.</p>}
        </div>
      )}
      <div className="reports-log-foot">
        <span className="reports-muted">
          Showing {paged.length} of {total}
        </span>
        <div className="reports-log-foot__controls">
          <label className="reports-log-pagesize">
            <span>Rows per page</span>
            <select
              className="at-select reports-log-pagesize-select"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {LOG_PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          {total > pageSize && (
            <div className="reports-log-pager">
              <Button
                variant="secondary"
                size="sm"
                disabled={safePage === 1}
                onClick={() => setPage((current) => current - 1)}
              >
                Previous
              </Button>
              <span>
                Page {safePage} of {totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={safePage >= totalPages}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Handles a `fetchEventReports` failure for `ReportsPage.loadData`: aborts are ignored, API
 * errors are reported to the connection state and mapped to operator-facing copy (redirecting to
 * login on 401), and anything else falls back to a generic message. Extracted purely to keep
 * `loadData`'s cognitive complexity within the allowed threshold - behavior is unchanged. */
function handleLoadDataError(
  err: unknown,
  reportApiError: (status: number) => void,
  setData: (data: EventReportsResponse | null) => void,
  setError: (message: string | null) => void,
): void {
  if (err instanceof DOMException && err.name === "AbortError") return;
  setData(null);
  if (!(err instanceof ApiError)) {
    setError("Failed to load report.");
    return;
  }
  reportApiError(err.status);
  if (err.status === 401) {
    const next = encodeURIComponent(window.location.pathname);
    window.location.assign(`/login?next=${next}`);
    return;
  }
  setError(err.status === 403 ? "You do not have access to this event." : operatorApiErrorMessage(err, "Request failed."));
}

export function ReportsPage() {
  const { eventId } = useParams();
  const { addToast } = useToast();
  const { reportApiError } = useConnectionState();
  const abortRef = useRef<AbortController | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  const [data, setData] = useState<EventReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [ticketTypes, setTicketTypes] = useState<TicketTypeDto[]>([]);
  // Live check-ins (ADR 0014) bump these two counters immediately for visual feedback, then a
  // debounced reconcile fetch replaces `data` wholesale with the server's real aggregates (chart,
  // breakdowns, admission log) - recomputing all of that from individual SSE events client-side
  // isn't worth the complexity, same call EventOverviewPage already made for its own live feed.
  const [optimisticAdmittedDelta, setOptimisticAdmittedDelta] = useState(0);
  const seenCheckinsRef = useRef(new Map<string, number>());
  const reconcileTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!eventId) return;
    // Cleared immediately, not just on settle - otherwise an admission log row whose key exists
    // in both the old and new event's catalogs could briefly resolve against the previous event's
    // label/color while this fetch is still in flight (Codex review), same fix already applied to
    // CommunicationSendDialog/EventSettingsPage for the same stale-catalog-on-switch pattern.
    setTicketTypes([]);
    let cancelled = false;
    fetchTicketTypes(eventId)
      .then((types) => {
        if (!cancelled) setTicketTypes(types);
      })
      .catch(() => {
        if (!cancelled) setTicketTypes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const loadData = useCallback(async () => {
    if (!eventId) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);
    try {
      const report = await fetchEventReports(eventId, ac.signal);
      if (ac.signal.aborted) return;
      setData(report);
      setOptimisticAdmittedDelta(0);
    } catch (err) {
      handleLoadDataError(err, reportApiError, setData, setError);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [eventId, reportApiError]);

  useEffect(() => {
    void loadData();
    return () => abortRef.current?.abort();
  }, [loadData]);

  useEffect(() => () => exportAbortRef.current?.abort(), []);

  // Silent background refresh - unlike loadData above, this never toggles `loading`/`error`, so a
  // live check-in mid-session doesn't flash the whole page back to its skeleton state.
  const scheduleReconcile = useCallback(() => {
    if (!eventId) return;
    if (reconcileTimerRef.current != null) window.clearTimeout(reconcileTimerRef.current);
    reconcileTimerRef.current = window.setTimeout(() => {
      reconcileTimerRef.current = null;
      fetchEventReports(eventId)
        .then((report) => {
          setData(report);
          setOptimisticAdmittedDelta(0);
        })
        .catch(() => {
          /* keep the optimistic count until the next live event or a manual retry */
        });
    }, 3000);
  }, [eventId]);

  const handleLiveCheckin = useCallback(
    (checkin: StreamCheckinEvent) => {
      if (isAdmitDedupHit(seenCheckinsRef.current, checkin.attendeeId, checkin.admittedAt)) return;
      registerAdmitDedup(seenCheckinsRef.current, checkin.attendeeId, checkin.admittedAt);
      setOptimisticAdmittedDelta((delta) => delta + 1);
      scheduleReconcile();
    },
    [scheduleReconcile],
  );

  useEventStream(eventId, handleLiveCheckin);

  useEffect(
    () => () => {
      if (reconcileTimerRef.current != null) window.clearTimeout(reconcileTimerRef.current);
    },
    [],
  );

  const handleExportCsv = useCallback(async () => {
    if (!eventId || exportingCsv) return;

    exportAbortRef.current?.abort();
    const ac = new AbortController();
    exportAbortRef.current = ac;

    setExportingCsv(true);
    try {
      await exportEventReportsCsv(eventId, ac.signal);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof ApiError) {
        reportApiError(err.status);
        if (err.status === 401) {
          const next = encodeURIComponent(window.location.pathname);
          window.location.assign(`/login?next=${next}`);
          return;
        }
        addToast(operatorApiErrorMessage(err, "Request failed."), "error");
      } else {
        addToast("Export failed", "error");
      }
    } finally {
      if (!ac.signal.aborted) setExportingCsv(false);
    }
  }, [eventId, exportingCsv, addToast, reportApiError]);

  const handleExportPdf = useCallback(() => {
    if (!eventId) return;
    window.open(eventReportsPrintUrl(eventId), "_blank", "noopener,noreferrer");
  }, [eventId]);

  const handleExport = useCallback(
    (format: ExportFormat) => {
      if (format === "csv") void handleExportCsv();
      else handleExportPdf();
    },
    [handleExportCsv, handleExportPdf],
  );

  if (!eventId) return <p>Missing event.</p>;

  // Optimistic delta from live SSE check-ins (ADR 0014) folded into the two counters it affects,
  // so the KPI row ticks up in real time instead of waiting ~3s for the reconcile fetch. Clamped
  // so a duplicate-delivery edge case can't show negative no-shows before the reconcile corrects
  // it. `data` can still be null here (still loading) - the values are only read once the summary
  // render branch below already guards on `data` being present.
  const liveAdmitted = (data?.summary.admitted ?? 0) + optimisticAdmittedDelta;
  const liveNoShows = Math.max(0, (data?.summary.no_shows ?? 0) - optimisticAdmittedDelta);
  const liveRatePct =
    data && data.summary.total_attendees > 0
      ? Math.round((liveAdmitted / data.summary.total_attendees) * 1000) / 10
      : (data?.summary.admission_rate_pct ?? 0);
  // Same 1-decimal-place rounding as liveRatePct above - was Math.round(x*100) here (whole
  // percent only), a cosmetic mismatch against Admitted's own rate line right next to it.
  const liveNoShowRatePct =
    data && data.summary.total_attendees > 0
      ? Math.round((liveNoShows / data.summary.total_attendees) * 1000) / 10
      : 0;

  return (
    <div className="screen reports-page">
      <PageHeader
        title="Reports"
        subtitle={REPORT_SUBTITLE}
        actions={
          <ReportsExportMenu
            exporting={exportingCsv}
            disabled={loading || !!error}
            onExport={handleExport}
          />
        }
      />

      {loading && (
        <div className="reports-loading">
          <div className="reports-stats-grid">
            {[1, 2, 3, 4].map((key) => (
              <Skeleton key={key} variant="rect" height={100} />
            ))}
          </div>
          <Skeleton variant="rect" height={160} className="reports-loading__chart" />
        </div>
      )}

      {!loading && error && (
        <EmptyState
          icon={<i className="ti ti-alert-triangle" aria-hidden="true" />}
          title="Failed to load report"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void loadData()}>
              Retry
            </Button>
          }
        />
      )}

      {!loading && !error && data?.summary.admitted === 0 && (
        <EmptyState
          icon={<i className="ti ti-chart-bar-off" aria-hidden="true" />}
          title="No check-ins yet"
          description="Reports will appear here once attendees start checking in."
        />
      )}

      {!loading && !error && data && data.summary.admitted > 0 && (
        <>
          <div className="reports-stats-grid">
            <Card>
              <ReportStat
                variant="neutral"
                icon={<i className="ti ti-users" aria-hidden="true" />}
                value={data.summary.total_attendees.toString()}
                label="Total attendees"
                sub={
                  data.event.capacity != null
                    ? `of ${data.event.capacity} capacity`
                    : "No capacity set"
                }
              />
            </Card>
            <Card>
              <ReportStat
                variant="ok"
                icon={<i className="ti ti-circle-check" aria-hidden="true" />}
                value={liveAdmitted.toString()}
                label="Admitted"
                sub={`${liveRatePct}% admission rate`}
              />
            </Card>
            <Card>
              <ReportStat
                variant="warn"
                icon={<i className="ti ti-circle-x" aria-hidden="true" />}
                value={liveNoShows.toString()}
                label="No-shows"
                sub={`${liveNoShowRatePct}% of total`}
              />
            </Card>
            <Card>
              <ReportStat
                variant="info"
                icon={<i className="ti ti-clock" aria-hidden="true" />}
                value={data.summary.peak_hour ?? "—"}
                label="Peak hour"
                sub={
                  data.summary.peak_hour
                    ? `${data.summary.peak_hour_count} admissions`
                    : "No check-ins yet"
                }
              />
            </Card>
          </div>

          <div className="reports-panels">
            <Card
              title={`Hourly admissions (${data.timezone})`}
              actions={
                <Badge variant="ok" dot className="overview-live-badge">
                  live
                </Badge>
              }
            >
              <HourlyChart byHour={data.by_hour} peakHour={data.summary.peak_hour} />
            </Card>
            <Card title="By ticket type">
              <BreakdownRows rows={ticketTypeBreakdownRows(data.by_ticket_type)} />
            </Card>
          </div>

          <h2 className="reports-section-title">Check-in details</h2>
          <div className="reports-grid-3">
            <Card title="Attendance confirmation">
              <BreakdownRows rows={rsvpBreakdownRows(data.by_rsvp_status, data.summary.admitted)} />
            </Card>
            <Card title="Check-in method">
              <BreakdownRows
                rows={checkinMethodBreakdownRows(data.by_checkin_method, data.summary.admitted)}
              />
            </Card>
            <Card title="By device">
              <BreakdownRows rows={deviceBreakdownRows(data.by_device, data.summary.admitted)} />
            </Card>
          </div>

          <AdmissionLog
            key={data.event.id}
            eventId={eventId}
            log={data.admission_log}
            byTicketType={data.by_ticket_type}
            byDevice={data.by_device}
            ticketTypes={ticketTypes}
            timeZone={data.timezone}
            truncated={data.admission_log_truncated}
            totalAdmitted={data.admission_log_total}
          />
        </>
      )}
    </div>
  );
}
