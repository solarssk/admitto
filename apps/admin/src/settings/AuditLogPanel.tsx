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
import { Badge, Button, Card, EmptyState, HintLabel, Input, Notice, useToast, type BadgeVariant } from "@admitto/ui";
import { exportAuditLog, exportSecurityAuditLog, fetchAdminEvents, fetchAuditLog, fetchSecurityAuditLog } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { AuditLogEntryDto, EventDto, SecurityAuditLogEntryDto } from "../api/types.js";
import { DatePicker } from "../components/DatePicker.js";
import { ActorOrViewerLocalTimeLine } from "../components/ActorOrViewerLocalTimeLine.js";
import { FiltersMenu } from "../components/FiltersMenu.js";
import { GeoCell, geoLocationText } from "../components/GeoCell.js";
import { PaginationFooter } from "../components/PaginationFooter.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { Segmented, type SegmentedOption } from "../components/Segmented.js";
import { useClickOutside } from "../components/useClickOutside.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import { localeDateInputPattern, utcDayEndIso, utcDayStartIso, zonedTimeLabel } from "../utils/event-dates.js";
import { getPreferredLocale } from "../utils/locale-store.js";
import { MAIL_PROVIDER_LABELS } from "./mailProviderOptions.js";
import { POLL_DEGRADED_THRESHOLD, POLL_INTERVAL_MS, SystemLogsPanel, type SystemLogsPanelHandle } from "./SystemLogsPanel.js";

/** Human-readable labels for `AdminAuditLog.action_type` (current + planned IAM types). */
const ACTION_LABELS: Record<string, string> = {
  account_mfa_enrolled: "2FA enrolled (self-service)",
  account_mfa_reset: "2FA reset (self-service)",
  account_password_changed: "Password changed (self-service)",
  account_session_revoked: "Session revoked (self-service)",
  account_sso_unlinked: "SSO unlinked (self-service)",
  attendee_created_manual: "Attendee created manually",
  attendee_erased: "Attendee erased (GDPR)",
  attendees_bulk_erased: "Attendees bulk erased (GDPR)",
  audit_log_exported: "Audit log exported",
  bounce_ingest_settings_tested: "Bounce detection connection tested",
  bounce_ingest_manual_run: "Bounce detection check run manually",
  bounce_ingest_settings_updated: "Bounce detection settings updated",
  branding_font_uploaded: "Branding font uploaded",
  emergency_session_purge: "Emergency session purge",
  event_archived: "Event archived",
  event_branding_uploaded: "Event branding uploaded",
  event_checkins_bulk_revoked: "Event check-ins bulk revoked",
  event_contact_created: "Event contact added",
  event_contact_deleted: "Event contact removed",
  event_contact_updated: "Event contact updated",
  event_created: "Event created",
  event_deleted: "Event deleted",
  event_items_bulk_revoked: "Event items bulk revoked",
  event_location_updated: "Event location updated",
  event_mail_bounce_probed: "Event bounce verification probed",
  event_mail_settings_cleared: "Event mail settings cleared",
  event_mail_settings_updated: "Event mail settings updated",
  event_mail_smtp_probed: "Event SMTP connection probed",
  event_mail_transport_tested: "Event mail transport tested",
  event_pii_exported: "Event PII exported",
  event_pinned_note_cleared: "Event pinned note cleared",
  event_pinned_note_set: "Event pinned note set",
  event_resource_created: "Event resource added",
  event_resource_deleted: "Event resource removed",
  event_resource_updated: "Event resource updated",
  event_unarchived: "Event unarchived",
  event_updated: "Event updated",
  identity_cf_access_updated: "Cloudflare Access settings updated",
  identity_provider_created: "SSO provider created",
  identity_provider_discovered: "SSO provider endpoints rediscovered",
  identity_provider_toggled: "SSO provider enabled/disabled",
  identity_provider_updated: "SSO provider updated",
  instance_setup_completed: "Instance setup completed",
  mail_settings_updated: "Mail settings updated",
  mail_smtp_probed: "SMTP connection probed",
  mail_transport_tested: "Mail transport tested",
  maps_settings_updated: "Maps settings updated",
  operator_sessions_bulk_revoked: "Operator sessions revoked",
  org_branding_logo_uploaded: "Organization branding logo uploaded",
  retention_run: "Retention job run",
  role_granted: "Role granted",
  role_changed: "Role changed",
  role_revoked: "Role revoked",
  security_audit_log_exported: "Security log exported",
  session_device_label_updated: "Session device label updated",
  session_revoked: "Session revoked",
  support_contact_updated: "Support contact updated",
  system_settings_updated: "System settings updated",
  user_created: "User created",
  user_deactivated: "User deactivated",
  user_deleted: "User deleted",
  user_email_changed: "User email changed",
  user_mfa_reset: "2FA reset",
  user_password_reset: "Password reset",
  user_profile_updated: "User profile updated",
  user_reactivated: "User reactivated",
  user_sessions_revoked: "User sessions revoked",
  weather_settings_updated: "Weather settings updated",
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
  user_deleted: "error",
  user_sessions_revoked: "error",
  role_granted: "info",
  role_changed: "info",
  system_settings_updated: "info",
  identity_provider_toggled: "info",
  identity_cf_access_updated: "info",
};

function actionTone(type: string): BadgeVariant {
  return TONE_BY_ADMIN_ACTION[type] ?? "neutral";
}

const ACTION_OPTIONS = Object.keys(ACTION_LABELS).sort((a, b) =>
  actionLabel(a).localeCompare(actionLabel(b)),
);

/** Human-readable labels for SecurityAuditLog.event_type (issue #473's durable auth/security
 * event trail) - distinct from AdminAuditLog.action_type's ACTION_LABELS above, since the two
 * tables track entirely different kinds of events (auth/session vs. admin mutations). */
const SECURITY_EVENT_LABELS: Record<string, string> = {
  "auth.login.success": "Login succeeded",
  "auth.login.fail": "Login failed",
  "auth.login.repeated_failures": "Repeated login failures",
  "auth.mfa.repeated_failures": "Repeated 2FA failures",
  "auth.mfa.success": "2FA verified",
  "auth.mfa.fail": "2FA failed",
  "auth.mfa.break_glass": "2FA break-glass override",
  "auth.superadmin.bootstrap": "Superadmin created (bootstrap)",
  "auth.mfa.recovery_consumed": "2FA recovery code used",
  "auth.logout": "Logged out",
  "auth.oidc.success": "OIDC login succeeded",
  "auth.oidc.superadmin_revoke_blocked": "OIDC superadmin revoke blocked",
  "auth.access.denied": "Access denied",
  "auth.trusted_device.created": "Trusted device remembered",
};

function securityEventLabel(type: string): string {
  return SECURITY_EVENT_LABELS[type] ?? type;
}

/** Badge tone per event type - failures/denials read as `error`, break-glass/recovery (deliberate
 * but sensitive) as `warn`, successes as `ok`; logout stays the Badge default `neutral`. */
const TONE_BY_SECURITY_EVENT: Record<string, BadgeVariant> = {
  "auth.login.success": "ok",
  "auth.mfa.success": "ok",
  "auth.oidc.success": "ok",
  "auth.login.fail": "error",
  "auth.mfa.fail": "error",
  "auth.access.denied": "error",
  "auth.oidc.superadmin_revoke_blocked": "error",
  "auth.mfa.break_glass": "warn",
  "auth.superadmin.bootstrap": "warn",
  "auth.mfa.recovery_consumed": "warn",
  "auth.login.repeated_failures": "warn",
  "auth.mfa.repeated_failures": "warn",
};

function securityEventTone(type: string): BadgeVariant {
  return TONE_BY_SECURITY_EVENT[type] ?? "neutral";
}

const SECURITY_EVENT_TYPE_OPTIONS = Object.keys(SECURITY_EVENT_LABELS).sort((a, b) =>
  securityEventLabel(a).localeCompare(securityEventLabel(b)),
);

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const SEARCH_DEBOUNCE_MS = 300;

/** UTC instant as "YYYY-MM-DD HH:MM:SS" - `created_at` is already an ISO string in UTC, so this
 * is just trimming it, matching the mockup's compact monospace time format exactly. */
function formatAuditPrimaryTime(iso: string): string {
  return iso.slice(0, 19).replace("T", " ");
}

