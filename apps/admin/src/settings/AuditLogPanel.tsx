import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Card } from "@admitto/ui";
import { fetchAuditLog } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { AuditLogEntryDto } from "../api/types.js";
import { Segmented } from "../components/Segmented.js";
import { useClickOutside } from "../components/useClickOutside.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { formatEventDateTime, formatUtcDateTime, utcDayEndIso, utcDayStartIso } from "../utils/event-dates.js";

type TimeMode = "utc" | "local";

const VIEWER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const TIME_MODE_OPTIONS: ReadonlyArray<{ value: TimeMode; label: string }> = [
  { value: "utc", label: "UTC" },
  { value: "local", label: "Local" },
];

/** Human-readable labels for `AdminAuditLog.action_type` (current + planned IAM types). */
const ACTION_LABELS: Record<string, string> = {
  account_mfa_enrolled: "2FA enrolled (self-service)",
  account_mfa_reset: "2FA reset (self-service)",
  account_password_changed: "Password changed (self-service)",
  account_session_revoked: "Session revoked (self-service)",
  attendee_created_manual: "Attendee created manually",
  attendee_erased: "Attendee erased (GDPR)",
  attendees_bulk_erased: "Attendees bulk erased (GDPR)",
  event_archived: "Event archived",
  event_created: "Event created",
  event_pii_exported: "Event PII exported",
  event_unarchived: "Event unarchived",
  event_updated: "Event updated",
  mail_settings_updated: "Mail settings updated",
  mail_transport_tested: "Mail transport tested",
  operator_sessions_bulk_revoked: "Operator sessions revoked",
  role_granted: "Role granted",
  role_revoked: "Role revoked",
  session_revoked: "Session revoked",
  system_settings_updated: "System settings updated",
  user_created: "User created",
  user_deactivated: "User deactivated",
  user_mfa_reset: "2FA reset",
  user_password_reset: "Password reset",
  user_reactivated: "User reactivated",
};

/** Map a raw action_type to a display label, falling back to the raw value. */
function actionLabel(type: string): string {
  return ACTION_LABELS[type] ?? type;
}

const ACTION_OPTIONS = Object.keys(ACTION_LABELS).sort((a, b) =>
  actionLabel(a).localeCompare(actionLabel(b)),
);

const PAGE_SIZE = 25;

/** Format an ISO timestamp for the audit log table in the selected time mode. */
function formatTimestamp(iso: string, mode: TimeMode): string {
  return mode === "utc" ? formatUtcDateTime(iso) : formatEventDateTime(iso, VIEWER_TZ);
}

/** Short label for the viewer's local timezone (e.g. "Warsaw" from "Europe/Warsaw"). */
function viewerTzLabel(): string {
  return VIEWER_TZ.split("/").pop()?.replaceAll("_", " ") ?? VIEWER_TZ;
}

/** Primary actor label; deleted users show a readable fallback (id in cell title). */
function actorDisplay(entry: AuditLogEntryDto): string {
  if (entry.actor_display_name) return entry.actor_display_name;
  if (entry.actor_email) return entry.actor_email;
  return "Deleted user";
}

/** Tooltip for actor cell when the backing user row no longer exists. */
function actorTitle(entry: AuditLogEntryDto): string | undefined {
  if (entry.actor_display_name || entry.actor_email) return undefined;
  return entry.actor_user_id;
}

/** True when metadata is a non-empty object worth rendering in the Details column. */
function hasMetadata(metadata: Record<string, unknown> | null): boolean {
  return !!metadata && Object.keys(metadata).length > 0;
}

/** Pretty-print audit metadata JSON for the Details popover. */
function metadataPreview(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata, null, 2);
}

// Matches .audit-log-details__panel's max-height (12rem) and gap (--space-1) in
// staff.css — used to decide above-vs-below placement before the panel exists to measure.
const DETAILS_PANEL_MAX_HEIGHT_PX = 192;
const DETAILS_PANEL_GAP_PX = 4;

/**
 * Details cell — shows metadata JSON in a small popover instead of an inline
 * `<details>` block, so opening it never changes the table row's height or
 * pushes other rows around. Positioned `fixed` from the trigger's own rect
 * (recomputed on open/resize/scroll, same technique as DatePicker) so it
 * floats over the page instead of being clipped by the table's horizontal
 * scroll wrapper, which forces a matching `overflow-y` per the CSS spec.
 * Flips above the trigger when there isn't room below, so a row near the
 * bottom of the viewport doesn't push the panel off-screen.
 */
function DetailsCell({ metadata }: Readonly<{ metadata: Record<string, unknown> | null }>) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useClickOutside(rootRef, open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const right = window.innerWidth - rect.right;
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < DETAILS_PANEL_MAX_HEIGHT_PX && rect.top > spaceBelow) {
        setPos({ bottom: window.innerHeight - rect.top + DETAILS_PANEL_GAP_PX, right });
      } else {
        setPos({ top: rect.bottom + DETAILS_PANEL_GAP_PX, right });
      }
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  if (!hasMetadata(metadata)) return <>—</>;
  return (
    <div ref={rootRef} className="audit-log-details">
      <button
        ref={triggerRef}
        type="button"
        className="audit-log-details__trigger"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        View
      </button>
      {open && pos && (
        <pre className="audit-log-details__panel" style={{ top: pos.top, bottom: pos.bottom, right: pos.right }}>
          {metadataPreview(metadata!)}
        </pre>
      )}
    </div>
  );
}

