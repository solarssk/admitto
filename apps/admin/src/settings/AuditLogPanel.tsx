import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge, Button, Card, EmptyState, Tooltip, useToast, type BadgeVariant } from "@admitto/ui";
import { exportAuditLog, fetchAdminEvents, fetchAuditLog } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { AuditLogEntryDto, EventDto } from "../api/types.js";
import { DatePicker } from "../components/DatePicker.js";
import { Segmented, type SegmentedOption } from "../components/Segmented.js";
import { useClickOutside } from "../components/useClickOutside.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { formatEventDateTime, formatUtcDateTime, utcDayEndIso, utcDayStartIso } from "../utils/event-dates.js";

/** Human-readable labels for `AdminAuditLog.action_type` (current + planned IAM types). */
const ACTION_LABELS: Record<string, string> = {
  account_mfa_enrolled: "2FA enrolled (self-service)",
  account_mfa_reset: "2FA reset (self-service)",
  account_password_changed: "Password changed (self-service)",
  account_session_revoked: "Session revoked (self-service)",
  attendee_created_manual: "Attendee created manually",
  attendee_erased: "Attendee erased (GDPR)",
  attendees_bulk_erased: "Attendees bulk erased (GDPR)",
  audit_log_exported: "Audit log exported",
  emergency_session_purge: "Emergency session purge",
  event_archived: "Event archived",
  event_checkins_bulk_revoked: "Event check-ins bulk revoked",
  event_contact_created: "Event contact added",
  event_contact_deleted: "Event contact removed",
  event_contact_updated: "Event contact updated",
  event_created: "Event created",
  event_deleted: "Event deleted",
  event_items_bulk_revoked: "Event items bulk revoked",
  event_mail_settings_cleared: "Event mail settings cleared",
  event_mail_settings_updated: "Event mail settings updated",
  event_mail_transport_tested: "Event mail transport tested",
  event_pii_exported: "Event PII exported",
  event_pinned_note_cleared: "Event pinned note cleared",
  event_pinned_note_set: "Event pinned note set",
  event_resource_created: "Event resource added",
  event_resource_deleted: "Event resource removed",
  event_resource_updated: "Event resource updated",
  event_unarchived: "Event unarchived",
  event_updated: "Event updated",
  mail_settings_updated: "Mail settings updated",
  mail_transport_tested: "Mail transport tested",
  operator_sessions_bulk_revoked: "Operator sessions revoked",
  retention_run: "Retention job run",
  role_granted: "Role granted",
  role_revoked: "Role revoked",
  session_revoked: "Session revoked",
  system_settings_updated: "System settings updated",
  user_created: "User created",
  user_deactivated: "User deactivated",
  user_mfa_reset: "2FA reset",
  user_password_reset: "Password reset",
  user_reactivated: "User reactivated",
  user_sessions_revoked: "User sessions revoked",
};

/** Map a raw action_type to a display label, falling back to the raw value. */
function actionLabel(type: string): string {
  return ACTION_LABELS[type] ?? type;
}

/** Badge tone per action type - destructive/revoking actions read as `error`, permission/role
 * changes as `info`, everything else (the vast majority: routine creates/updates/tests) stays
 * the Badge default `neutral` and isn't listed here. */
const TONE_BY_ADMIN_ACTION: Record<string, BadgeVariant> = {
  account_session_revoked: "error",
  attendee_erased: "error",
  attendees_bulk_erased: "error",
  emergency_session_purge: "error",
  event_checkins_bulk_revoked: "error",
  event_contact_deleted: "error",
  event_deleted: "error",
  event_items_bulk_revoked: "error",
  event_resource_deleted: "error",
  operator_sessions_bulk_revoked: "error",
  role_revoked: "error",
  session_revoked: "error",
  user_deactivated: "error",
  user_sessions_revoked: "error",
  role_granted: "info",
  system_settings_updated: "info",
};

function actionTone(type: string): BadgeVariant {
  return TONE_BY_ADMIN_ACTION[type] ?? "neutral";
}

const ACTION_OPTIONS = Object.keys(ACTION_LABELS).sort((a, b) =>
  actionLabel(a).localeCompare(actionLabel(b)),
);

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

/** Short label for an IANA timezone (e.g. "Warsaw" from "Europe/Warsaw"). */
function tzShortLabel(tz: string): string {
  return tz.split("/").pop()?.replaceAll("_", " ") ?? tz;
}

/** Entry's own local time + short tz label, for rows written from a browser request (the
 * `X-Client-Timezone` header) - null for rows predating the column or written from a
 * non-browser path (CLI), which have no timezone to show. */