/** Cached formatter for the hour/minute part of userLocalTimeText/viewerLocalTimeText below -
 * SECURITY_COLUMNS calls these once per visible row on every live poll (~1.75s), so constructing
 * a fresh Intl.DateTimeFormat per cell per tick was measurable churn on a tab left open all day.
 * Keyed by locale + zone so both the user's own zone (varies per row) and the viewer's fixed
 * browser zone share the same small cache. */
const hourMinuteFormatCache = new Map<string, Intl.DateTimeFormat>();

function hourMinuteFormat(timeZone: string): Intl.DateTimeFormat {
  const locale = getPreferredLocale();
  const key = `${locale}\0${timeZone}`;
  let format = hourMinuteFormatCache.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    });
    hourMinuteFormatCache.set(key, format);
  }
  return format;
}

/** Wall-clock text only (no label) - used in copy/export and under the Time column's user icon. */
function userLocalTimeText(entry: { actor_timezone: string | null; created_at: string }): string | null {
  if (!entry.actor_timezone) return null;
  const hhmm = hourMinuteFormat(entry.actor_timezone).format(new Date(entry.created_at));
  return `${hhmm} ${zonedTimeLabel(entry.created_at, entry.actor_timezone)}`;
}

/** Viewer browser zone text only - fallback when no actor timezone was stored. */
function viewerLocalTimeText(iso: string): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hhmm = hourMinuteFormat(timeZone).format(new Date(iso));
  return `${hhmm} ${zonedTimeLabel(iso, timeZone)}`;
}

