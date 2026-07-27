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
import { exportAuditLog, exportSecurityAuditLog, fetchAdminEvents, fetchAuditLog, fetchSecurityAuditLog } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { AuditLogEntryDto, EventDto, SecurityAuditLogEntryDto } from "../api/types.js";
import { DatePicker } from "../components/DatePicker.js";
import { FiltersMenu } from "../components/FiltersMenu.js";
import { Segmented, type SegmentedOption } from "../components/Segmented.js";
import { useClickOutside } from "../components/useClickOutside.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import { localeDateInputPattern, utcDayEndIso, utcDayStartIso } from "../utils/event-dates.js";
import { getPreferredLocale } from "../utils/locale-store.js";
import { MAIL_PROVIDER_LABELS } from "./mailProviderOptions.js";
import { POLL_DEGRADED_THRESHOLD, POLL_INTERVAL_MS, SystemLogsPanel, type SystemLogsPanelHandle } from "./SystemLogsPanel.js";

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
  event_branding_uploaded: "Event branding uploaded",
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
  identity_cf_access_updated: "Cloudflare Access settings updated",
  identity_provider_created: "SSO provider created",
  identity_provider_discovered: "SSO provider endpoints rediscovered",
  identity_provider_toggled: "SSO provider enabled/disabled",
  identity_provider_updated: "SSO provider updated",
  instance_setup_completed: "Instance setup completed",
  mail_settings_updated: "Mail settings updated",
  mail_transport_tested: "Mail transport tested",
  operator_sessions_bulk_revoked: "Operator sessions revoked",
  org_branding_logo_uploaded: "Organization branding logo uploaded",
  retention_run: "Retention job run",
  role_granted: "Role granted",
  role_revoked: "Role revoked",
  security_audit_log_exported: "Security log exported",
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
  "auth.mfa.success": "2FA verified",
  "auth.mfa.fail": "2FA failed",
  "auth.mfa.break_glass": "2FA break-glass override",
  "auth.mfa.recovery_consumed": "2FA recovery code used",
  "auth.logout": "Logged out",
  "auth.oidc.success": "OIDC login succeeded",
  "auth.oidc.superadmin_revoke_blocked": "OIDC superadmin revoke blocked",
  "auth.access.denied": "Access denied",
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
  "auth.mfa.recovery_consumed": "warn",
};

function securityEventTone(type: string): BadgeVariant {
  return TONE_BY_SECURITY_EVENT[type] ?? "neutral";
}

const SECURITY_EVENT_TYPE_OPTIONS = Object.keys(SECURITY_EVENT_LABELS).sort((a, b) =>
  securityEventLabel(a).localeCompare(securityEventLabel(b)),
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

/** The instant, converted to whoever is currently reading the log's own browser timezone - unlike
 * actorLocalTime above, this is never null: Security rows (e.g. a failed login) don't always have
 * a known actor to show a local time *for*, but the superadmin viewing the table always has one. */
function viewerLocalTime(iso: string): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat(getPreferredLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
    timeZoneName: "short",
  }).formatToParts(new Date(iso));
  const hhmm = `${parts.find((p) => p.type === "hour")?.value}:${parts.find((p) => p.type === "minute")?.value}`;
  const abbr = parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  return `${hhmm} ${abbr} (${tzPlaceLabel(timeZone)})`;
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
const SECURITY_TIME_HINT =
  "Top: when this happened, in UTC. Below: the same moment in your own local time (not the actor's - Audit's Time column shows that instead, but a security event doesn't always have a known actor).";

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

// Already shown elsewhere in the row - repeating them in Details would just be noise.
// eventId/event_id: shown by the Scope column. email_redacted: shown under Security's User column.
const METADATA_KEYS_SHOWN_ELSEWHERE = new Set(["eventId", "event_id", "email_redacted"]);

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
                {formatAuditPrimaryTime(entry.created_at)} UTC
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
              {formatAuditPrimaryTime(entry.created_at)} UTC
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