function actorLocalTime(entry: AuditLogEntryDto): string | null {
  if (!entry.actor_timezone) return null;
  return `${formatEventDateTime(entry.created_at, entry.actor_timezone)} (${tzShortLabel(entry.actor_timezone)})`;
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

/** Event id an entry is scoped to, if any - writers use either an `eventId` or a legacy
 * `event_id` metadata key (see audit-routes.ts), so both are checked here. Undefined for
 * genuinely instance-wide actions (settings, sessions, users, roles). */
function entryEventId(entry: AuditLogEntryDto): string | undefined {
  const meta = entry.metadata;
  if (!meta) return undefined;
  const id = meta.eventId ?? meta.event_id;
  return typeof id === "string" ? id : undefined;
}

/** "Instance" for instance-wide actions, the event's title when known, or a short fallback for
 * an event that's since been deleted (the audit row outlives the event it refers to). */
function scopeLabel(entry: AuditLogEntryDto, eventTitleById: Map<string, string>): string {
  const eventId = entryEventId(entry);
  if (!eventId) return "Instance";
  return eventTitleById.get(eventId) ?? "Deleted event";
}

const SCOPE_HINT = "Which event this action affected, or “Instance” for account/organization-wide changes not tied to one event.";

/** camelCase or snake_case metadata key -> "Title case" label (e.g. "event_id"/"eventId" -> "Event id"). */
function humanizeMetadataKey(key: string): string {
  const spaced = key
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Best-effort readable rendering of one metadata value - primitives as-is, arrays of objects
 * reduced to whichever field a human would recognize (name/email/id), everything else falls
 * back to compact JSON rather than guessing at a structure this can't know about. */
function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          return String(obj.name ?? obj.email ?? obj.id ?? JSON.stringify(item));
        }
        return String(item);
      })
      .join(", ");
  }
  return JSON.stringify(value);
}

// Already shown by the Scope column - repeating it in Details would just be noise.
const METADATA_KEYS_SHOWN_ELSEWHERE = new Set(["eventId", "event_id"]);

/** True when metadata has at least one key worth rendering in the Details column, beyond what
 * the Scope column already covers. */
function hasVisibleMetadata(metadata: Record<string, unknown> | null): boolean {
  if (!metadata) return false;
  return Object.keys(metadata).some((key) => !METADATA_KEYS_SHOWN_ELSEWHERE.has(key));
}

// Matches .audit-log-details__panel's max-height (12rem) and gap (--space-1) in
// staff.css — used to decide above-vs-below placement before the panel exists to measure.
const DETAILS_PANEL_MAX_HEIGHT_PX = 192;
const DETAILS_PANEL_GAP_PX = 4;

