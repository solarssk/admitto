import type { AttendeeActionLogEntryDto } from "../api/types.js";

export function getTimelineIcon(actionType: string): string {
  const icons: Record<string, string> = {
    attendee_created_manual: "user-plus",
    attendees_imported: "upload",
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
    case "attendee_ingested":
      return "Ingested via API";
    case "rsvp_status_changed":
      return `Status changed to ${String(meta.to ?? "updated")}`;
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
      return `${String(from)} → ${String(to)} · ${actor}`;
    }
  }
  return actor;
}
