import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import { getCountryForTimezone } from "countries-and-timezones";
import { Badge, Button, Card, EmptyState, Input, Tooltip, useToast, type BadgeVariant } from "@admitto/ui";
import { exportAuditLog, fetchAdminEvents, fetchAuditLog } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { AuditLogEntryDto, EventDto } from "../api/types.js";
import { DatePicker } from "../components/DatePicker.js";
import { FiltersMenu } from "../components/FiltersMenu.js";
import { Segmented, type SegmentedOption } from "../components/Segmented.js";
import { useClickOutside } from "../components/useClickOutside.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import { localeDateInputPattern, utcDayEndIso, utcDayStartIso } from "../utils/event-dates.js";
import { getPreferredLocale } from "../utils/locale-store.js";
import { MAIL_PROVIDER_LABELS } from "./mailProviderOptions.js";
import { SystemLogsPanel, type SystemLogsPanelHandle } from "./SystemLogsPanel.js";

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
const SEARCH_DEBOUNCE_MS = 300;

/** Short label for an IANA timezone (e.g. "Warsaw" from "Europe/Warsaw"). */
function tzShortLabel(tz: string): string {
  return tz.split("/").pop()?.replaceAll("_", " ") ?? tz;
}

/** "Warsaw, Poland" when the timezone resolves to a single country (almost always true for a
 * real IANA zone), otherwise just the city - a bare city name alone doesn't tell a non-local
 * reader which country it's in. */
function tzPlaceLabel(tz: string): string {
  const city = tzShortLabel(tz);
  const country = getCountryForTimezone(tz)?.name;
  return country ? `${city}, ${country}` : city;
}

/** UTC instant as "YYYY-MM-DD HH:MM:SS" - `created_at` is already an ISO string in UTC, so this
 * is just trimming it, matching the mockup's compact monospace time format exactly. */
function formatAuditPrimaryTime(iso: string): string {
  return iso.slice(0, 19).replace("T", " ");
}

/** Entry's own local time, for rows written from a browser request (the `X-Client-Timezone`
 * header) - null for rows predating the column or written from a non-browser path (CLI), which
 * have no timezone to show. Same locale + `timeZoneName: "short"` as formatEventTime/
 * formatEventDateTime (event-dates.ts) - the app has one standard for tz abbreviations
 * (CEST/EST, not a raw GMT offset), and this should read the same way as everywhere else. */
function actorLocalTime(entry: AuditLogEntryDto): string | null {
  if (!entry.actor_timezone) return null;
  const parts = new Intl.DateTimeFormat(getPreferredLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: entry.actor_timezone,
    timeZoneName: "short",
  }).formatToParts(new Date(entry.created_at));
  const hhmm = `${parts.find((p) => p.type === "hour")?.value}:${parts.find((p) => p.type === "minute")?.value}`;
  const abbr = parts.find((p) => p.type === "timeZoneName")?.value ?? entry.actor_timezone;
  return `${hhmm} ${abbr} (${tzPlaceLabel(entry.actor_timezone)})`;
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
const TIME_HINT = "Top: when this happened, in UTC. Below: the same moment in the actor's own local time, when known.";