// ============================================================================================
// Security view (SecurityAuditLog, issue #473) - folded into this same System/Audit toggle as a
// third "Security" option (formerly a separate SecurityAuditLogPanel card stacked below this one;
// two separately-erroring/loading cards on one tab read as confusing, not as three distinct
// things). The backend stays two separate tables/endpoints/retention policies - only the UI is
// unified. Kept as a parallel, not shared, set of labels/helpers/components below rather than
// generalizing AuditLogTable etc.: the two row shapes differ enough (no Scope column, no
// actor-timezone) that a shared abstraction would cost more than it saves.

/** Resolved display name for a row's subject - "Unknown" both when `user_id` is null
 * (enumeration-safe rows, e.g. failed logins) and when the user record itself has neither a
 * display name nor an email (already deleted). */
function securityUserDisplay(entry: SecurityAuditLogEntryDto): string {
  if (!entry.user_id) return "Unknown";
  return entry.user_display_name || entry.user_email || "Unknown";
}

/** Tooltip for the User cell when `user_id` names an account that's since been deleted - mirrors
 * actorTitle's raw-id-in-title pattern above. Distinct from the null-`user_id` "Unknown" case
 * (an enumeration-safe row, e.g. a failed login, has no id to show a tooltip for). */
function securityUserTitle(entry: SecurityAuditLogEntryDto): string | undefined {
  if (!entry.user_id || entry.user_display_name || entry.user_email) return undefined;
  return entry.user_id;
}

/** Redacted email for the `user_id`-is-null / enumeration-safe case (e.g. a failed login
 * attempt) - `auth.login.fail` is the only event type that currently writes a redacted email
 * into metadata for these rows; everything else with a null user_id (e.g. access denied) has no
 * email at all, so this simply resolves to undefined for them. */
function securityUnknownEmail(entry: SecurityAuditLogEntryDto): string | undefined {
  if (entry.user_id) return undefined;
  const value = entry.metadata?.["email_redacted"];
  return typeof value === "string" ? value : undefined;
}

/** Email subline shown under the User cell - mirrors Audit's actor_email subline (full email
 * only when a known user has both a display name and an email, so we don't duplicate the value
 * when securityUserDisplay already fell back to showing the email as the primary text), plus the
 * redacted email for enumeration-safe rows above. */
function securityUserEmail(entry: SecurityAuditLogEntryDto): string | undefined {
  if (entry.user_display_name && entry.user_email) return entry.user_email;
  return securityUnknownEmail(entry);
}

/** Plain-text rendering of one full row, for the same row-level "copy" affordance as Audit's
 * buildRowSummary - no Scope line here, since that concept doesn't apply; the local time is the
 * viewer's own (see viewerLocalTime), not an actor's. */
function buildSecurityRowSummary(entry: SecurityAuditLogEntryDto): string {
  const userEmailSuffix = securityUserEmail(entry) ? ` (${securityUserEmail(entry)})` : "";
  const lines = [
    `Time: ${formatAuditPrimaryTime(entry.created_at)} UTC (${viewerLocalTime(entry.created_at)})`,
    `Event: ${securityEventLabel(entry.event_type)}`,
    `User: ${securityUserDisplay(entry)}${userEmailSuffix}`,
    `IP: ${entry.ip ?? "—"}`,
  ];
  if (hasVisibleMetadata(entry.metadata)) {
    lines.push("Details:");
    for (const [key, value] of Object.entries(entry.metadata!)) {
      lines.push(`  ${humanizeMetadataKey(key)}: ${formatMetadataValue(key, value)}`);
    }
  }
  return lines.join("\n");
}

interface SecurityAuditRowsProps {
  entries: SecurityAuditLogEntryDto[];
  loading: boolean;
  onCopyRow: (entry: SecurityAuditLogEntryDto) => Promise<void>;
}

