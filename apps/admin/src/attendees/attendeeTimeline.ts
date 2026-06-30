import type { AttendeeActionLogEntryDto, RsvpStatus } from "../api/types.js";
import { formatEventDateTime, formatUtcDateTime } from "../utils/event-dates.js";
import { RSVP_LABELS } from "./rsvpStatusBadge.js";

/** Event-day operational actions — show in event timezone (Category 1). */
const EVENT_OPERATIONAL_ACTIONS = new Set([
  "check_in",
  "admitted",
  "check_in_undo",
  "check_in_undone",
  "note_added",
  "item_issued",
  "item_state_changed",
  "item_returned",
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
    note_added: "pencil",
    item_issued: "package",
    item_state_changed: "package",
    item_returned: "package",
    pass_revoked: "ban",
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
    case "note_added":
      return "Note added";
    case "item_issued":
    case "item_state_changed":
      return "Badge/Gift bag issued";
    case "item_returned":
      return "Item returned";
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

export function getTimelineDetail(entry: AttendeeActionLogEntryDto): string {
  const actor = entry.actor_display ?? "System";
  if (entry.action_type === "rsvp_status_changed" && entry.metadata) {
    const from = entry.metadata.from;
    const to = entry.metadata.to;
    if (from != null && to != null) {
      return `${formatRsvpStatus(from)} → ${formatRsvpStatus(to)} · ${actor}`;
    }
  }
  return actor;
}