/**
 * Details cell — shows metadata as a humanized label/value list in a small popover instead of
 * an inline `<details>` block, so opening it never changes the table row's height or pushes
 * other rows around. Positioned `fixed` from the trigger's own rect (recomputed on
 * open/resize/scroll, same technique as DatePicker) so it floats over the page instead of being
 * clipped by the table's horizontal scroll wrapper, which forces a matching `overflow-y` per the
 * CSS spec. Flips above the trigger when there isn't room below, so a row near the bottom of the
 * viewport doesn't push the panel off-screen.
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

  if (!hasVisibleMetadata(metadata)) return <>—</>;
  const rows = Object.entries(metadata!).filter(([key]) => !METADATA_KEYS_SHOWN_ELSEWHERE.has(key));
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
        <dl
          className="audit-log-details__panel audit-log-details__list"
          style={{ top: pos.top, bottom: pos.bottom, right: pos.right }}
        >
          {rows.map(([key, value]) => (
            <div key={key} className="audit-log-details__row">
              <dt>{humanizeMetadataKey(key)}</dt>
              <dd>{formatMetadataValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

type LogsView = "system" | "audit";

const LOGS_VIEW_OPTIONS: ReadonlyArray<SegmentedOption<LogsView>> = [
  { value: "system", label: "System", disabled: true },
  { value: "audit", label: "Audit" },
];

/** Superadmin audit log viewer — read-only paginated table with action and date filters. */
export function AuditLogPanel() {
  const [view, setView] = useState<LogsView>("audit");
  const [entries, setEntries] = useState<AuditLogEntryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [filters, setFilters] = useState({ actionType: "", eventId: "", start: "", end: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<EventDto[]>([]);
  const [exporting, setExporting] = useState(false);
  const { addToast } = useToast();
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

  // Loaded once, independent of the audit log's own pagination/filters - only used to resolve
  // an entry's eventId to a human title (Scope column, "All events" filter). Includes archived
  // events (an archived event can still have recent audit history) but not deleted ones, which
  // fall back to scopeLabel's "Deleted event".
  useEffect(() => {
    const ac = new AbortController();
    fetchAdminEvents({ includeArchived: true, signal: ac.signal })
      .then(setEvents)
      .catch(() => {
        /* best-effort: Scope falls back to "Deleted event" for any id it can't resolve */
      });
    return () => ac.abort();
  }, []);
  const eventTitleById = useMemo(() => new Map(events.map((e) => [e.id, e.title])), [events]);

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

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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
          pageSize,
          actionType: filters.actionType || undefined,
          eventId: filters.eventId || undefined,
          start: filters.start ? utcDayStartIso(filters.start) : undefined,
          end: filters.end ? utcDayEndIso(filters.end) : undefined,
        },
        ac.signal,
      );
      if (ac.signal.aborted) return;
      const maxPage = Math.max(1, Math.ceil(data.total / pageSize));
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
  }, [page, pageSize, filters.actionType, filters.eventId, filters.start, filters.end]);

  useEffect(() => {
    void load();
    return () => loadAbortRef.current?.abort();
  }, [load]);

  const clearFilters = () => {
    setFilters({ actionType: "", eventId: "", start: "", end: "" });
    setPage(1);
  };

  const hasActiveFilters = useMemo(
    () => !!(filters.actionType || filters.eventId || filters.start || filters.end),
    [filters.actionType, filters.eventId, filters.start, filters.end],
  );

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await exportAuditLog({
        actionType: filters.actionType || undefined,
        eventId: filters.eventId || undefined,
        start: filters.start ? utcDayStartIso(filters.start) : undefined,
        end: filters.end ? utcDayEndIso(filters.end) : undefined,
      });
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to export audit log."), "error");
    } finally {
      setExporting(false);
    }
  }, [filters.actionType, filters.eventId, filters.start, filters.end, addToast]);

  const showLoadingSkeleton = useDelayedLoading(loading);

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
      <EmptyState
        title="Could not load audit log"
        description={error}
        action={
          <Button type="button" variant="secondary" onClick={() => void load()}>
            Retry
          </Button>
        }
      />
    );
  } else if (entries.length === 0) {
    listContent =
      total > 0 ? (
        <EmptyState title="No entries on this page." description="Try Previous, or adjust the filters." />
      ) : hasActiveFilters ? (
        <EmptyState
          icon={<i className="ti ti-filter-off" aria-hidden="true" />}
          title="No matches"
          description="Try different filters, or clear them to see everything."
        />
      ) : (
        <EmptyState
          icon={<i className="ti ti-history" aria-hidden="true" />}
          title="No audit log entries yet"
          description="Actions taken across Settings will appear here."
        />
      );
  } else {
    listContent = (
      <div className="sessions-table-wrap">
        <table className="table audit-log-table">
          <thead>
            <tr>
              <th scope="col">Time (UTC)</th>
              <th scope="col">Action</th>
              <th scope="col">
                <Tooltip content={SCOPE_HINT}>
                  Scope <i className="ti ti-info-circle" aria-hidden="true" />
                </Tooltip>
              </th>
              <th scope="col">Actor</th>
              <th scope="col">IP</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>
                  {formatUtcDateTime(entry.created_at)}
                  {actorLocalTime(entry) && (
                    <div className="sessions-subdued">{actorLocalTime(entry)}</div>
                  )}
                </td>
                <td>
                  <Badge variant={actionTone(entry.action_type)}>{actionLabel(entry.action_type)}</Badge>
                </td>
                <td>{scopeLabel(entry, eventTitleById)}</td>
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
    <Card
      title="Audit log"
      actions={
        <>
          <Segmented ariaLabel="Logs view" value={view} onChange={setView} options={LOGS_VIEW_OPTIONS} />
          <Button type="button" variant="secondary" disabled={exporting} onClick={() => void handleExport()}>
            {exporting ? "Exporting…" : "Export"}
          </Button>
        </>
      }
    >
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
          <span className="audit-log-filter__label">Scope</span>
          <select
            className="at-select"
            value={filters.eventId}
            onChange={(e) => {
              setFilters((f) => ({ ...f, eventId: e.target.value }));
              setPage(1);
            }}
          >
            <option value="">All events</option>
            {[...events]
              .sort((a, b) => a.title.localeCompare(b.title))
              .map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
                </option>
              ))}
          </select>
        </label>
        <div className="audit-log-filter">
          <DatePicker
            label="From"
            value={filters.start}
            onChange={(next) => {
              setFilters((f) => ({ ...f, start: next }));
              setPage(1);
            }}
          />
        </div>
        <div className="audit-log-filter">
          <DatePicker
            label="To"
            value={filters.end}
            onChange={(next) => {
              setFilters((f) => ({ ...f, end: next }));
              setPage(1);
            }}
          />
        </div>
        {hasActiveFilters && (
          <Button type="button" variant="secondary" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {listContent}

      {!loading && !error && total > 0 && (
        <div className="audit-log-footer">
          <span className="audit-log-footer__info">
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="audit-log-footer__buttons">
            <label className="audit-log-pagesize">
              <span>Rows per page</span>
              <select
                className="at-select audit-log-pagesize-select"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
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