/** Audit secondary line: ti-user marks the staff member's local time (word "User" is too wide on mobile). */
function UserLocalTimeLine({ entry }: Readonly<{ entry: AuditLogEntryDto }>): ReactNode {
  const text = userLocalTimeText(entry);
  if (!text) return null;
  return (
    <div className="sessions-subdued audit-log-time__local">
      <i className="ti ti-user" aria-hidden="true" title="User's local time" />
      <span className="sr-only">User's local time: </span>
      {text}
    </div>
  );
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
const TIME_HINT =
  "UTC on top. Below (user icon): the user's local time when they did it. Missing for older rows or CLI.";
const SECURITY_TIME_HINT =
  "UTC on top. Below (user icon): the user's local time when they did it. Missing for older rows or non-browser clients - then your browser timezone (desktop icon).";

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
  if (value === null || value === undefined) return "-";
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

// Already shown elsewhere in the row - repeating them in Details would just be noise.
// eventId/event_id: shown by the Scope column.
const AUDIT_METADATA_KEYS_SHOWN_ELSEWHERE = new Set(["eventId", "event_id"]);
// Security adds email/email_redacted: shown under the User column (resolved user, or the
// attempted email on a failed login - email_redacted is the legacy key for rows written before
// that was unredacted, see securityUnknownEmail).
const SECURITY_METADATA_KEYS_SHOWN_ELSEWHERE = new Set([
  ...AUDIT_METADATA_KEYS_SHOWN_ELSEWHERE,
  "email",
  "email_redacted",
]);

/** True when metadata has at least one key worth rendering in the Details column, beyond what
 * the Scope/User column already covers. */
function hasVisibleMetadata(
  metadata: Record<string, unknown> | null,
  hiddenKeys: ReadonlySet<string>,
): boolean {
  if (!metadata) return false;
  return Object.keys(metadata).some((key) => !hiddenKeys.has(key));
}

/** Plain-text rendering of one full row - Time/Action/Scope/Actor/IP plus any visible Details,
 * for the row-level "copy" affordance (a non-technical operator sharing one entry over chat
 * shouldn't have to screenshot a table). */
function buildRowSummary(entry: AuditLogEntryDto, eventTitleById: Map<string, string>): string {
  const localTime = userLocalTimeText(entry);
  const localTimeSuffix = localTime ? ` (User · ${localTime})` : "";
  const actorEmailSuffix = entry.actor_display_name && entry.actor_email ? ` (${entry.actor_email})` : "";
  const locationText = entry.ip ? geoLocationText(entry.country) : "";
  const locationSuffix = locationText ? ` (${locationText})` : "";
  const lines = [
    `Time: ${formatAuditPrimaryTime(entry.created_at)} UTC${localTimeSuffix}`,
    `Action: ${actionLabel(entry.action_type)}`,
    `Scope: ${scopeLabel(entry, eventTitleById)}`,
    `User: ${actorDisplay(entry)}${actorEmailSuffix}`,
    `IP address: ${entry.ip ?? "-"}${locationSuffix}`,
  ];
  if (hasVisibleMetadata(entry.metadata, AUDIT_METADATA_KEYS_SHOWN_ELSEWHERE)) {
    lines.push("Details:");
    for (const [key, value] of Object.entries(entry.metadata!)) {
      if (AUDIT_METADATA_KEYS_SHOWN_ELSEWHERE.has(key)) continue;
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
function DetailsCell({
  metadata,
  hiddenKeys,
}: Readonly<{ metadata: Record<string, unknown> | null; hiddenKeys: ReadonlySet<string> }>) {
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

  if (!hasVisibleMetadata(metadata, hiddenKeys)) return <>-</>;
  const rows = Object.entries(metadata!).filter(([key]) => !hiddenKeys.has(key));
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

interface LogColumn<T> {
  key: string;
  header: ReactNode;
  className?: string;
  title?: (entry: T) => string | undefined;
  cell: (entry: T) => ReactNode;
}

/** Shared Details-popover + row-copy-button combo - identical on every row of every view
 * (desktop table or mobile card, Audit or Security). */
function LogDetailsAction({
  metadata,
  hiddenKeys,
  onCopy,
}: Readonly<{
  metadata: Record<string, unknown> | null;
  hiddenKeys: ReadonlySet<string>;
  onCopy: () => void;
}>) {
  return (
    <div className="audit-log-details-cell">
      <DetailsCell metadata={metadata} hiddenKeys={hiddenKeys} />
      <button type="button" className="audit-log-row-copy" aria-label="Copy row" onClick={onCopy}>
        <i className="ti ti-copy" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Reserves the skeleton's own height from the very first paint - navigating here from a
 * separate route (e.g. Identity, which unmounts this whole panel) re-triggers a genuine first
 * load, and rendering nothing at all while entries === [] let the card visibly collapse then
 * snap back once data arrived, reading as a flicker even on a fast fetch. A fetch that resolves
 * near-instantly (localhost, a warm cache) still shouldn't flash a visible skeleton on and off -
 * `visibility` (not conditional rendering) keeps the space reserved throughout while only
 * revealing it once loading has genuinely taken a moment. */
function LogSkeleton({ label, visible }: Readonly<{ label: string; visible: boolean }>) {
  return (
    <div
      className="audit-log-skeleton"
      aria-busy={visible || undefined}
      aria-label={label}
      style={{ visibility: visible ? "visible" : "hidden" }}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="audit-log-skeleton__row" />
      ))}
    </div>
  );
}

interface LogTableProps<T> {
  entries: T[];
  loading: boolean;
  columns: LogColumn<T>[];
  rowKey: (entry: T) => string;
  metadataOf: (entry: T) => Record<string, unknown> | null;
  metadataHiddenKeys: ReadonlySet<string>;
  onCopyRow: (entry: T) => Promise<void>;
}

/** Desktop row list, driven by a column config - shared by Audit and Security. Their row shapes
 * differ enough (no Scope column on Security, a different Time/User cell) that each view still
 * supplies its own column list, but the table/row/details-cell scaffolding itself no longer
 * exists twice. */
function LogTable<T>({
  entries,
  loading,
  columns,
  rowKey,
  metadataOf,
  metadataHiddenKeys,
  onCopyRow,
}: Readonly<LogTableProps<T>>) {
  return (
    <div className={`sessions-table-wrap${loading ? " audit-log-table-wrap--loading" : ""}`}>
      <table className="table audit-log-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col">
                {col.header}
              </th>
            ))}
            <th scope="col">Details</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={rowKey(entry)}>
              {columns.map((col) => (
                <td key={col.key} className={col.className} title={col.title?.(entry)}>
                  {col.cell(entry)}
                </td>
              ))}
              <td>
                <LogDetailsAction
                  metadata={metadataOf(entry)}
                  hiddenKeys={metadataHiddenKeys}
                  onCopy={() => void onCopyRow(entry)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface LogCardsProps<T> {
  entries: T[];
  loading: boolean;
  rowKey: (entry: T) => string;
  renderTop: (entry: T) => ReactNode;
  renderMeta: (entry: T) => ReactNode;
  renderFootLeft: (entry: T) => ReactNode;
  metadataOf: (entry: T) => Record<string, unknown> | null;
  metadataHiddenKeys: ReadonlySet<string>;
  onCopyRow: (entry: T) => Promise<void>;
}

/** Mobile one-card-per-entry list - mirrors AttendeesTable's/ReportsPage's own desktop-table/
 * mobile-card split. Shares the wrapper/top/meta/foot scaffolding and the details-cell/copy
 * affordance with both views; each supplies its own top/meta content since the two rows' visual
 * grouping (which fields sit together) differs enough that forcing them through the same
 * column list as LogTable would read worse than just naming the two render slots. */
function LogCards<T>({
  entries,
  loading,
  rowKey,
  renderTop,
  renderMeta,
  renderFootLeft,
  metadataOf,
  metadataHiddenKeys,
  onCopyRow,
}: Readonly<LogCardsProps<T>>) {
  return (
    <div className={`audit-log-cards${loading ? " audit-log-table-wrap--loading" : ""}`}>
      {entries.map((entry) => (
        <div key={rowKey(entry)} className="audit-log-card">
          <div className="audit-log-card__top">{renderTop(entry)}</div>
          <div className="audit-log-card__meta">{renderMeta(entry)}</div>
          <div className="audit-log-card__foot">
            <span>{renderFootLeft(entry)}</span>
            <LogDetailsAction
              metadata={metadataOf(entry)}
              hiddenKeys={metadataHiddenKeys}
              onCopy={() => void onCopyRow(entry)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

interface LogListContentProps {
  isInitialLoad: boolean;
  showLoadingSkeleton: boolean;
  skeletonLabel: string;
  error: string | null;
  errorTitle: string;
  onRetry: () => void;
  entriesCount: number;
  total: number;
  hasActiveFilters: boolean;
  emptyIcon: ReactNode;
  emptyTitle: string;
  emptyDescription: string;
  isDesktop: boolean;
  renderTable: () => ReactNode;
  renderCards: () => ReactNode;
}

/** Picks the loading skeleton / error / empty-state / table-or-cards branch - shared by both
 * views; this whole if-chain used to live directly inside AuditLogPanel, then got duplicated
 * once for Security. Only the copy/icon and which table-or-cards to render differ per view. */
function LogListContent({
  isInitialLoad,
  showLoadingSkeleton,
  skeletonLabel,
  error,
  errorTitle,
  onRetry,
  entriesCount,
  total,
  hasActiveFilters,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  isDesktop,
  renderTable,
  renderCards,
}: Readonly<LogListContentProps>) {
  if (isInitialLoad) {
    return <LogSkeleton label={skeletonLabel} visible={showLoadingSkeleton} />;
  }
  if (error) {
    return (
      <EmptyState
        title={errorTitle}
        description={error}
        action={
          <Button type="button" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        }
      />
    );
  }
  if (entriesCount === 0 && total > 0) {
    return <EmptyState title="No entries on this page." description="Try Previous, or adjust the filters." />;
  }
  if (entriesCount === 0 && hasActiveFilters) {
    return (
      <EmptyState
        icon={<i className="ti ti-filter-off" aria-hidden="true" />}
        title="No matches"
        description="Try different filters, or clear them to see everything."
      />
    );
  }
  if (entriesCount === 0) {
    return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />;
  }
  // Mobile: one card per entry instead of a horizontally-scrolling table, mirroring
  // AttendeesTable's/ReportsPage's own desktop-table/mobile-card split at the same
  // useIsDesktop() breakpoint.
  return isDesktop ? renderTable() : renderCards();
}

/** Audit's column config for LogTable - built per-render (unlike Security's static one) since
 * the Scope column needs the current eventTitleById map. */
function buildAuditColumns(eventTitleById: Map<string, string>): LogColumn<AuditLogEntryDto>[] {
  return [
    {
      key: "time",
      header: <HintLabel hint={TIME_HINT}>Time</HintLabel>,
      className: "audit-log-time",
    cell: (entry) => (
      <>
        <div>{formatAuditPrimaryTime(entry.created_at)} UTC</div>
        <UserLocalTimeLine entry={entry} />
      </>
    ),
  },
  {
    key: "action",
    header: "Action",
    cell: (entry) => <Badge variant={actionTone(entry.action_type)}>{actionLabel(entry.action_type)}</Badge>,
  },
  {
    key: "scope",
    header: <HintLabel hint={SCOPE_HINT}>Scope</HintLabel>,
    cell: (entry) => scopeLabel(entry, eventTitleById),
  },
  {
    key: "actor",
    header: "User",
    title: (entry) => actorTitle(entry),
    cell: (entry) => (
      <>
        {actorDisplay(entry)}
        {entry.actor_display_name && entry.actor_email && (
          <div className="sessions-subdued">{entry.actor_email}</div>
        )}
      </>
    ),
  },
  {
    key: "ip",
    header: "IP address",
    cell: (entry) => (
      <>
        {entry.ip ?? "-"}
        {entry.ip && <div className="sessions-subdued"><GeoCell location={entry.country} /></div>}
      </>
    ),
  },
];
}

/** Audit's LogCards top/meta slots - mirrors Security's own render*Card* functions below, plus
 * the Scope meta item Security has no equivalent of. */
function renderAuditCardTop(entry: AuditLogEntryDto): ReactNode {
  const label = actionLabel(entry.action_type);
  return (
    <>
      <div className="audit-log-card__action" title={label}>
        <Badge variant={actionTone(entry.action_type)}>{label}</Badge>
      </div>
      <div className="audit-log-time audit-log-card__time">
        <div>{formatAuditPrimaryTime(entry.created_at)} UTC</div>
        <UserLocalTimeLine entry={entry} />
      </div>
    </>
  );
}

function renderAuditCardMeta(entry: AuditLogEntryDto, eventTitleById: Map<string, string>): ReactNode {
  return (
    <>
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
    </>
  );
}

// ============================================================================================
// Security view (SecurityAuditLog, issue #473) - folded into this same System/Audit toggle as a
// third "Security" option (formerly a separate SecurityAuditLogPanel card stacked below this one;
// two separately-erroring/loading cards on one tab read as confusing, not as three distinct
// things). The backend stays two separate tables/endpoints/retention policies - only the UI is
// unified. The row shapes differ enough (no Scope column, a viewer- rather than actor-local
// time) that each view keeps its own labels/helpers/column config below, but the actual
// table/cards/list-content/toolbar/footer/data-fetching scaffolding is the shared LogTable/
// LogCards/LogListContent/LogView/useLogQuery above and below.

/** Resolved display name for a row's subject - "Unknown" both when `user_id` is null
 * (enumeration-safe rows, e.g. failed logins) and when the user record itself has neither a
 * display name nor an email (already deleted). */
function securityUserDisplay(entry: SecurityAuditLogEntryDto): string {
  if (!entry.user_id) return "Unknown";
  return entry.user_display_name || entry.user_email || "Deleted user";
}

/** Tooltip for the User cell when `user_id` names an account that's since been deleted - mirrors
 * actorTitle's raw-id-in-title pattern above. Distinct from the null-`user_id` "Unknown" case
 * (an enumeration-safe row, e.g. a failed login, has no id to show a tooltip for). */
function securityUserTitle(entry: SecurityAuditLogEntryDto): string | undefined {
  if (!entry.user_id || entry.user_display_name || entry.user_email) return undefined;
  return entry.user_id;
}

/** The attempted email for the `user_id`-is-null case (e.g. a failed login attempt) -
 * `auth.login.fail` is the only event type that currently writes an email into metadata for
 * these rows; everything else with a null user_id (e.g. access denied) has no email at all, so
 * this simply resolves to undefined for them. `user_id` stays null even though the email is now
 * shown in full: the write path still never resolves/confirms the email against a real account
 * (packages/auth/src/audit.ts). Checks `email` first (current field); `email_redacted` is the
 * legacy key from before this was unredacted - still read here so rows written before that change
 * keep displaying their (redacted) value instead of going blank. */
function securityUnknownEmail(entry: SecurityAuditLogEntryDto): string | undefined {
  if (entry.user_id) return undefined;
  const value = entry.metadata?.["email"] ?? entry.metadata?.["email_redacted"];
  return typeof value === "string" ? value : undefined;
}

/** Email subline shown under the User cell - mirrors Audit's actor_email subline (full email
 * only when a known user has both a display name and an email, so we don't duplicate the value
 * when securityUserDisplay already fell back to showing the email as the primary text), plus the
 * attempted email for the null-user_id rows above. */
function securityUserEmail(entry: SecurityAuditLogEntryDto): string | undefined {
  if (entry.user_display_name && entry.user_email) return entry.user_email;
  return securityUnknownEmail(entry);
}

/** Plain-text rendering of one full row, for the same row-level "copy" affordance as Audit's
 * buildRowSummary - no Scope line here, since that concept doesn't apply. Prefers the actor's
 * stored zone when present; otherwise the viewer's browser zone (same as the Time cell). */
function buildSecurityRowSummary(entry: SecurityAuditLogEntryDto): string {
  const userEmailSuffix = securityUserEmail(entry) ? ` (${securityUserEmail(entry)})` : "";
  const locationText = entry.ip ? geoLocationText(entry.country) : "";
  const locationSuffix = locationText ? ` (${locationText})` : "";
  const actorLocal = userLocalTimeText(entry);
  const localLine = actorLocal
    ? `User's local time · ${actorLocal}`
    : `Your local time · ${viewerLocalTimeText(entry.created_at)}`;
  const lines = [
    `Time: ${formatAuditPrimaryTime(entry.created_at)} UTC (${localLine})`,
    `Event: ${securityEventLabel(entry.event_type)}`,
    `User: ${securityUserDisplay(entry)}${userEmailSuffix}`,
    `IP address: ${entry.ip ?? "-"}${locationSuffix}`,
  ];
  if (hasVisibleMetadata(entry.metadata, SECURITY_METADATA_KEYS_SHOWN_ELSEWHERE)) {
    lines.push("Details:");
    for (const [key, value] of Object.entries(entry.metadata!)) {
      if (SECURITY_METADATA_KEYS_SHOWN_ELSEWHERE.has(key)) continue;
      lines.push(`  ${humanizeMetadataKey(key)}: ${formatMetadataValue(key, value)}`);
    }
  }
  return lines.join("\n");
}

/** Security's column config for LogTable - no Scope column (SecurityAuditLog rows aren't
 * event-scoped). Time secondary line prefers actor_timezone (user icon) with viewer fallback
 * (desktop icon), matching Audit. Static since nothing here depends on data outside the entry. */
const SECURITY_COLUMNS: LogColumn<SecurityAuditLogEntryDto>[] = [
  {
    key: "time",
    header: <HintLabel hint={SECURITY_TIME_HINT}>Time</HintLabel>,
    className: "audit-log-time",
    cell: (entry) => (
      <>
        <div>{formatAuditPrimaryTime(entry.created_at)} UTC</div>
        <ActorOrViewerLocalTimeLine iso={entry.created_at} actorTimezone={entry.actor_timezone} />
      </>
    ),
  },
  {
    key: "event",
    header: "Event",
    cell: (entry) => (
      <Badge variant={securityEventTone(entry.event_type)}>{securityEventLabel(entry.event_type)}</Badge>
    ),
  },
  {
    key: "user",
    header: "User",
    title: (entry) => securityUserTitle(entry),
    cell: (entry) => (
      <>
        {securityUserDisplay(entry)}
        {securityUserEmail(entry) && <div className="sessions-subdued">{securityUserEmail(entry)}</div>}
      </>
    ),
  },
  {
    key: "ip",
    header: "IP address",
    cell: (entry) => (
      <>
        {entry.ip ?? "-"}
        {entry.ip && <div className="sessions-subdued"><GeoCell location={entry.country} /></div>}
      </>
    ),
  },
];

/** Security's LogCards top/meta slots - mirrors Audit's own render*Card* functions below. */
function renderSecurityCardTop(entry: SecurityAuditLogEntryDto): ReactNode {
  return (
    <>
      <Badge variant={securityEventTone(entry.event_type)}>{securityEventLabel(entry.event_type)}</Badge>
      <div className="audit-log-time audit-log-card__time">
        <div>{formatAuditPrimaryTime(entry.created_at)} UTC</div>
        <ActorOrViewerLocalTimeLine iso={entry.created_at} actorTimezone={entry.actor_timezone} />
      </div>
    </>
  );
}

function renderSecurityCardMeta(entry: SecurityAuditLogEntryDto): ReactNode {
  return (
    <>
      <span className="audit-log-card__meta-item" title={securityUserTitle(entry)}>
        <i className="ti ti-user" aria-hidden="true" />
        {securityUserDisplay(entry)}
      </span>
      {securityUserEmail(entry) && (
        <div className="sessions-subdued audit-log-card__email">{securityUserEmail(entry)}</div>
      )}
    </>
  );
}

type SecurityLogFilters = { eventType: string; search: string; start: string; end: string };

type AuditLogFilters = { actionType: string; eventId: string; search: string; start: string; end: string };

/** Stable (module-level, never-recreated) query functions passed into useLogQuery below - kept
 * as plain functions rather than closures defined inside AuditLogPanel so they never need to be
 * memoized to avoid re-triggering the hook's own load effect on every render. */
function fetchAuditLogPage(page: number, pageSize: number, filters: AuditLogFilters, signal: AbortSignal) {
  return fetchAuditLog(
    {
      page,
      pageSize,
      actionType: filters.actionType || undefined,
      eventId: filters.eventId || undefined,
      search: filters.search || undefined,
      start: filters.start ? utcDayStartIso(filters.start) : undefined,
      end: filters.end ? utcDayEndIso(filters.end) : undefined,
    },
    signal,
  );
}

function exportAuditLogRows(filters: AuditLogFilters) {
  return exportAuditLog({
    actionType: filters.actionType || undefined,
    eventId: filters.eventId || undefined,
    search: filters.search || undefined,
    start: filters.start ? utcDayStartIso(filters.start) : undefined,
    end: filters.end ? utcDayEndIso(filters.end) : undefined,
  });
}

function fetchSecurityLogPage(page: number, pageSize: number, filters: SecurityLogFilters, signal: AbortSignal) {
  return fetchSecurityAuditLog(
    {
      page,
      pageSize,
      eventType: filters.eventType || undefined,
      search: filters.search || undefined,
      start: filters.start ? utcDayStartIso(filters.start) : undefined,
      end: filters.end ? utcDayEndIso(filters.end) : undefined,
    },
    signal,
  );
}

function exportSecurityLogRows(filters: SecurityLogFilters) {
  return exportSecurityAuditLog({
    eventType: filters.eventType || undefined,
    search: filters.search || undefined,
    start: filters.start ? utcDayStartIso(filters.start) : undefined,
    end: filters.end ? utcDayEndIso(filters.end) : undefined,
  });
}

const AUDIT_INITIAL_FILTERS: AuditLogFilters = { actionType: "", eventId: "", search: "", start: "", end: "" };
const SECURITY_INITIAL_FILTERS: SecurityLogFilters = { eventType: "", search: "", start: "", end: "" };

interface AuditFilterFieldsProps {
  filters: AuditLogFilters;
  setFilters: Dispatch<SetStateAction<AuditLogFilters>>;
  setPage: Dispatch<SetStateAction<number>>;
  events: EventDto[];
}

/** Audit's own Action + Event(scope) selects, rendered inside LogView's shared FiltersMenu slot -
 * extracted from AuditLogPanel for the same cognitive-complexity reason as LogsCardActions. */
function AuditFilterFields({ filters, setFilters, setPage, events }: Readonly<AuditFilterFieldsProps>) {
  const eventOptions = [...events]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((event) => ({ value: event.id, label: event.title }));
  return (
    <>
      <div className="audit-log-filters-menu__field">
        <label className="audit-log-filter__label" htmlFor="audit-log-filter-action">
          Action
        </label>
        <SearchableSelect
          id="audit-log-filter-action"
          label="Action"
          placeholder="All actions"
          searchPlaceholder="Search actions…"
          emptyLabel="No actions found"
          showLabel={false}
          minWidth={340}
          value={filters.actionType || "all"}
          options={[
            { id: "all", label: "All actions" },
            ...ACTION_OPTIONS.map((type) => ({ id: type, label: actionLabel(type) })),
          ]}
          onChange={(value) => {
            setFilters((f) => ({ ...f, actionType: value === "all" ? "" : value }));
            setPage(1);
          }}
        />
      </div>
      <div className="audit-log-filters-menu__field">
        <label className="audit-log-filter__label" htmlFor="audit-log-filter-scope">
          Event
        </label>
        <SearchableSelect
          id="audit-log-filter-scope"
          label="Event"
          placeholder="All events"
          searchPlaceholder="Search events…"
          emptyLabel="No events found"
          showLabel={false}
          value={filters.eventId || "all"}
          options={[
            { id: "all", label: "All events" },
            ...eventOptions.map((o) => ({ id: o.value, label: o.label, icon: "calendar-event" })),
          ]}
          onChange={(value) => {
            setFilters((f) => ({ ...f, eventId: value === "all" ? "" : value }));
            setPage(1);
          }}
        />
      </div>
    </>
  );
}

interface SecurityFilterFieldsProps {
  filters: SecurityLogFilters;
  setFilters: Dispatch<SetStateAction<SecurityLogFilters>>;
  setPage: Dispatch<SetStateAction<number>>;
}

/** Security's own Event-type select - mirrors AuditFilterFields above. */
function SecurityFilterFields({ filters, setFilters, setPage }: Readonly<SecurityFilterFieldsProps>) {
  return (
    <div className="audit-log-filters-menu__field">
      <label className="audit-log-filter__label" htmlFor="security-audit-log-filter-event">
        Event
      </label>
      <SearchableSelect
        id="security-audit-log-filter-event"
        label="Event"
        placeholder="All event types"
        searchPlaceholder="Search event types…"
        emptyLabel="No event types found"
        showLabel={false}
        value={filters.eventType || "all"}
        options={[
          { id: "all", label: "All event types" },
          ...SECURITY_EVENT_TYPE_OPTIONS.map((type) => ({ id: type, label: securityEventLabel(type) })),
        ]}
        onChange={(value) => {
          setFilters((f) => ({ ...f, eventType: value === "all" ? "" : value }));
          setPage(1);
        }}
      />
    </div>
  );
}

function hasActiveAuditFilters(f: AuditLogFilters): boolean {
  return !!(f.actionType || f.eventId || f.search || f.start || f.end);
}

function hasActiveSecurityFilters(f: SecurityLogFilters): boolean {
  return !!(f.eventType || f.search || f.start || f.end);
}

/** How many of the given values are truthy - used for the Filters button's active-count badge,
 * where each caller's own fields differ (Audit counts actionType+eventId, Security just
 * eventType) but the "count the truthy ones" shape is the same. */
function countTruthy(...values: unknown[]): number {
  return values.filter(Boolean).length;
}

/** Shared by handleCopyRow/handleCopySecurityRow - identical clipboard-write + success/error
 * toast pair, differing only in which summary-builder produced the text. */
async function copyRowToClipboard(
  summary: string,
  addToast: ReturnType<typeof useToast>["addToast"],
): Promise<void> {
  try {
    await navigator.clipboard.writeText(summary);
    addToast("Row copied to clipboard", "success");
  } catch {
    addToast("Could not copy. Clipboard access was blocked.", "error");
  }
}

/** A single missed live-refresh tick is normal network noise - the next tick POLL_INTERVAL_MS
 * later retries. A sustained run of them (endpoint down, role revoked) must not leave "Live"
 * looking green over silently stale rows forever. Extracted out of useLogQuery's own load()
 * purely to keep that function's cognitive complexity within the shared lint budget. */
function recordSilentPollFailure(pollFailureCountRef: RefObject<number>, setPollDegraded: (degraded: boolean) => void) {
  pollFailureCountRef.current += 1;
  if (pollFailureCountRef.current >= POLL_DEGRADED_THRESHOLD) setPollDegraded(true);
}

/** load()'s own finally-block cleanup, extracted purely to keep that function's cognitive
 * complexity within the shared lint budget. `aborted` short-circuits before touching
 * loading/hasLoadedOnce - see load()'s own comments for why (an aborted call was superseded by
 * a newer one, which owns setting those states instead). Clears the non-silent guard only when
 * this exact request still owns it: an older, aborted request must never clear a newer request's
 * guard and let a poll abort it. */
function finishLoad(opts: {
  silent: boolean;
  aborted: boolean;
  request: AbortController;
  nonSilentLoadInFlightRef: RefObject<AbortController | null>;
  setLoading: (loading: boolean) => void;
  setHasLoadedOnce: (loaded: boolean) => void;
}): void {
  const { silent, aborted, request, nonSilentLoadInFlightRef, setLoading, setHasLoadedOnce } = opts;
  if (!silent && nonSilentLoadInFlightRef.current === request) nonSilentLoadInFlightRef.current = null;
  if (aborted) return;
  if (!silent) setLoading(false);
  setHasLoadedOnce(true);
}

interface UseLogQueryOptions<TEntry, TFilters extends { search: string; start: string; end: string }> {
  initialFilters: TFilters;
  hasActiveFilters: (filters: TFilters) => boolean;
  fetchPage: (page: number, pageSize: number, filters: TFilters, signal: AbortSignal) => Promise<{
    entries: TEntry[];
    total: number;
  }>;
  exportRows: (filters: TFilters) => Promise<void>;
  loadErrorMessage: string;
  exportErrorMessage: string;
  /** Whether this view's tab (Audit/Security) is the one currently shown. LogsPanelViews keeps
   * all three views mounted (see its own comment), so without this the live-poll interval below
   * would keep hitting this view's endpoint every tick even while the operator is looking at a
   * sibling tab - three times the request volume of what's actually on screen, indefinitely, per
   * open browser tab (PO review). Only gates the recurring poll, not the initial/filter-change
   * load, so switching back to this tab still shows its last-fetched (not stale-forever) rows. */
  isVisible: boolean;
}

/** All state + fetch/pagination/live-poll/scroll-restore logic shared by the Audit and Security
 * views - both behave identically (same filter/search/pagination/scroll-restore/live-refresh
 * behavior), just against a different filter shape and API call, supplied by each caller below. */
function useLogQuery<TEntry, TFilters extends { search: string; start: string; end: string }>({
  initialFilters,
  hasActiveFilters: computeHasActiveFilters,
  fetchPage,
  exportRows,
  loadErrorMessage,
  exportErrorMessage,
  isVisible,
}: Readonly<UseLogQueryOptions<TEntry, TFilters>>) {
  const [entries, setEntries] = useState<TEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [filters, setFilters] = useState<TFilters>(initialFilters);
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Set once the first fetch (success or failure) settles, and never reset - lets isInitialLoad
  // below tell "nothing loaded yet" apart from "loaded, and happens to be empty right now" so a
  // filter change that starts (or ends up) at zero rows doesn't re-trigger the skeleton and
  // flash the empty-state text out from under the user. Matches AttendeesPage's hasLoadedOnce.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  // Mirrors SystemLogsPanel's own Live toggle - defaults on, since a log view is exactly the
  // kind of thing an operator wants to watch update on its own.
  const [live, setLive] = useState(true);
  // True once a run of silent poll ticks has failed POLL_DEGRADED_THRESHOLD times in a row -
  // see the matching comment on SystemLogsPanel's own pollDegraded for why a single miss is
  // never surfaced but a sustained run must not leave "Live" looking green over silently stale
  // rows forever.
  const [pollDegraded, setPollDegraded] = useState(false);
  const pollFailureCountRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  // The active non-silent load (mount, filter/page change, explicit Retry), if any. A silent poll
  // must never abort it: that would leave `loading` stuck true because neither the aborted load
  // nor the silent tick clears it. Keep the controller, not a boolean, so an older aborted load
  // cannot clear the guard after a newer non-silent load has taken over.
  const nonSilentLoadInFlightRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const loadSeqRef = useRef(0);
  const scrollRestoreSeqRef = useRef<number | null>(null);
  // Lets the debounce timer below compare against the *currently committed* search value without
  // adding `filters` itself as a dependency (which would reschedule this effect - and delay the
  // user's own typing - on every unrelated filter change, e.g. the date-range fields).
  const committedSearchRef = useRef(filters.search);
  useEffect(() => {
    committedSearchRef.current = filters.search;
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const trimmed = searchInput.trim();
      // A no-op tick - mount with an empty search box, or typing back to the already-committed
      // value inside the debounce window - must not touch page/filters. Skipping it here isn't
      // just an optimization: unconditionally calling setPage(1) on every tick means this timer
      // fires once on every single mount (nothing to debounce yet) and can reset the page out
      // from under a user who navigates within the first SEARCH_DEBOUNCE_MS after opening the
      // panel, independent of anything they typed.
      if (trimmed === committedSearchRef.current) return;
      setFilters((f) => ({ ...f, search: trimmed }));
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

  // `silent` is used by the live-poll tick below: same request, but it must never show the
  // dimmed "loading" table state (a nice-to-have refresh becoming a flicker every 1.75s would
  // undo the whole point of the hasLoadedOnce fix above), never clear already-shown rows or
  // surface an error banner for a single missed tick, and never yank the operator to a
  // different page just because the row count shifted underneath them mid-read.
  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      // See nonSilentLoadInFlightRef's own comment above - a silent tick simply skips this turn
      // (the in-flight non-silent load will refresh the data itself) instead of aborting it.
      if (silent && nonSilentLoadInFlightRef.current) return;
      loadAbortRef.current?.abort();
      const ac = new AbortController();
      loadAbortRef.current = ac;
      loadSeqRef.current += 1;
      if (!silent) {
        nonSilentLoadInFlightRef.current = ac;
        setLoading(true);
        setError(null);
      }
      try {
        const data = await fetchPage(page, pageSize, filters, ac.signal);
        if (ac.signal.aborted) return;
        const maxPage = Math.max(1, Math.ceil(data.total / pageSize));
        if (page > maxPage) {
          if (silent) return;
          setEntries([]);
          setPage(maxPage);
          return;
        }
        // A silent poll can be the first successful response after an initial/request error.
        // Its fresh rows must replace the error state too, otherwise LogListContent keeps showing
        // the stale Retry empty state even though the data has recovered.
        setError(null);
        setEntries(data.entries);
        setTotal(data.total);
        pollFailureCountRef.current = 0;
        setPollDegraded(false);
      } catch (err) {
        if (ac.signal.aborted) return;
        if (silent) {
          recordSilentPollFailure(pollFailureCountRef, setPollDegraded);
          return;
        }
        setError(operatorApiErrorMessage(err, loadErrorMessage));
        setEntries([]);
        setTotal(0);
      } finally {
        finishLoad({
          silent,
          aborted: ac.signal.aborted,
          request: ac,
          nonSilentLoadInFlightRef,
          setLoading,
          setHasLoadedOnce,
        });
      }
    },
    // Deliberately NOT `filters` by reference (confirmed by a real test regression when tried):
    // the search-debounce effect above calls setFilters((f) => ({ ...f, search: ... })) every
    // time searchInput settles, including when the trimmed value is unchanged (e.g. mount, or
    // typing then deleting back to the same text within the debounce window) - the spread always
    // produces a brand-new object, so depending on `filters` itself would recreate `load` (and
    // retrigger the mount effect + reset the poll-failure counter via the poll effect, both of
    // which also depend on `load`) on a change that isn't a real one. Object.values gives
    // element-by-element comparison instead, generically, without each call site repeating its
    // own filter-field list here - safe because TFilters is a fixed, flat shape of primitive
    // strings at every real call site, never gaining/losing keys at runtime. fetchPage/
    // loadErrorMessage are stable module-level values (see fetchAuditLogPage/fetchSecurityLogPage).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `filters` intentionally spread above, not listed by reference; see comment block above.
    [page, pageSize, ...Object.values(filters), fetchPage, loadErrorMessage],
  );

  useEffect(() => {
    void load();
    return () => loadAbortRef.current?.abort();
  }, [load]);

  // Live-refresh: re-runs the same query on a timer once the first real load has settled, so a
  // superadmin watching this view sees new rows land without a manual Refresh - the same reason
  // a live dashboard is worth having open at all. Independent of the effect above (its own deps
  // only touch page/filters) so pausing/resuming Live doesn't re-trigger a fetch, matching
  // SystemLogsPanel's own poll effect. AuditLogPanel mounts both Audit and Security hooks at
  // once (LogsPanelViews toggles visibility, not mount), so `isVisible` (this view's own tab
  // being the shown one) also gates the interval - see isVisible's own comment on
  // UseLogQueryOptions for why.
  useEffect(() => {
    if (!live || !hasLoadedOnce || !isVisible) return;
    // Resuming Live always starts the degraded-state tracking fresh.
    pollFailureCountRef.current = 0;
    setPollDegraded(false);
    const intervalId = window.setInterval(() => void load({ silent: true }), POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [live, hasLoadedOnce, isVisible, load]);

  const clearFilters = useCallback(() => {
    setFilters(initialFilters);
    setSearchInput("");
    setPage(1);
  }, [initialFilters]);

  const [exporting, setExporting] = useState(false);
  const { addToast } = useToast();
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await exportRows(filters);
    } catch (err) {
      addToast(operatorApiErrorMessage(err, exportErrorMessage), "error");
    } finally {
      setExporting(false);
    }
  }, [filters, exportRows, exportErrorMessage, addToast]);

  return {
    entries,
    total,
    page,
    setPage,
    pageSize,
    setPageSize,
    filters,
    setFilters,
    searchInput,
    setSearchInput,
    loading,
    error,
    hasLoadedOnce,
    live,
    setLive,
    pollDegraded,
    rootRef,
    searchInputRef,
    goToPage,
    totalPages,
    hasActiveFilters: computeHasActiveFilters(filters),
    clearFilters,
    exporting,
    handleExport,
    reload: load,
  };
}

interface LogViewProps {
  idPrefix: string;
  searchAriaLabel: string;
  searchPlaceholder: string;
  isDesktop: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
  searchInput: string;
  setSearchInput: Dispatch<SetStateAction<string>>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  fromDatePicker: ReactNode;
  toDatePicker: ReactNode;
  filterActiveCount: number;
  filterFields: ReactNode;
  clearFiltersButton: ReactNode;
  exportButton: ReactNode;
  liveButton: ReactNode;
  pollDegraded: boolean;
  onRetryNow: () => void;
  listContent: ReactNode;
  loading: boolean;
  error: string | null;
  total: number;
  page: number;
  pageSize: number;
  setPage: Dispatch<SetStateAction<number>>;
  setPageSize: Dispatch<SetStateAction<number>>;
  goToPage: (next: number) => void;
  totalPages: number;
}

/** The shared toolbar + list + footer shell for the Audit and Security views (search, date
 * range, a view-specific filter-dropdown slot, Clear filters, Export logs, Live, pagination) -
 * extracted from AuditLogPanel so that component can stay a thin switch between this,
 * SystemLogsPanel, and this same view rendered twice, based on the System/Audit/Security
 * toggle. State stays in AuditLogPanel (via useLogQuery); only the JSX is shared here. */
function LogView({
  idPrefix,
  searchAriaLabel,
  searchPlaceholder,
  isDesktop,
  rootRef,
  searchInput,
  setSearchInput,
  searchInputRef,
  fromDatePicker,
  toDatePicker,
  filterActiveCount,
  filterFields,
  clearFiltersButton,
  exportButton,
  liveButton,
  pollDegraded,
  onRetryNow,
  listContent,
  loading,
  error,
  total,
  page,
  pageSize,
  setPage,
  setPageSize,
  goToPage,
  totalPages,
}: Readonly<LogViewProps>) {
  return (
    <>
      <div ref={rootRef} className="audit-log-toolbar">
        <div className="audit-log-filter audit-log-filter--search">
          <Input
            ref={searchInputRef}
            id={`${idPrefix}-search`}
            name={`${idPrefix}-search`}
            aria-label={searchAriaLabel}
            placeholder={searchPlaceholder}
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
        <FiltersMenu activeCount={filterActiveCount} className="audit-log-filters-menu">
          {!isDesktop && (
            <>
              {/* Full width, one per row (not side by side) - the panel is only ~236px wide,
                  not enough room for both the "From (dd/mm/yyyy)" placeholder AND a sibling
                  field without clipping the text. */}
              <div className="audit-log-filters-menu__field">{fromDatePicker}</div>
              <div className="audit-log-filters-menu__field">{toDatePicker}</div>
            </>
          )}
          {filterFields}
        </FiltersMenu>
        {!isDesktop && (
          <div className="audit-log-toolbar-actions">
            {clearFiltersButton}
            {exportButton}
            {liveButton}
          </div>
        )}
      </div>

      {pollDegraded && (
        <Notice variant="warning" as="output" className="audit-log-poll-warning">
          Live updates stopped coming through - the rows below may be out of date.{" "}
          <button type="button" className="audit-log-poll-warning-retry" onClick={onRetryNow}>
            Retry now
          </button>
        </Notice>
      )}

      {listContent}

      {!loading && !error && total > 0 && (
        <PaginationFooter
          idPrefix={idPrefix}
          page={page}
          pageSize={pageSize}
          totalPages={totalPages}
          totalRows={total}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          onPrevious={() => goToPage(Math.max(1, page - 1))}
          onNext={() => goToPage(page + 1)}
        />
      )}
    </>
  );
}

type LogsView = "system" | "audit" | "security";

const LOGS_VIEW_OPTIONS: ReadonlyArray<SegmentedOption<LogsView>> = [
  { value: "system", label: "System" },
  { value: "audit", label: "Audit" },
  { value: "security", label: "Security" },
];

const LOGS_VIEW_TITLES: Record<LogsView, string> = {
  system: "System logs",
  audit: "Audit logs",
  security: "Security logs",
};

const LOGS_VIEW_HINTS: Record<LogsView, string> = {
  system: "Application errors and background jobs, for debugging. Not a record of admin actions.",
  audit: "Who changed what in settings, events, and imports.",
  security: "Login attempts, two-factor checks, and access denials.",
};

function logsViewTitle(view: LogsView): string {
  return LOGS_VIEW_TITLES[view];
}

interface LogsCardActionsProps {
  view: LogsView;
  isDesktop: boolean;
  auditActions: ReactNode;
  systemActions: ReactNode;
  securityActions: ReactNode;
  onViewChange: (view: LogsView) => void;
}

/** The Card header's actions row - extracted from AuditLogPanel purely to keep that component's
 * own cognitive complexity within the shared lint budget; on mobile these same buttons render
 * inline in each view's own toolbar instead (see LogView), since a narrow card header can only
 * fit the title plus the always-present System/Audit/Security toggle before wrapping. */
function LogsCardActions({
  view,
  isDesktop,
  auditActions,
  systemActions,
  securityActions,
  onViewChange,
}: Readonly<LogsCardActionsProps>) {
  return (
    <>
      {isDesktop && view === "audit" && auditActions}
      {isDesktop && view === "system" && systemActions}
      {isDesktop && view === "security" && securityActions}
      {/* Always last: with the actions row right-anchored, a trailing item's own edge
          stays flush against the card's right edge no matter how many of the preceding,
          view-dependent buttons are present - the one placement that's genuinely fixed. */}
      <Segmented
        ariaLabel="Logs view"
        value={view}
        onChange={onViewChange}
        options={LOGS_VIEW_OPTIONS}
        className="audit-log-view-toggle"
      />
    </>
  );
}

interface LogsPanelViewsProps {
  view: LogsView;
  systemLogsPanel: ReactNode;
  auditView: ReactNode;
  securityView: ReactNode;
}

/** All three views stay mounted the whole time, toggled by visibility rather than by
 * conditional rendering - switching the toggle used to unmount/remount whichever side you
 * left, which meant losing all of System's polled state and re-fetching from scratch on
 * every return trip (a visible flash even on a fast local request). Neither side's effects
 * care that they're temporarily hidden - polling simply continues, so flipping back shows
 * already-current data instead of an empty/loading flash. Extracted from AuditLogPanel for
 * the same cognitive-complexity reason as LogsCardActions above. */
function LogsPanelViews({ view, systemLogsPanel, auditView, securityView }: Readonly<LogsPanelViewsProps>) {
  return (
    <>
      <div style={{ display: view === "system" ? undefined : "none" }}>{systemLogsPanel}</div>
      <div style={{ display: view === "audit" ? undefined : "none" }}>{auditView}</div>
      <div style={{ display: view === "security" ? undefined : "none" }}>{securityView}</div>
    </>
  );
}

/** Superadmin audit log viewer — read-only paginated table with action and date filters. */
export function AuditLogPanel() {
  const [view, setView] = useState<LogsView>("system");
  // Mirrored up from SystemLogsPanel purely so the header's Live/Download buttons (which live
  // here, next to the System/Audit toggle, rather than being duplicated inside the panel) can
  // reflect its state - SystemLogsPanel itself remains the source of truth for both.
  const [systemLive, setSystemLive] = useState(true);
  const [systemHasEntries, setSystemHasEntries] = useState(false);
  const systemLogsRef = useRef<SystemLogsPanelHandle>(null);
  const isDesktop = useIsDesktop();
  const { addToast } = useToast();

  const {
    entries,
    total,
    page,
    setPage,
    pageSize,
    setPageSize,
    filters,
    setFilters,
    searchInput,
    setSearchInput,
    loading,
    error,
    hasLoadedOnce,
    live,
    setLive,
    pollDegraded,
    rootRef,
    searchInputRef,
    goToPage,
    totalPages,
    hasActiveFilters,
    clearFilters,
    exporting,
    handleExport,
    reload: load,
  } = useLogQuery<AuditLogEntryDto, AuditLogFilters>({
    initialFilters: AUDIT_INITIAL_FILTERS,
    hasActiveFilters: hasActiveAuditFilters,
    fetchPage: fetchAuditLogPage,
    exportRows: exportAuditLogRows,
    loadErrorMessage: "Failed to load audit log.",
    exportErrorMessage: "Failed to export audit log.",
    isVisible: view === "audit",
  });
  const security = useLogQuery<SecurityAuditLogEntryDto, SecurityLogFilters>({
    initialFilters: SECURITY_INITIAL_FILTERS,
    hasActiveFilters: hasActiveSecurityFilters,
    fetchPage: fetchSecurityLogPage,
    exportRows: exportSecurityLogRows,
    loadErrorMessage: "Failed to load security audit log.",
    exportErrorMessage: "Failed to export security audit log.",
    isVisible: view === "security",
  });

  const [events, setEvents] = useState<EventDto[]>([]);
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
  // Same From/To fields, wired to the Security view's own filters state instead - shares
  // datePattern/isDesktop with Audit's pickers above since both format/placement rules are
  // identical, just against a different onChange target.
  const securityFromDatePicker = (
    <DatePicker
      ariaLabel="From"
      placeholder={`From (${datePattern})`}
      value={security.filters.start}
      onChange={(next) => {
        security.setFilters((f) => ({ ...f, start: next }));
        security.setPage(1);
      }}
    />
  );
  const securityToDatePicker = (
    <DatePicker
      ariaLabel="To"
      placeholder={`To (${datePattern})`}
      value={security.filters.end}
      onChange={(next) => {
        security.setFilters((f) => ({ ...f, end: next }));
        security.setPage(1);
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
  const auditColumns = useMemo(() => buildAuditColumns(eventTitleById), [eventTitleById]);

  // On mobile the date fields move into this same panel (see the toolbar JSX below), so an
  // active From/To should count toward the badge there too - on desktop they stay in the main
  // toolbar, always visible, so they'd double-count if included here as well.
  const activeDateCount = countTruthy(filters.start, filters.end);
  const actionScopeActiveCount = countTruthy(filters.actionType, filters.eventId) + (isDesktop ? 0 : activeDateCount);

  // Same mobile-double-count reasoning as activeDateCount/actionScopeActiveCount above, applied
  // to the Security view's own (single) filter dropdown.
  const securityActiveDateCount = countTruthy(security.filters.start, security.filters.end);
  const securityFilterActiveCount =
    countTruthy(security.filters.eventType) + (isDesktop ? 0 : securityActiveDateCount);

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
      {exporting ? "Exporting…" : "Export logs"}
    </Button>
  );
  const securityClearFiltersButton = (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={!security.hasActiveFilters}
      onClick={security.clearFilters}
    >
      Clear filters
    </Button>
  );
  // Same Live/Paused affordance as System's own liveButton below, one per view since each
  // polls independently - pausing Audit's live-refresh has no effect on Security's.
  const auditLiveButton = (
    <Button type="button" variant={live ? "success" : "secondary"} size="sm" onClick={() => setLive((v) => !v)}>
      {live ? "Live" : "Paused"}
    </Button>
  );
  const securityLiveButton = (
    <Button
      type="button"
      variant={security.live ? "success" : "secondary"}
      size="sm"
      onClick={() => security.setLive((v) => !v)}
    >
      {security.live ? "Live" : "Paused"}
    </Button>
  );
  const securityExportButton = (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={security.exporting}
      onClick={() => void security.handleExport()}
    >
      {security.exporting ? "Exporting…" : "Export logs"}
    </Button>
  );

  const handleCopyRow = useCallback(
    (entry: AuditLogEntryDto) => copyRowToClipboard(buildRowSummary(entry, eventTitleById), addToast),
    [eventTitleById, addToast],
  );

  const handleCopySecurityRow = useCallback(
    (entry: SecurityAuditLogEntryDto) => copyRowToClipboard(buildSecurityRowSummary(entry), addToast),
    [addToast],
  );

  const showLoadingSkeleton = useDelayedLoading(loading);
  // A filter/page change re-fetches with the previous rows still on screen (never cleared at
  // the start of load()) - only the true first load (nothing to show yet) has no rows to keep
  // displaying, so only that case earns the skeleton; every later reload just dims the stale
  // table below instead of blanking it out from under the user (matches AttendeesTable). Gated
  // on hasLoadedOnce rather than entries.length === 0 - a filter/search that legitimately
  // matches nothing is still a completed load, not a first load, so it must not re-arm the
  // skeleton and flash the "No matches" empty-state text out from under the user.
  const isInitialLoad = loading && !hasLoadedOnce;

  const auditFilterFields = (
    <AuditFilterFields filters={filters} setFilters={setFilters} setPage={setPage} events={events} />
  );

  const listContent = (
    <LogListContent
      isInitialLoad={isInitialLoad}
      showLoadingSkeleton={showLoadingSkeleton}
      skeletonLabel="Loading audit log"
      error={error}
      errorTitle="Could not load audit log"
      onRetry={() => void load()}
      entriesCount={entries.length}
      total={total}
      hasActiveFilters={hasActiveFilters}
      emptyIcon={<i className="ti ti-history" aria-hidden="true" />}
      emptyTitle="No audit log entries yet"
      emptyDescription="Actions taken across Settings will appear here."
      isDesktop={isDesktop}
      renderTable={() => (
        <LogTable
          entries={entries}
          loading={loading}
          columns={auditColumns}
          rowKey={(entry) => entry.id}
          metadataOf={(entry) => entry.metadata}
          metadataHiddenKeys={AUDIT_METADATA_KEYS_SHOWN_ELSEWHERE}
          onCopyRow={handleCopyRow}
        />
      )}
      renderCards={() => (
        <LogCards
          entries={entries}
          loading={loading}
          rowKey={(entry) => entry.id}
          renderTop={renderAuditCardTop}
          renderMeta={(entry) => renderAuditCardMeta(entry, eventTitleById)}
          renderFootLeft={(entry) => entry.ip ?? "-"}
          metadataOf={(entry) => entry.metadata}
          metadataHiddenKeys={AUDIT_METADATA_KEYS_SHOWN_ELSEWHERE}
          onCopyRow={handleCopyRow}
        />
      )}
    />
  );

  const showSecurityLoadingSkeleton = useDelayedLoading(security.loading);
  // Mirrors isInitialLoad above - gated on the hook's own hasLoadedOnce, not entries.length,
  // for the same reason (an event-type/search filter with zero matches is still a completed
  // load).
  const isSecurityInitialLoad = security.loading && !security.hasLoadedOnce;

  const securityFilterFields = (
    <SecurityFilterFields filters={security.filters} setFilters={security.setFilters} setPage={security.setPage} />
  );

  const securityListContent = (
    <LogListContent
      isInitialLoad={isSecurityInitialLoad}
      showLoadingSkeleton={showSecurityLoadingSkeleton}
      skeletonLabel="Loading security audit log"
      error={security.error}
      errorTitle="Could not load security audit log"
      onRetry={() => void security.reload()}
      entriesCount={security.entries.length}
      total={security.total}
      hasActiveFilters={security.hasActiveFilters}
      emptyIcon={<i className="ti ti-shield-lock" aria-hidden="true" />}
      emptyTitle="No security events yet"
      emptyDescription="Logins, 2FA checks, logout, OIDC, and access-denied events will appear here."
      isDesktop={isDesktop}
      renderTable={() => (
        <LogTable
          entries={security.entries}
          loading={security.loading}
          columns={SECURITY_COLUMNS}
          rowKey={(entry) => entry.id}
          metadataOf={(entry) => entry.metadata}
          metadataHiddenKeys={SECURITY_METADATA_KEYS_SHOWN_ELSEWHERE}
          onCopyRow={handleCopySecurityRow}
        />
      )}
      renderCards={() => (
        <LogCards
          entries={security.entries}
          loading={security.loading}
          rowKey={(entry) => entry.id}
          renderTop={renderSecurityCardTop}
          renderMeta={renderSecurityCardMeta}
          renderFootLeft={(entry) => entry.ip ?? "-"}
          metadataOf={(entry) => entry.metadata}
          metadataHiddenKeys={SECURITY_METADATA_KEYS_SHOWN_ELSEWHERE}
          onCopyRow={handleCopySecurityRow}
        />
      )}
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
      Export logs
    </Button>
  );

  // On mobile these same buttons render inline in each view's own toolbar instead (see
  // LogView) - order (both here and there) is fixed across all three views: Clear filters (if
  // the view has one) first, then Export logs, then Live last so it sits directly beside the
  // System/Audit/Security selector it's paused/resumed relative to.
  const auditActions = (
    <>
      {clearFiltersButton}
      {exportButton}
      {auditLiveButton}
    </>
  );
  const systemActions = (
    <>
      {downloadButton}
      {liveButton}
    </>
  );
  const securityActions = (
    <>
      {securityClearFiltersButton}
      {securityExportButton}
      {securityLiveButton}
    </>
  );

  return (
    <Card
      title={<HintLabel hint={LOGS_VIEW_HINTS[view]}>{logsViewTitle(view)}</HintLabel>}
      className="audit-log-header-card"
      actions={
        <LogsCardActions
          view={view}
          isDesktop={isDesktop}
          auditActions={auditActions}
          systemActions={systemActions}
          securityActions={securityActions}
          onViewChange={setView}
        />
      }
    >
      <LogsPanelViews
        view={view}
        systemLogsPanel={
          <SystemLogsPanel
            ref={systemLogsRef}
            isDesktop={isDesktop}
            isVisible={view === "system"}
            liveButton={!isDesktop ? liveButton : undefined}
            downloadButton={!isDesktop ? downloadButton : undefined}
            onLiveChange={setSystemLive}
            onHasEntriesChange={setSystemHasEntries}
          />
        }
        auditView={
          <LogView
            idPrefix="audit-log"
            searchAriaLabel="Search user or event"
            searchPlaceholder="Search user or event…"
            isDesktop={isDesktop}
            rootRef={rootRef}
            searchInput={searchInput}
            setSearchInput={setSearchInput}
            searchInputRef={searchInputRef}
            fromDatePicker={fromDatePicker}
            toDatePicker={toDatePicker}
            filterActiveCount={actionScopeActiveCount}
            filterFields={auditFilterFields}
            clearFiltersButton={clearFiltersButton}
            exportButton={exportButton}
            liveButton={auditLiveButton}
            pollDegraded={live && pollDegraded}
            onRetryNow={() => void load()}
            listContent={listContent}
            loading={loading}
            error={error}
            total={total}
            page={page}
            pageSize={pageSize}
            setPage={setPage}
            setPageSize={setPageSize}
            goToPage={goToPage}
            totalPages={totalPages}
          />
        }
        securityView={
          <LogView
            idPrefix="security-audit-log"
            searchAriaLabel="Search user"
            searchPlaceholder="Search user…"
            isDesktop={isDesktop}
            rootRef={security.rootRef}
            searchInput={security.searchInput}
            setSearchInput={security.setSearchInput}
            searchInputRef={security.searchInputRef}
            fromDatePicker={securityFromDatePicker}
            toDatePicker={securityToDatePicker}
            filterActiveCount={securityFilterActiveCount}
            filterFields={securityFilterFields}
            clearFiltersButton={securityClearFiltersButton}
            liveButton={securityLiveButton}
            exportButton={securityExportButton}
            pollDegraded={security.live && security.pollDegraded}
            onRetryNow={() => void security.reload()}
            listContent={securityListContent}
            loading={security.loading}
            error={security.error}
            total={security.total}
            page={security.page}
            pageSize={security.pageSize}
            setPage={security.setPage}
            setPageSize={security.setPageSize}
            goToPage={security.goToPage}
            totalPages={security.totalPages}
          />
        }
      />
    </Card>
  );
}