/** camelCase or snake_case metadata key -> "Title case" label (e.g. "event_id"/"eventId" -> "Event id"). */
function humanizeMetadataKey(key: string): string {
  const spaced = key
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// These specific keys (mail settings changes) carry arrays of raw form-field names
// (e.g. "fromAddress") as their values, not display-ready text - humanize each item the same
// way a metadata *key* would be, rather than showing the camelCase identifier as-is.
const ARRAY_ITEMS_ARE_FIELD_NAMES = new Set(["fields_changed", "secrets_rotated", "secrets_cleared"]);

/** Best-effort readable rendering of one metadata value - primitives as-is, arrays of objects
 * reduced to whichever field a human would recognize (name/email/id), everything else falls
 * back to compact JSON rather than guessing at a structure this can't know about. */
function formatMetadataValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  // "provider" here is always the mail transport enum (mail_settings_updated/
  // event_mail_settings_updated) - show the same label the Mail settings picker itself uses
  // (e.g. "export_only" -> "Export only") instead of the raw config value.
  if (key === "provider" && typeof value === "string" && value in MAIL_PROVIDER_LABELS) {
    return MAIL_PROVIDER_LABELS[value as keyof typeof MAIL_PROVIDER_LABELS];
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    const humanizeItems = ARRAY_ITEMS_ARE_FIELD_NAMES.has(key);
    return value
      .map((item) => {
        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          const identifier = [obj.name, obj.email, obj.id].find(
            (v): v is string | number => typeof v === "string" || typeof v === "number",
          );
          return identifier === undefined ? JSON.stringify(item) : String(identifier);
        }
        if (humanizeItems && typeof item === "string") return humanizeMetadataKey(item);
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

/** Plain-text rendering of one full row - Time/Action/Scope/Actor/IP plus any visible Details,
 * for the row-level "copy" affordance (a non-technical operator sharing one entry over chat
 * shouldn't have to screenshot a table). */
function buildRowSummary(entry: AuditLogEntryDto, eventTitleById: Map<string, string>): string {
  const localTime = actorLocalTime(entry);
  const localTimeSuffix = localTime ? ` (${localTime})` : "";
  const actorEmailSuffix = entry.actor_display_name && entry.actor_email ? ` (${entry.actor_email})` : "";
  const lines = [
    `Time: ${formatAuditPrimaryTime(entry.created_at)} UTC${localTimeSuffix}`,
    `Action: ${actionLabel(entry.action_type)}`,
    `Scope: ${scopeLabel(entry, eventTitleById)}`,
    `Actor: ${actorDisplay(entry)}${actorEmailSuffix}`,
    `IP: ${entry.ip ?? "—"}`,
  ];
  if (hasVisibleMetadata(entry.metadata)) {
    lines.push("Details:");
    for (const [key, value] of Object.entries(entry.metadata!)) {
      if (METADATA_KEYS_SHOWN_ELSEWHERE.has(key)) continue;
      lines.push(`  ${humanizeMetadataKey(key)}: ${formatMetadataValue(key, value)}`);
    }
  }
  return lines.join("\n");
}

// Matches .audit-log-details__panel's max-height (12rem) and gap (--space-1) in
// staff.css — used to decide above-vs-below placement before the panel exists to measure.
const DETAILS_PANEL_MAX_HEIGHT_PX = 192;
const DETAILS_PANEL_GAP_PX = 4;
// Matches .audit-log-details__panel's max-width (22rem) - the panel is right-anchored from
// the trigger, which works fine on a wide desktop row, but a mobile card's trigger sits close
// to the left edge itself; using this as the worst-case width to clamp against guarantees the
// panel's own left edge never goes past the viewport, even before the real (max-content, so
// possibly narrower) width is known.
const DETAILS_PANEL_MAX_WIDTH_PX = 352;
const DETAILS_PANEL_EDGE_MARGIN_PX = 8;

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
      const naturalRight = window.innerWidth - rect.right;
      const maxRight = window.innerWidth - DETAILS_PANEL_MAX_WIDTH_PX - DETAILS_PANEL_EDGE_MARGIN_PX;
      const right = Math.max(DETAILS_PANEL_EDGE_MARGIN_PX, Math.min(naturalRight, maxRight));
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
              <dd>{formatMetadataValue(key, value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

interface AuditLogRowsProps {
  entries: AuditLogEntryDto[];
  loading: boolean;
  eventTitleById: Map<string, string>;
  onCopyRow: (entry: AuditLogEntryDto) => Promise<void>;
}

/** Desktop row list - extracted from AuditLogPanel to keep that component's own cognitive
 * complexity within the shared lint budget; pure presentational, no state of its own. */
function AuditLogTable({ entries, loading, eventTitleById, onCopyRow }: Readonly<AuditLogRowsProps>) {
  return (
    <div className={`sessions-table-wrap${loading ? " audit-log-table-wrap--loading" : ""}`}>
      <table className="table audit-log-table">
        <thead>
          <tr>
            <th scope="col">
              <Tooltip content={TIME_HINT} className="audit-log-scope-header">
                Time <i className="ti ti-info-circle" aria-hidden="true" />
              </Tooltip>
            </th>
            <th scope="col">Action</th>
            <th scope="col">
              <Tooltip content={SCOPE_HINT} className="audit-log-scope-header">
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
              <td className="audit-log-time">
                {formatAuditPrimaryTime(entry.created_at)}
                {actorLocalTime(entry) && <div className="sessions-subdued">{actorLocalTime(entry)}</div>}
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
                <div className="audit-log-details-cell">
                  <DetailsCell metadata={entry.metadata} />
                  <button
                    type="button"
                    className="audit-log-row-copy"
                    aria-label="Copy row"
                    onClick={() => void onCopyRow(entry)}
                  >
                    <i className="ti ti-copy" aria-hidden="true" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Mobile one-card-per-entry list - extracted alongside AuditLogTable for the same reason;
 * mirrors AttendeesTable's/ReportsPage's own desktop-table/mobile-card split. */
function AuditLogCards({ entries, loading, eventTitleById, onCopyRow }: Readonly<AuditLogRowsProps>) {
  return (
    <div className={`audit-log-cards${loading ? " audit-log-table-wrap--loading" : ""}`}>
      {entries.map((entry) => (
        <div key={entry.id} className="audit-log-card">
          <div className="audit-log-card__top">
            <Badge variant={actionTone(entry.action_type)}>{actionLabel(entry.action_type)}</Badge>
            <div className="audit-log-time audit-log-card__time">
              {formatAuditPrimaryTime(entry.created_at)}
              {actorLocalTime(entry) && <div className="sessions-subdued">{actorLocalTime(entry)}</div>}
            </div>
          </div>
          <div className="audit-log-card__meta">
            <span className="audit-log-card__meta-item">
              <i className="ti ti-calendar-event" aria-hidden="true" />
              {scopeLabel(entry, eventTitleById)}
            </span>
            <span className="audit-log-card__meta-item" title={actorTitle(entry)}>
              <i className="ti ti-user" aria-hidden="true" />
              {actorDisplay(entry)}
            </span>
            {entry.actor_display_name && entry.actor_email && (
              <div className="sessions-subdued audit-log-card__email">{entry.actor_email}</div>
            )}
          </div>
          <div className="audit-log-card__foot">
            <span>{entry.ip ?? "—"}</span>
            <div className="audit-log-details-cell">
              <DetailsCell metadata={entry.metadata} />
              <button
                type="button"
                className="audit-log-row-copy"
                aria-label="Copy row"
                onClick={() => void onCopyRow(entry)}
              >
                <i className="ti ti-copy" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

interface AuditLogListContentProps extends AuditLogRowsProps {
  isInitialLoad: boolean;
  showLoadingSkeleton: boolean;
  error: string | null;
  onRetry: () => void;
  total: number;
  hasActiveFilters: boolean;
  isDesktop: boolean;
}

/** Picks the loading skeleton / error / empty-state / table-or-cards branch - extracted
 * alongside AuditLogTable/AuditLogCards for the same cognitive-complexity reason; this whole
 * if-chain used to live directly inside AuditLogPanel. */
function AuditLogListContent({
  isInitialLoad,
  showLoadingSkeleton,
  error,
  onRetry,
  entries,
  total,
  hasActiveFilters,
  isDesktop,
  loading,
  eventTitleById,
  onCopyRow,
}: Readonly<AuditLogListContentProps>) {
  if (isInitialLoad) {
    // Reserve the skeleton's own height from the very first paint - navigating here from a
    // separate route (e.g. Identity, which unmounts this whole panel) re-triggers a genuine
    // first load, and rendering nothing at all while entries === [] let the card visibly
    // collapse then snap back once data arrived, reading as a flicker even on a fast fetch.
    // A fetch that resolves near-instantly (localhost, a warm cache) still shouldn't flash a
    // visible skeleton on and off - `visibility` (not conditional rendering) keeps the space
    // reserved throughout while only revealing it once loading has genuinely taken a moment.
    return (
      <div
        className="audit-log-skeleton"
        aria-busy={showLoadingSkeleton || undefined}
        aria-label="Loading audit log"
        style={{ visibility: showLoadingSkeleton ? "visible" : "hidden" }}
      >
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="audit-log-skeleton__row" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <EmptyState
        title="Could not load audit log"
        description={error}
        action={
          <Button type="button" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        }
      />
    );
  }
  if (entries.length === 0 && total > 0) {
    return <EmptyState title="No entries on this page." description="Try Previous, or adjust the filters." />;
  }
  if (entries.length === 0 && hasActiveFilters) {
    return (
      <EmptyState
        icon={<i className="ti ti-filter-off" aria-hidden="true" />}
        title="No matches"
        description="Try different filters, or clear them to see everything."
      />
    );
  }
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<i className="ti ti-history" aria-hidden="true" />}
        title="No audit log entries yet"
        description="Actions taken across Settings will appear here."
      />
    );
  }
  if (isDesktop) {
    return (
      <AuditLogTable entries={entries} loading={loading} eventTitleById={eventTitleById} onCopyRow={onCopyRow} />
    );
  }
  // Mobile: one card per entry instead of a horizontally-scrolling table, mirroring
  // AttendeesTable's/ReportsPage's own desktop-table/mobile-card split at the same
  // useIsDesktop() breakpoint.
  return <AuditLogCards entries={entries} loading={loading} eventTitleById={eventTitleById} onCopyRow={onCopyRow} />;
}

type AuditLogFilters = { actionType: string; eventId: string; search: string; start: string; end: string };

interface AuditLogViewProps {
  isDesktop: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
  searchInput: string;
  setSearchInput: Dispatch<SetStateAction<string>>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  fromDatePicker: ReactNode;
  toDatePicker: ReactNode;
  actionScopeActiveCount: number;
  filters: AuditLogFilters;
  setFilters: Dispatch<SetStateAction<AuditLogFilters>>;
  setPage: Dispatch<SetStateAction<number>>;
  events: EventDto[];
  clearFiltersButton: ReactNode;
  exportButton: ReactNode;
  listContent: ReactNode;
  loading: boolean;
  error: string | null;
  total: number;
  page: number;
  pageSize: number;
  setPageSize: Dispatch<SetStateAction<number>>;
  goToPage: (next: number) => void;
  totalPages: number;
}

/** The audit-side toolbar + list + footer - extracted from AuditLogPanel so that component can
 * stay a thin switch between this and SystemLogsPanel based on the System/Audit toggle. State
 * stays in AuditLogPanel; only the JSX moved here. */
function AuditLogView({
  isDesktop,
  rootRef,
  searchInput,
  setSearchInput,
  searchInputRef,
  fromDatePicker,
  toDatePicker,
  actionScopeActiveCount,
  filters,
  setFilters,
  setPage,
  events,
  clearFiltersButton,
  exportButton,
  listContent,
  loading,
  error,
  total,
  page,
  pageSize,
  setPageSize,
  goToPage,
  totalPages,
}: Readonly<AuditLogViewProps>) {
  return (
    <>
      <div ref={rootRef} className="audit-log-toolbar">
        <div className="audit-log-filter audit-log-filter--search">
          <Input
            ref={searchInputRef}
            id="audit-log-search"
            name="audit-log-search"
            aria-label="Search actor or event"
            placeholder="Search actor or event…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            icon={<i className="ti ti-search" aria-hidden="true" />}
          />
          {searchInput.length > 0 && (
            <button
              type="button"
              className="audit-log-search-clear"
              onClick={() => {
                setSearchInput("");
                searchInputRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          )}
        </div>
        {isDesktop && (
          <>
            <div className="audit-log-filter audit-log-filter--date">{fromDatePicker}</div>
            <div className="audit-log-filter audit-log-filter--date">{toDatePicker}</div>
          </>
        )}
        <FiltersMenu activeCount={actionScopeActiveCount} className="audit-log-filters-menu">
          {!isDesktop && (
            <>
              {/* Full width, one per row (not side by side) - the panel is only ~236px wide,
                  not enough room for both the "From (dd/mm/yyyy)" placeholder AND a sibling
                  field without clipping the text. */}
              <div className="audit-log-filters-menu__field">{fromDatePicker}</div>
              <div className="audit-log-filters-menu__field">{toDatePicker}</div>
            </>
          )}
          <div className="audit-log-filters-menu__field">
            <label className="audit-log-filter__label" htmlFor="audit-log-filter-action">
              Action
            </label>
            <select
              id="audit-log-filter-action"
              name="audit-log-filter-action"
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
          </div>
          <div className="audit-log-filters-menu__field">
            <label className="audit-log-filter__label" htmlFor="audit-log-filter-scope">
              Event
            </label>
            <select
              id="audit-log-filter-scope"
              name="audit-log-filter-scope"
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
          </div>
        </FiltersMenu>
        {!isDesktop && (
          <div className="audit-log-toolbar-actions">
            {clearFiltersButton}
            {exportButton}
          </div>
        )}
      </div>

      {listContent}

      {!loading && !error && total > 0 && (
        <div className="audit-log-footer">
          <span className="audit-log-footer__info">
            {`Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
          </span>
          <div className="audit-log-footer__pager">
            <div className="audit-log-pagesize">
              <label htmlFor="audit-log-pagesize-select">Rows per page</label>
              <select
                id="audit-log-pagesize-select"
                name="audit-log-pagesize-select"
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
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => goToPage(Math.max(1, page - 1))}
            >
              Previous
            </Button>
            <span>
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => goToPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

type LogsView = "system" | "audit";

const LOGS_VIEW_OPTIONS: ReadonlyArray<SegmentedOption<LogsView>> = [
  { value: "system", label: "System" },
  { value: "audit", label: "Audit" },
];

/** Superadmin audit log viewer — read-only paginated table with action and date filters. */
export function AuditLogPanel() {
  const [view, setView] = useState<LogsView>("system");
  // Mirrored up from SystemLogsPanel purely so the header's Live/Download buttons (which live
  // here, next to the System/Audit toggle, rather than being duplicated inside the panel) can
  // reflect its state - SystemLogsPanel itself remains the source of truth for both.
  const [systemLive, setSystemLive] = useState(true);
  const [systemHasEntries, setSystemHasEntries] = useState(false);
  const systemLogsRef = useRef<SystemLogsPanelHandle>(null);
  const [entries, setEntries] = useState<AuditLogEntryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [filters, setFilters] = useState<AuditLogFilters>({
    actionType: "",
    eventId: "",
    search: "",
    start: "",
    end: "",
  });
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<EventDto[]>([]);
  const [exporting, setExporting] = useState(false);
  const { addToast } = useToast();
  const isDesktop = useIsDesktop();
  const loadAbortRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Previous/Next can shrink the table (e.g. a shorter last page), which can
  // otherwise leave the card scrolled out of view — keep it in view once the
  // new page has actually rendered instead of letting Settings jump around.
  // Keyed to the load() call that armed it (not just loading/entries) so an
  // unrelated reload that happens to finish around the same time (a filter
  // change, Clear filters, Retry) doesn't also trigger a scroll it never asked for.
  const loadSeqRef = useRef(0);
  const scrollRestoreSeqRef = useRef<number | null>(null);
  // From/To no longer show a visible label above the field (PO: nothing above the date
  // selector) - the locale date format is folded into the placeholder instead, so the
  // dd/mm/yyyy-typing affordance survives without a separate label line pushing the row down.
  const datePattern = localeDateInputPattern();
  // Rendered in the main toolbar on desktop, or inside the Filters panel on mobile (see the
  // toolbar JSX below) - defined once here so both call sites share the exact same fields.
  const fromDatePicker = (
    <DatePicker
      ariaLabel="From"
      placeholder={`From (${datePattern})`}
      value={filters.start}
      onChange={(next) => {
        setFilters((f) => ({ ...f, start: next }));
        setPage(1);
      }}
    />
  );
  const toDatePicker = (
    <DatePicker
      ariaLabel="To"
      placeholder={`To (${datePattern})`}
      value={filters.end}
      onChange={(next) => {
        setFilters((f) => ({ ...f, end: next }));
        setPage(1);
      }}
    />
  );

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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((f) => ({ ...f, search: searchInput.trim() }));
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

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
          search: filters.search || undefined,
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
  }, [page, pageSize, filters.actionType, filters.eventId, filters.search, filters.start, filters.end]);

  useEffect(() => {
    void load();
    return () => loadAbortRef.current?.abort();
  }, [load]);

  const clearFilters = () => {
    setFilters({ actionType: "", eventId: "", search: "", start: "", end: "" });
    setSearchInput("");
    setPage(1);
  };

  const hasActiveFilters = useMemo(
    () => !!(filters.actionType || filters.eventId || filters.search || filters.start || filters.end),
    [filters.actionType, filters.eventId, filters.search, filters.start, filters.end],
  );

  // On mobile the date fields move into this same panel (see the toolbar JSX below), so an
  // active From/To should count toward the badge there too - on desktop they stay in the main
  // toolbar, always visible, so they'd double-count if included here as well.
  const activeDateCount = (filters.start ? 1 : 0) + (filters.end ? 1 : 0);
  const actionScopeActiveCount =
    (filters.actionType ? 1 : 0) + (filters.eventId ? 1 : 0) + (isDesktop ? 0 : activeDateCount);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await exportAuditLog({
        actionType: filters.actionType || undefined,
        eventId: filters.eventId || undefined,
        search: filters.search || undefined,
        start: filters.start ? utcDayStartIso(filters.start) : undefined,
        end: filters.end ? utcDayEndIso(filters.end) : undefined,
      });
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to export audit log."), "error");
    } finally {
      setExporting(false);
    }
  }, [filters.actionType, filters.eventId, filters.search, filters.start, filters.end, addToast]);

  // Rendered in the Card header on desktop, or in the toolbar (next to Filters) on mobile -
  // on a narrow card the header can only fit the title and the always-present System/Audit
  // toggle before wrapping to a second line, so these two move down into the toolbar instead.
  const clearFiltersButton = (
    <Button type="button" variant="secondary" size="sm" disabled={!hasActiveFilters} onClick={clearFilters}>
      Clear filters
    </Button>
  );
  const exportButton = (
    <Button type="button" variant="secondary" size="sm" disabled={exporting} onClick={() => void handleExport()}>
      {exporting ? "Exporting…" : "Export CSV"}
    </Button>
  );

  const handleCopyRow = useCallback(
    async (entry: AuditLogEntryDto) => {
      try {
        await navigator.clipboard.writeText(buildRowSummary(entry, eventTitleById));
        addToast("Row copied to clipboard", "success");
      } catch {
        addToast("Could not copy — clipboard access was blocked.", "error");
      }
    },
    [eventTitleById, addToast],
  );

  const showLoadingSkeleton = useDelayedLoading(loading);
  // A filter/page change re-fetches with the previous rows still on screen (never cleared at
  // the start of load()) - only the true first load (nothing to show yet) has no rows to keep
  // displaying, so only that case earns the skeleton; every later reload just dims the stale
  // table below instead of blanking it out from under the user (matches AttendeesTable).
  const isInitialLoad = loading && entries.length === 0;

  const listContent = (
    <AuditLogListContent
      isInitialLoad={isInitialLoad}
      showLoadingSkeleton={showLoadingSkeleton}
      error={error}
      onRetry={() => void load()}
      entries={entries}
      total={total}
      hasActiveFilters={hasActiveFilters}
      isDesktop={isDesktop}
      loading={loading}
      eventTitleById={eventTitleById}
      onCopyRow={handleCopyRow}
    />
  );

  // Built once, rendered either in the Card header (desktop) or passed down into
  // SystemLogsPanel's own toolbar (mobile, where the header only has room for the title and the
  // System/Audit toggle) - mirrors clearFiltersButton/exportButton's own dual placement above.
  const liveButton = (
    <Button
      type="button"
      variant={systemLive ? "success" : "secondary"}
      size="sm"
      onClick={() => systemLogsRef.current?.toggleLive()}
    >
      {systemLive ? "Live" : "Paused"}
    </Button>
  );
  const downloadButton = (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={!systemHasEntries}
      onClick={() => systemLogsRef.current?.download()}
    >
      Download .log
    </Button>
  );

  return (
    <Card
      title={view === "system" ? "System logs" : "Audit log"}
      className="audit-log-header-card"
      actions={
        <>
          {/* On mobile these two move down into the toolbar instead (next to Filters) - a
              narrow card header can only fit the title plus this always-present toggle before
              wrapping onto a second line. */}
          {isDesktop && view === "audit" && (
            <>
              {clearFiltersButton}
              {exportButton}
            </>
          )}
          {isDesktop && view === "system" && (
            <>
              {liveButton}
              {downloadButton}
            </>
          )}
          {/* Always last: with the actions row right-anchored, a trailing item's own edge
              stays flush against the card's right edge no matter how many of the preceding,
              view-dependent buttons are present - the one placement that's genuinely fixed. */}
          <Segmented
            ariaLabel="Logs view"
            value={view}
            onChange={setView}
            options={LOGS_VIEW_OPTIONS}
            className="audit-log-view-toggle"
          />
        </>
      }
    >
      {/* Both views stay mounted the whole time, toggled by visibility rather than by
          conditional rendering - switching the toggle used to unmount/remount whichever side
          you left, which meant losing all of System's polled state and re-fetching from
          scratch on every return trip (a visible flash even on a fast local request). Neither
          side's effects care that they're temporarily hidden - polling simply continues, so
          flipping back shows already-current data instead of an empty/loading flash. */}
      <div style={{ display: view === "system" ? undefined : "none" }}>
        <SystemLogsPanel
          ref={systemLogsRef}
          isDesktop={isDesktop}
          liveButton={!isDesktop ? liveButton : undefined}
          downloadButton={!isDesktop ? downloadButton : undefined}
          onLiveChange={setSystemLive}
          onHasEntriesChange={setSystemHasEntries}
        />
      </div>
      <div style={{ display: view === "audit" ? undefined : "none" }}>
        <AuditLogView
          isDesktop={isDesktop}
          rootRef={rootRef}
          searchInput={searchInput}
          setSearchInput={setSearchInput}
          searchInputRef={searchInputRef}
          fromDatePicker={fromDatePicker}
          toDatePicker={toDatePicker}
          actionScopeActiveCount={actionScopeActiveCount}
          filters={filters}
          setFilters={setFilters}
          setPage={setPage}
          events={events}
          clearFiltersButton={clearFiltersButton}
          exportButton={exportButton}
          listContent={listContent}
          loading={loading}
          error={error}
          total={total}
          page={page}
          pageSize={pageSize}
          setPageSize={setPageSize}
          goToPage={goToPage}
          totalPages={totalPages}
        />
      </div>
    </Card>
  );
}