/** Superadmin audit log viewer — read-only paginated table with action and date filters. */
export function AuditLogPanel() {
  const [entries, setEntries] = useState<AuditLogEntryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [timeMode, setTimeMode] = useState<TimeMode>("utc");
  const [filters, setFilters] = useState({ actionType: "", start: "", end: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Previous/Next can shrink the table (e.g. a shorter last page), which can
  // otherwise leave the card scrolled out of view — keep it in view once the
  // new page has actually rendered instead of letting Settings jump around.
  // Keyed to the load() call that armed it (not just loading/entries) so an
  // unrelated reload that happens to finish around the same time (a filter
  // change, Clear filters, Retry) doesn't also trigger a scroll it never asked for.
  const loadSeqRef = useRef(0);
  const scrollRestoreSeqRef = useRef<number | null>(null);
  const goToPage = useCallback((next: number) => {
    scrollRestoreSeqRef.current = loadSeqRef.current + 1;
    setPage(next);
  }, []);

  useLayoutEffect(() => {
    if (!loading && scrollRestoreSeqRef.current !== null) {
      if (loadSeqRef.current === scrollRestoreSeqRef.current) {
        rootRef.current?.scrollIntoView({ block: "nearest" });
      }
      scrollRestoreSeqRef.current = null;
    }
  }, [loading, entries]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async () => {
    loadAbortRef.current?.abort();
    const ac = new AbortController();
    loadAbortRef.current = ac;
    loadSeqRef.current += 1;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAuditLog(
        {
          page,
          pageSize: PAGE_SIZE,
          actionType: filters.actionType || undefined,
          start: filters.start ? utcDayStartIso(filters.start) : undefined,
          end: filters.end ? utcDayEndIso(filters.end) : undefined,
        },
        ac.signal,
      );
      if (ac.signal.aborted) return;
      const maxPage = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
      if (page > maxPage) {
        setEntries([]);
        setPage(maxPage);
        return;
      }
      setEntries(data.entries);
      setTotal(data.total);
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(operatorApiErrorMessage(err, "Failed to load audit log."));
      setEntries([]);
      setTotal(0);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [page, filters.actionType, filters.start, filters.end]);

  useEffect(() => {
    void load();
    return () => loadAbortRef.current?.abort();
  }, [load]);

  const clearFilters = () => {
    setFilters({ actionType: "", start: "", end: "" });
    setPage(1);
  };

  const hasActiveFilters = useMemo(
    () => !!(filters.actionType || filters.start || filters.end),
    [filters.actionType, filters.start, filters.end],
  );

  const showLoadingSkeleton = useDelayedLoading(loading);

  let emptyMessage: string;
  if (total > 0) {
    emptyMessage = "No entries on this page.";
  } else if (hasActiveFilters) {
    emptyMessage = "No audit log entries match the filters.";
  } else {
    emptyMessage = "No audit log entries found.";
  }

  let listContent: ReactNode;
  if (loading) {
    // A fetch that resolves near-instantly (localhost, a warm cache) would otherwise flash
    // this skeleton on and off faster than it can register as loading — show it only once
    // the fetch has genuinely taken a moment.
    listContent = showLoadingSkeleton ? (
      <div className="audit-log-skeleton" aria-busy="true" aria-label="Loading audit log">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="audit-log-skeleton__row" />
        ))}
      </div>
    ) : null;
  } else if (error) {
    listContent = (
      <p className="audit-log-error">
        {error}{" "}
        <button type="button" className="settings-retry-link" onClick={() => void load()}>
          Retry
        </button>
      </p>
    );
  } else if (entries.length === 0) {
    listContent = <p className="audit-log-empty">{emptyMessage}</p>;
  } else {
    listContent = (
      <div className="sessions-table-wrap">
        <table className="table audit-log-table">
          <thead>
            <tr>
              <th scope="col">Time ({timeMode === "utc" ? "UTC" : viewerTzLabel()})</th>
              <th scope="col">Action</th>
              <th scope="col">Actor</th>
              <th scope="col">IP</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{formatTimestamp(entry.created_at, timeMode)}</td>
                <td>{actionLabel(entry.action_type)}</td>
                <td title={actorTitle(entry)}>
                  {actorDisplay(entry)}
                  {entry.actor_display_name && entry.actor_email && (
                    <div className="sessions-subdued">{entry.actor_email}</div>
                  )}
                </td>
                <td>{entry.ip ?? "—"}</td>
                <td>
                  <DetailsCell metadata={entry.metadata} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <Card title="Audit log">
      <div ref={rootRef} className="audit-log-toolbar">
        <label className="audit-log-filter">
          <span className="audit-log-filter__label">Action</span>
          <select
            className="at-select"
            value={filters.actionType}
            onChange={(e) => {
              setFilters((f) => ({ ...f, actionType: e.target.value }));
              setPage(1);
            }}
          >
            <option value="">All actions</option>
            {ACTION_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {actionLabel(type)}
              </option>
            ))}
          </select>
        </label>
        <label className="audit-log-filter">
          <span className="audit-log-filter__label">From</span>
          <input
            type="date"
            className="at-input"
            value={filters.start}
            onChange={(e) => {
              setFilters((f) => ({ ...f, start: e.target.value }));
              setPage(1);
            }}
          />
        </label>
        <label className="audit-log-filter">
          <span className="audit-log-filter__label">To</span>
          <input
            type="date"
            className="at-input"
            value={filters.end}
            onChange={(e) => {
              setFilters((f) => ({ ...f, end: e.target.value }));
              setPage(1);
            }}
          />
        </label>
        {hasActiveFilters && (
          <Button type="button" variant="secondary" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
        <Segmented
          ariaLabel="Time zone"
          value={timeMode}
          onChange={setTimeMode}
          options={TIME_MODE_OPTIONS}
        />
      </div>

      {listContent}

      {!loading && !error && total > 0 && (
        <div className="audit-log-footer">
          <span className="audit-log-footer__info">
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="audit-log-footer__buttons">
            <Button
              type="button"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => goToPage(Math.max(1, page - 1))}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => goToPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