/** Desktop row list - mirrors AuditLogTable; no Scope column (SecurityAuditLog rows aren't
 * event-scoped), and the Time column's second line is the viewer's own local time rather than an
 * actor's (see viewerLocalTime). */
function SecurityAuditTable({ entries, loading, onCopyRow }: Readonly<SecurityAuditRowsProps>) {
  return (
    <div className={`sessions-table-wrap${loading ? " audit-log-table-wrap--loading" : ""}`}>
      <table className="table audit-log-table">
        <thead>
          <tr>
            <th scope="col">
              <Tooltip content={SECURITY_TIME_HINT} className="audit-log-scope-header">
                Time <i className="ti ti-info-circle" aria-hidden="true" />
              </Tooltip>
            </th>
            <th scope="col">Event</th>
            <th scope="col">User</th>
            <th scope="col">IP</th>
            <th scope="col">Details</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className="audit-log-time">
                {formatAuditPrimaryTime(entry.created_at)} UTC
                <div className="sessions-subdued">{viewerLocalTime(entry.created_at)}</div>
              </td>
              <td>
                <Badge variant={securityEventTone(entry.event_type)}>{securityEventLabel(entry.event_type)}</Badge>
              </td>
              <td title={securityUserTitle(entry)}>
                {securityUserDisplay(entry)}
                {securityUserEmail(entry) && <div className="sessions-subdued">{securityUserEmail(entry)}</div>}
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

/** Mobile one-card-per-entry list - mirrors AuditLogCards. */
function SecurityAuditCards({ entries, loading, onCopyRow }: Readonly<SecurityAuditRowsProps>) {
  return (
    <div className={`audit-log-cards${loading ? " audit-log-table-wrap--loading" : ""}`}>
      {entries.map((entry) => (
        <div key={entry.id} className="audit-log-card">
          <div className="audit-log-card__top">
            <Badge variant={securityEventTone(entry.event_type)}>{securityEventLabel(entry.event_type)}</Badge>
            <div className="audit-log-time audit-log-card__time">
              {formatAuditPrimaryTime(entry.created_at)} UTC
              <div className="sessions-subdued">{viewerLocalTime(entry.created_at)}</div>
            </div>
          </div>
          <div className="audit-log-card__meta">
            <span className="audit-log-card__meta-item" title={securityUserTitle(entry)}>
              <i className="ti ti-user" aria-hidden="true" />
              {securityUserDisplay(entry)}
            </span>
            {securityUserEmail(entry) && (
              <div className="sessions-subdued audit-log-card__email">{securityUserEmail(entry)}</div>
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

interface SecurityAuditListContentProps extends SecurityAuditRowsProps {
  isInitialLoad: boolean;
  showLoadingSkeleton: boolean;
  error: string | null;
  onRetry: () => void;
  total: number;
  hasActiveFilters: boolean;
  isDesktop: boolean;
}

/** Picks the loading skeleton / error / empty-state / table-or-cards branch - mirrors
 * AuditLogListContent, with Security-specific empty-state copy. */
function SecurityAuditListContent({
  isInitialLoad,
  showLoadingSkeleton,
  error,
  onRetry,
  entries,
  total,
  hasActiveFilters,
  isDesktop,
  loading,
  onCopyRow,
}: Readonly<SecurityAuditListContentProps>) {
  if (isInitialLoad) {
    return (
      <div
        className="audit-log-skeleton"
        aria-busy={showLoadingSkeleton || undefined}
        aria-label="Loading security audit log"
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
        title="Could not load security audit log"
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
        icon={<i className="ti ti-shield-lock" aria-hidden="true" />}
        title="No security events yet"
        description="Logins, 2FA checks, logout, OIDC, and access-denied events will appear here."
      />
    );
  }
  if (isDesktop) {
    return <SecurityAuditTable entries={entries} loading={loading} onCopyRow={onCopyRow} />;
  }
  return <SecurityAuditCards entries={entries} loading={loading} onCopyRow={onCopyRow} />;
}

type SecurityLogFilters = { eventType: string; search: string; start: string; end: string };

interface SecurityAuditViewProps {
  isDesktop: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
  searchInput: string;
  setSearchInput: Dispatch<SetStateAction<string>>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  fromDatePicker: ReactNode;
  toDatePicker: ReactNode;
  filterActiveCount: number;
  filters: SecurityLogFilters;
  setFilters: Dispatch<SetStateAction<SecurityLogFilters>>;
  setPage: Dispatch<SetStateAction<number>>;
  clearFiltersButton: ReactNode;
  liveButton: ReactNode;
  exportButton: ReactNode;
  pollDegraded: boolean;
  onRetryNow: () => void;
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

/** The security-side toolbar + list + footer - mirrors AuditLogView exactly (search, date range,
 * one filter dropdown instead of two, Clear filters, Export logs, pagination). */
function SecurityAuditView({
  isDesktop,
  rootRef,
  searchInput,
  setSearchInput,
  searchInputRef,
  fromDatePicker,
  toDatePicker,
  filterActiveCount,
  filters,
  setFilters,
  setPage,
  clearFiltersButton,
  liveButton,
  exportButton,
  pollDegraded,
  onRetryNow,
  listContent,
  loading,
  error,
  total,
  page,
  pageSize,
  setPageSize,
  goToPage,
  totalPages,
}: Readonly<SecurityAuditViewProps>) {
  return (
    <>
      <div ref={rootRef} className="audit-log-toolbar">
        <div className="audit-log-filter audit-log-filter--search">
          <Input
            ref={searchInputRef}
            id="security-audit-log-search"
            name="security-audit-log-search"
            aria-label="Search user"
            placeholder="Search user…"
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
              <div className="audit-log-filters-menu__field">{fromDatePicker}</div>
              <div className="audit-log-filters-menu__field">{toDatePicker}</div>
            </>
          )}
          <div className="audit-log-filters-menu__field">
            <label className="audit-log-filter__label" htmlFor="security-audit-log-filter-event">
              Event
            </label>
            <select
              id="security-audit-log-filter-event"
              name="security-audit-log-filter-event"
              className="at-select"
              value={filters.eventType}
              onChange={(e) => {
                setFilters((f) => ({ ...f, eventType: e.target.value }));
                setPage(1);
              }}
            >
              <option value="">All event types</option>
              {SECURITY_EVENT_TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>
                  {securityEventLabel(type)}
                </option>
              ))}
            </select>
          </div>
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
        <output className="audit-log-poll-warning">
          Live updates stopped coming through - the rows below may be out of date.{" "}
          <button type="button" className="audit-log-poll-warning-retry" onClick={onRetryNow}>
            Retry now
          </button>
        </output>
      )}

      {listContent}

      {!loading && !error && total > 0 && (
        <div className="audit-log-footer">
          <div className="audit-log-footer__summary">
            <span className="audit-log-footer__info">
              {`Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
            </span>
            <div className="audit-log-pagesize">
              <label htmlFor="security-audit-log-pagesize-select">Rows per page</label>
              <select
                id="security-audit-log-pagesize-select"
                name="security-audit-log-pagesize-select"
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
          </div>
          <div className="audit-log-footer__pager">
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

/** All state + fetch/pagination/scroll-restore logic for the Security view - mirrors the state
 * block inline in AuditLogPanel for the Audit view, extracted into its own hook purely so
 * AuditLogPanel's own body doesn't double in size; the two views intentionally behave
 * identically (same filter/search/pagination/scroll-restore behavior), just against a narrower
 * filter set (no action/event-scope filters - SecurityAuditLog has neither). */
function useSecurityAuditLog() {
  const [entries, setEntries] = useState<SecurityAuditLogEntryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [filters, setFilters] = useState<SecurityLogFilters>({ eventType: "", search: "", start: "", end: "" });
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Set once the first fetch (success or failure) settles, and never reset - lets isInitialLoad
  // below tell "nothing loaded yet" apart from "loaded, and happens to be empty right now" so a
  // filter change that starts (or ends up) at zero rows doesn't re-trigger the skeleton and
  // flash the empty-state text out from under the user. Matches AttendeesPage's hasLoadedOnce.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  // Mirrors SystemLogsPanel's own Live toggle - defaults on, since a security review view is
  // exactly the kind of thing an operator wants to watch update on its own.
  const [live, setLive] = useState(true);
  // True once a run of silent poll ticks has failed POLL_DEGRADED_THRESHOLD times in a row -
  // see the matching comment on SystemLogsPanel's own pollDegraded for why a single miss is
  // never surfaced but a sustained run must not leave "Live" looking green over silently stale
  // rows forever.
  const [pollDegraded, setPollDegraded] = useState(false);
  const pollFailureCountRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const loadSeqRef = useRef(0);
  const scrollRestoreSeqRef = useRef<number | null>(null);

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

  // `silent` is used by the live-poll tick below: same request, but it must never show the
  // dimmed "loading" table state (a nice-to-have refresh becoming a flicker every 1.75s would
  // undo the whole point of the hasLoadedOnce fix above), never clear already-shown rows or
  // surface an error banner for a single missed tick, and never yank the operator to a
  // different page just because the row count shifted underneath them mid-read.
  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      loadAbortRef.current?.abort();
      const ac = new AbortController();
      loadAbortRef.current = ac;
      loadSeqRef.current += 1;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const data = await fetchSecurityAuditLog(
          {
            page,
            pageSize,
            eventType: filters.eventType || undefined,
            search: filters.search || undefined,
            start: filters.start ? utcDayStartIso(filters.start) : undefined,
            end: filters.end ? utcDayEndIso(filters.end) : undefined,
          },
          ac.signal,
        );
        if (ac.signal.aborted) return;
        const maxPage = Math.max(1, Math.ceil(data.total / pageSize));
        if (page > maxPage) {
          if (silent) return;
          setEntries([]);
          setPage(maxPage);
          return;
        }
        setEntries(data.entries);
        setTotal(data.total);
        pollFailureCountRef.current = 0;
        setPollDegraded(false);
      } catch (err) {
        if (ac.signal.aborted) return;
        if (silent) {
          // A single missed live-refresh tick is normal network noise - the next tick
          // POLL_INTERVAL_MS later retries. A sustained run of them (endpoint down, role
          // revoked) must not leave "Live" looking green over silently stale rows forever.
          pollFailureCountRef.current += 1;
          if (pollFailureCountRef.current >= POLL_DEGRADED_THRESHOLD) setPollDegraded(true);
          return;
        }
        setError(operatorApiErrorMessage(err, "Failed to load security audit log."));
        setEntries([]);
        setTotal(0);
      } finally {
        if (!ac.signal.aborted) {
          if (!silent) setLoading(false);
          setHasLoadedOnce(true);
        }
      }
    },
    [page, pageSize, filters.eventType, filters.search, filters.start, filters.end],
  );

  useEffect(() => {
    void load();
    return () => loadAbortRef.current?.abort();
  }, [load]);

  // Live-refresh: re-runs the same query on a timer once the first real load has settled, so a
  // superadmin watching this view sees new failed-login rows land without a manual Refresh -
  // the same reason a security dashboard is worth having open at all. Independent of the
  // effect above (its own deps only touch page/filters) so pausing/resuming Live doesn't
  // re-trigger a fetch, matching SystemLogsPanel's own poll effect.
  useEffect(() => {
    if (!live || !hasLoadedOnce) return;
    // Resuming Live always starts the degraded-state tracking fresh.
    pollFailureCountRef.current = 0;
    setPollDegraded(false);
    const intervalId = window.setInterval(() => void load({ silent: true }), POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [live, hasLoadedOnce, load]);

  const clearFilters = useCallback(() => {
    setFilters({ eventType: "", search: "", start: "", end: "" });
    setSearchInput("");
    setPage(1);
  }, []);

  const hasActiveFilters = useMemo(
    () => !!(filters.eventType || filters.search || filters.start || filters.end),
    [filters.eventType, filters.search, filters.start, filters.end],
  );

  const [exporting, setExporting] = useState(false);
  const { addToast } = useToast();
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await exportSecurityAuditLog({
        eventType: filters.eventType || undefined,
        search: filters.search || undefined,
        start: filters.start ? utcDayStartIso(filters.start) : undefined,
        end: filters.end ? utcDayEndIso(filters.end) : undefined,
      });
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to export security audit log."), "error");
    } finally {
      setExporting(false);
    }
  }, [filters.eventType, filters.search, filters.start, filters.end, addToast]);

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
    hasActiveFilters,
    clearFilters,
    exporting,
    handleExport,
    reload: load,
  };
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
  liveButton: ReactNode;
  pollDegraded: boolean;
  onRetryNow: () => void;
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
  liveButton,
  pollDegraded,
  onRetryNow,
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
            {liveButton}
          </div>
        )}
      </div>

      {pollDegraded && (
        <output className="audit-log-poll-warning">
          Live updates stopped coming through - the rows below may be out of date.{" "}
          <button type="button" className="audit-log-poll-warning-retry" onClick={onRetryNow}>
            Retry now
          </button>
        </output>
      )}

      {listContent}

      {!loading && !error && total > 0 && (
        <div className="audit-log-footer">
          <div className="audit-log-footer__summary">
            <span className="audit-log-footer__info">
              {`Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
            </span>
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
          </div>
          <div className="audit-log-footer__pager">
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

type LogsView = "system" | "audit" | "security";

const LOGS_VIEW_OPTIONS: ReadonlyArray<SegmentedOption<LogsView>> = [
  { value: "system", label: "System" },
  { value: "audit", label: "Audit" },
  { value: "security", label: "Security" },
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
  // Set once the first fetch (success or failure) settles, and never reset - see the matching
  // comment on the Security view's own hasLoadedOnce above for why this replaces entries.length
  // === 0 as the "first load" check.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  // Mirrors the Security view's own live/pollDegraded/pollFailureCountRef above (see the
  // matching comments on useSecurityAuditLog).
  const [live, setLive] = useState(true);
  const [pollDegraded, setPollDegraded] = useState(false);
  const pollFailureCountRef = useRef(0);
  const [events, setEvents] = useState<EventDto[]>([]);
  const [exporting, setExporting] = useState(false);
  const { addToast } = useToast();
  const isDesktop = useIsDesktop();
  const security = useSecurityAuditLog();
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

  // See the matching comment on the Security hook's own load() above for why `silent` exists
  // and what it must never do (dim the table, clear rows, surface an error, or move the page).
  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      loadAbortRef.current?.abort();
      const ac = new AbortController();
      loadAbortRef.current = ac;
      loadSeqRef.current += 1;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
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
          if (silent) return;
          setEntries([]);
          setPage(maxPage);
          return;
        }
        setEntries(data.entries);
        setTotal(data.total);
        pollFailureCountRef.current = 0;
        setPollDegraded(false);
      } catch (err) {
        if (ac.signal.aborted) return;
        if (silent) {
          pollFailureCountRef.current += 1;
          if (pollFailureCountRef.current >= POLL_DEGRADED_THRESHOLD) setPollDegraded(true);
          return;
        }
        setError(operatorApiErrorMessage(err, "Failed to load audit log."));
        setEntries([]);
        setTotal(0);
      } finally {
        if (!ac.signal.aborted) {
          if (!silent) setLoading(false);
          setHasLoadedOnce(true);
        }
      }
    },
    [page, pageSize, filters.actionType, filters.eventId, filters.search, filters.start, filters.end],
  );

  useEffect(() => {
    void load();
    return () => loadAbortRef.current?.abort();
  }, [load]);

  // Live-refresh - see the matching comment on the Security hook's own poll effect above.
  useEffect(() => {
    if (!live || !hasLoadedOnce) return;
    pollFailureCountRef.current = 0;
    setPollDegraded(false);
    const intervalId = window.setInterval(() => void load({ silent: true }), POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [live, hasLoadedOnce, load]);

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

  // Same mobile-double-count reasoning as activeDateCount/actionScopeActiveCount above, applied
  // to the Security view's own (single) filter dropdown.
  const securityActiveDateCount = (security.filters.start ? 1 : 0) + (security.filters.end ? 1 : 0);
  const securityFilterActiveCount =
    (security.filters.eventType ? 1 : 0) + (isDesktop ? 0 : securityActiveDateCount);

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

  const handleCopySecurityRow = useCallback(
    async (entry: SecurityAuditLogEntryDto) => {
      try {
        await navigator.clipboard.writeText(buildSecurityRowSummary(entry));
        addToast("Row copied to clipboard", "success");
      } catch {
        addToast("Could not copy — clipboard access was blocked.", "error");
      }
    },
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

  const showSecurityLoadingSkeleton = useDelayedLoading(security.loading);
  // Mirrors isInitialLoad above - gated on the hook's own hasLoadedOnce, not entries.length,
  // for the same reason (an event-type/search filter with zero matches is still a completed
  // load).
  const isSecurityInitialLoad = security.loading && !security.hasLoadedOnce;

  const securityListContent = (
    <SecurityAuditListContent
      isInitialLoad={isSecurityInitialLoad}
      showLoadingSkeleton={showSecurityLoadingSkeleton}
      error={security.error}
      onRetry={() => void security.reload()}
      entries={security.entries}
      total={security.total}
      hasActiveFilters={security.hasActiveFilters}
      isDesktop={isDesktop}
      loading={security.loading}
      onCopyRow={handleCopySecurityRow}
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

  return (
    <Card
      title={view === "system" ? "System logs" : view === "audit" ? "Audit logs" : "Security logs"}
      className="audit-log-header-card"
      actions={
        <>
          {/* On mobile these move down into the toolbar instead (next to Filters) - a
              narrow card header can only fit the title plus this always-present toggle before
              wrapping onto a second line. Order (both here and in each view's own mobile
              toolbar) is fixed across all three views: Clear filters (if the view has one)
              first, then Export logs, then Live last so it sits directly beside the
              System/Audit/Security selector it's paused/resumed relative to. */}
          {isDesktop && view === "audit" && (
            <>
              {clearFiltersButton}
              {exportButton}
              {auditLiveButton}
            </>
          )}
          {isDesktop && view === "system" && (
            <>
              {downloadButton}
              {liveButton}
            </>
          )}
          {isDesktop && view === "security" && (
            <>
              {securityClearFiltersButton}
              {securityExportButton}
              {securityLiveButton}
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
      {/* All three views stay mounted the whole time, toggled by visibility rather than by
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
          liveButton={auditLiveButton}
          pollDegraded={live && pollDegraded}
          onRetryNow={() => void load()}
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
      <div style={{ display: view === "security" ? undefined : "none" }}>
        <SecurityAuditView
          isDesktop={isDesktop}
          rootRef={security.rootRef}
          searchInput={security.searchInput}
          setSearchInput={security.setSearchInput}
          searchInputRef={security.searchInputRef}
          fromDatePicker={securityFromDatePicker}
          toDatePicker={securityToDatePicker}
          filterActiveCount={securityFilterActiveCount}
          filters={security.filters}
          setFilters={security.setFilters}
          setPage={security.setPage}
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
          setPageSize={security.setPageSize}
          goToPage={security.goToPage}
          totalPages={security.totalPages}
        />
      </div>
    </Card>
  );
}
