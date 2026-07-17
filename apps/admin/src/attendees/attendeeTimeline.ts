import type { AttendeeStatus } from "@admitto/db/status";
import type { AttendeeActionLogEntryDto, RsvpStatus } from "../api/types.js";
import { formatEventDateTime, formatUtcDateTime } from "../utils/event-dates.js";
import { RSVP_LABELS } from "./rsvpStatusBadge.js";
import { PASS_STATUS_LABELS } from "./passStatusBadge.js";

/** Event-day operational actions — show in event timezone (Category 1). */
const EVENT_OPERATIONAL_ACTIONS = new Set([
  "check_in",
  "admitted",
  "check_in_undo",
  "check_in_undone",
  "check_in_revoked",
  "note_added",
  "item_issued",
  "item_state_changed",
  "item_returned",
  "item_revoked",
  "scan_preview",
]);

export function isEventOperationalActivity(actionType: string): boolean {
  return EVENT_OPERATIONAL_ACTIONS.has(actionType);
}

/** Activity row timestamp: event TZ for on-site ops, UTC for mail/import/admin rows. */
export function formatActivityTimestamp(
  iso: string,
  actionType: string,
  eventTimezone: string,
): string {
  if (isEventOperationalActivity(actionType)) {
    return formatEventDateTime(iso, eventTimezone);
  }
  return formatUtcDateTime(iso);
}

function formatRsvpStatus(value: unknown): string {
  const key = String(value);
  if (key in RSVP_LABELS) return RSVP_LABELS[key as RsvpStatus];
  return key;
}

function formatPassStatus(value: unknown): string {
  const key = String(value);
  if (key in PASS_STATUS_LABELS) return PASS_STATUS_LABELS[key as AttendeeStatus];
  return key;
}

/** Scalar profile columns get a friendly label; everything else (custom_data source-field keys)
 * is humanized from its raw key - attendeeTimeline has no access to the event's field registry
 * (label config lives server-side, this module only sees the action-log entry itself). */
const PROFILE_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  email: "Email",
  company: "Company",
  department: "Department",
  ticket_type: "Ticket type",
};

export function humanizeFieldKey(key: string): string {
  const spaced = key.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function fieldChangeLabel(key: string): string {
  return PROFILE_FIELD_LABELS[key] ?? humanizeFieldKey(key);
}

const ITEM_STATE_ACTIONS = new Set(["item_issued", "item_returned", "item_revoked"]);

export function getTimelineIcon(actionType: string): string {
  const icons: Record<string, string> = {
    attendee_created_manual: "user-plus",
    attendees_imported: "upload",
    mail_bulk_resend: "send",
    attendee_imported: "upload",
    attendee_ingested: "plug",
    rsvp_status_changed: "calendar-check",
    ticket_sent: "send",
    ticket_resent: "refresh",
    resend_ticket: "refresh",
    mail_delivered: "mail-check",
    mail_bounced: "mail-x",
    check_in: "circle-check",
    admitted: "circle-check",
    check_in_undo: "arrow-back-up",
    check_in_undone: "arrow-back-up",
    check_in_revoked: "ban",
    note_added: "pencil",
    item_issued: "package",
    item_state_changed: "package",
    item_returned: "package",
    item_revoked: "arrow-back-up",
    pass_revoked: "ban",
    pass_restored: "refresh",
    attendee_edited: "pencil",
    scan_preview: "scan",
  };
  return icons[actionType] ?? "history";
}

export function getTimelineLabel(entry: AttendeeActionLogEntryDto): string {
  const meta = entry.metadata ?? {};
  switch (entry.action_type) {
    case "attendee_created_manual":
      return "Created manually";
    case "attendees_imported":
    case "attendee_imported":
      return "Imported from CSV";
    case "mail_bulk_resend":
      return "Bulk ticket send";
    case "attendee_ingested":
      return "Ingested via API";
    case "rsvp_status_changed":
      return `Status changed to ${formatRsvpStatus(meta.to ?? "updated")}`;
    case "ticket_sent":
      return "Ticket sent";
    case "mail_delivered":
      return "Email delivered";
    case "mail_bounced":
      return "Email bounced";
    case "ticket_resent":
    case "resend_ticket":
      return "Ticket resent";
    case "check_in":
    case "admitted":
      return "Checked in";
    case "check_in_undo":
    case "check_in_undone":
      return "Check-in undone";
    case "check_in_revoked":
      return "Check-in revoked";
    case "note_added":
      return "Note added";
    case "item_issued":
    case "item_state_changed":
      return "Badge/Gift bag issued";
    case "item_returned":
      return "Item returned";
    case "item_revoked":
      return "Item reset to pending";
    case "attendee_edited":
      return "Profile updated";
    case "pass_revoked":
      return "Pass revoked";
    case "pass_restored":
      return "Pass restored";
    case "scan_preview":
      return "Scan preview";
    default:
      return entry.action_type.replace(/_/g, " ");
  }
}

/** Human-readable diff for the activity log row, PII-safe by construction: profile edits show
 * which fields changed, never the old/new values themselves (custom_data can hold sensitive
 * text like accessibility notes or emergency contacts - #364). */
export function getTimelineDetail(entry: AttendeeActionLogEntryDto): string {
  const actor = entry.actor_display ?? "System";
  const meta = entry.metadata;
  if (!meta) return actor;

  if (entry.action_type === "rsvp_status_changed") {
    const from = meta.from;
    const to = meta.to;
    if (from != null && to != null) {
      return `${formatRsvpStatus(from)} → ${formatRsvpStatus(to)} · ${actor}`;
    }
  }

  if (entry.action_type === "attendee_edited") {
    const fields = meta.fields;
    if (Array.isArray(fields) && fields.length > 0) {
      return `${fields.map((f) => fieldChangeLabel(String(f))).join(", ")} · ${actor}`;
    }
  }

  if (entry.action_type === "pass_revoked" || entry.action_type === "pass_restored") {
    const from = meta.previous_status;
    if (from != null) {
      const to = entry.action_type === "pass_revoked" ? "revoked" : "registered";
      return `${formatPassStatus(from)} → ${formatPassStatus(to)} · ${actor}`;
    }
  }

  if (ITEM_STATE_ACTIONS.has(entry.action_type)) {
    const itemKey = meta.event_item_key;
    if (typeof itemKey === "string" && itemKey) {
      return `${humanizeFieldKey(itemKey)} · ${actor}`;
    }
  }

  return actor;
}

/** How this attendee was added, read off the oldest loaded action-log entry (#365). Log rows are
 * capped at 50/newest-first (server), so a very active attendee's creation event may have scrolled
 * out of the window - in that case this returns null rather than guessing. */
const SOURCE_LABELS: Record<string, string> = {
  attendee_created_manual: "Added manually",
  attendees_imported: "CSV/XLSX import",
  attendee_imported: "CSV/XLSX import",
  attendee_ingested: "Automatic import",
};

export function deriveAttendeeSource(actionLog: AttendeeActionLogEntryDto[]): string | null {
  if (actionLog.length === 0) return null;
  const oldest = actionLog[actionLog.length - 1];
  return SOURCE_LABELS[oldest.action_type] ?? null;
}
