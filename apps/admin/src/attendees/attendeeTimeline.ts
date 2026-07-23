import type { AttendeeStatus } from "@admitto/db/status";
import type { AttendeeActionLogEntryDto, AttendeeDetailItemDto, RsvpStatus } from "../api/types.js";
import { formatEventDateTime } from "../utils/event-dates.js";
import type { CustomDataFieldDef } from "./customData.js";
import { RSVP_LABELS } from "./rsvpStatusBadge.js";
import { PASS_STATUS_LABELS } from "./passStatusBadge.js";

/** Activity row timestamp, in the timezone the acting admin was actually in when they made this
 * change (PO review, round 2 - the prior "always event timezone" version was itself wrong):
 * admins managing an event travel, so a single global rule (UTC, or always the event's zone)
 * can't be right for every row - an edit made from Zurich should read as Zurich time forever,
 * and a later on-site check-in in Bangalore should read as Bangalore time forever, even once
 * the admin is back in Zurich looking at the log. `entryTimezone` is the zone captured at write
 * time (see OpsAuditContext.timezone); falls back to the event's zone for rows written before
 * this capture existed, or from a non-browser path that never had one to capture. */
export function formatActivityTimestamp(
  iso: string,
  entryTimezone: string | null,
  eventTimezone: string,
): string {
  return formatEventDateTime(iso, entryTimezone ?? eventTimezone);
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

/** Scalar profile columns get a friendly label; a configured custom_data field gets its registry
 * label (passed in by the caller, see getTimelineDetail's customFields param); anything else (a
 * CSV import column with no matching event item, or a field removed from the event's requirements
 * after import) is humanized from its raw key - which is a lossy last resort, since a slugified
 * source_field key has already dropped whatever diacritics its label had (e.g. "niepe_nosprawnosc"
 * for "Niepełnosprawność" - PO review). */
const PROFILE_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  email: "Email",
  company: "Company",
  department: "Department",
  ticket_type: "Ticket type",
};

export function humanizeFieldKey(key: string): string {
  const spaced = key.replaceAll("_", " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function fieldChangeLabel(key: string, customFieldLabels: Map<string, string>): string {
  return PROFILE_FIELD_LABELS[key] ?? customFieldLabels.get(key) ?? humanizeFieldKey(key);
}

/** Reads `metadata.field_changes[key]` for `attendee_edited` rows, if present - the backend only
 * populates this for a fixed subset (email/company/department/ticket_type, see
 * LOGGED_VALUE_FIELDS in attendees-api-routes.ts and DATA-PROTECTION.md's "Admin audit trail"
 * section); `name` and every custom_data field are deliberately never in there (#364), so this
 * returns null for those and the caller falls back to showing just the field name. */
function fieldValueChange(
  fieldChanges: unknown,
  key: string,
): { from: string | null; to: string | null } | null {
  if (!fieldChanges || typeof fieldChanges !== "object") return null;
  const change = (fieldChanges as Record<string, unknown>)[key];
  if (!change || typeof change !== "object") return null;
  const { from, to } = change as { from?: unknown; to?: unknown };
  if (typeof from !== "string" && from !== null) return null;
  if (typeof to !== "string" && to !== null) return null;
  return { from, to };
}

// item_state_changed isn't produced by any current writer (getTimelineIcon/getTimelineLabel
// already treat it as a synonym of item_issued defensively) - included here too so the detail
// line resolves the same way if it's ever emitted, rather than only the headline being right.
const ITEM_STATE_ACTIONS = new Set([
  "item_issued",
  "item_state_changed",
  "item_returned",
  "item_revoked",
]);

export type TimelineTone = "ok" | "warn" | "error" | "neutral";

/** Static tone per action type, mirroring the status-strip chips' ok/warn/error/neutral
 * vocabulary (`.attendee-status-chip__icon--*`) so the Activity log's icons read the same way -
 * PO review: every icon rendered in the same dark tone regardless of outcome, making the log
 * hard to scan for what actually went wrong vs. routine. Most rows (imports, sends, edits, notes)
 * are purely informational and stay neutral; only a genuine positive/negative outcome gets ok/error. */
const TONE_BY_ACTION: Record<string, TimelineTone> = {
  check_in: "ok",
  admitted: "ok",
  item_issued: "ok",
  item_state_changed: "ok",
  pass_restored: "ok",
  mail_delivered: "ok",
  check_in_revoked: "error",
  pass_revoked: "error",
  mail_bounced: "error",
  item_revoked: "error",
};

/** rsvp_status_changed varies by the change's own target status rather than a fixed per-action
 * tone, matching how getTimelineLabel already reads meta.to for its label text. */
export function getTimelineTone(entry: AttendeeActionLogEntryDto): TimelineTone {
  if (entry.action_type === "rsvp_status_changed") {
    const rawTo = entry.metadata?.to;
    const to = typeof rawTo === "string" ? rawTo : "";
    if (to === "confirmed") return "ok";
    if (to === "declined" || to === "cancelled") return "error";
    if (to === "tentative") return "warn";
    return "neutral";
  }
  return TONE_BY_ACTION[entry.action_type] ?? "neutral";
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
      return "Item issued";
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
      return entry.action_type.replaceAll("_", " ");
  }
}

/** Who performed the row's action, shown next to the timestamp rather than mixed into the diff
 * text below the headline (PO review) - a row with no other detail (e.g. a QR check-in) used to
 * fall back to showing just this, which is now handled by getTimelineDetail returning "" instead. */
export function getTimelineActor(entry: AttendeeActionLogEntryDto): string {
  return entry.actor_display ?? "System";
}

function rsvpChangeDetail(
  entry: AttendeeActionLogEntryDto,
  meta: Record<string, unknown>,
): string | null {
  if (entry.action_type !== "rsvp_status_changed") return null;
  const { from, to } = meta;
  if (from == null || to == null) return null;
  return `${formatRsvpStatus(from)} → ${formatRsvpStatus(to)}`;
}

/** email/company/department/ticket_type are the one approved exception to #364's field-names-only
 * rule (PO review, round 2) - a deliberate accountability record covered by the same erasure as
 * the rest of the attendee's data, see DATA-PROTECTION.md's "Admin audit trail" section - and
 * show their real before/after value when the backend captured one (see fieldValueChange,
 * LOGGED_VALUE_FIELDS in attendees-api-routes.ts). `name` and every custom_data field never get
 * one (can hold GDPR Art. 9 special-category data a guest typed in - dietary, accessibility,
 * emergency contact), so this falls back to the field name alone for those. */
function attendeeEditedDetail(
  entry: AttendeeActionLogEntryDto,
  meta: Record<string, unknown>,
  customFields: CustomDataFieldDef[],
): string | null {
  if (entry.action_type !== "attendee_edited") return null;
  const fields = meta.fields;
  if (!Array.isArray(fields) || fields.length === 0) return null;
  const customFieldLabels = new Map(customFields.map((f) => [f.source_field, f.label]));
  return fields
    .map((f) => {
      const key = String(f);
      const label = fieldChangeLabel(key, customFieldLabels);
      const change = fieldValueChange(meta.field_changes, key);
      return change ? `${label}: ${change.from ?? "—"} → ${change.to ?? "—"}` : label;
    })
    .join(", ");
}

function passChangeDetail(
  entry: AttendeeActionLogEntryDto,
  meta: Record<string, unknown>,
): string | null {
  if (entry.action_type !== "pass_revoked" && entry.action_type !== "pass_restored") return null;
  const from = meta.previous_status;
  if (from == null) return null;
  const to = entry.action_type === "pass_revoked" ? "revoked" : "registered";
  return `${formatPassStatus(from)} → ${formatPassStatus(to)}`;
}

/** `eventItems` is the same registry-backed list the Event-day items card renders
 * (detail.event_items) - an item's real configured label (e.g. "Gratis") beats humanizing its
 * raw key, same reasoning as fieldChangeLabel for custom_data fields. */
function itemStateDetail(
  entry: AttendeeActionLogEntryDto,
  meta: Record<string, unknown>,
  eventItems: AttendeeDetailItemDto[],
): string | null {
  if (!ITEM_STATE_ACTIONS.has(entry.action_type)) return null;
  const itemKey = meta.event_item_key;
  if (typeof itemKey !== "string" || !itemKey) return null;
  const itemLabels = new Map(eventItems.map((i) => [i.key, i.label]));
  return itemLabels.get(itemKey) ?? humanizeFieldKey(itemKey);
}

/** Human-readable diff for the activity log row - who did it is getTimelineActor's job, not
 * this function's; empty string means there's nothing beyond the headline to show. PII-safe by
 * construction: `name` and every custom_data field only ever show which field changed, never
 * the old/new values themselves (custom_data can hold sensitive text like accessibility notes or
 * emergency contacts - #364); see attendeeEditedDetail for the one approved exception.
 * `customFields` is the event's custom-field registry (same list `allCustomDataEntries` uses) -
 * passing it lets a changed custom field show its real configured label instead of a humanized
 * guess at its slugified source_field key (PO review, see fieldChangeLabel). */
export function getTimelineDetail(
  entry: AttendeeActionLogEntryDto,
  customFields: CustomDataFieldDef[] = [],
  eventItems: AttendeeDetailItemDto[] = [],
): string {
  const meta = entry.metadata;
  if (!meta) return "";
  return (
    rsvpChangeDetail(entry, meta) ??
    attendeeEditedDetail(entry, meta, customFields) ??
    passChangeDetail(entry, meta) ??
    itemStateDetail(entry, meta, eventItems) ??
    ""
  );
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
  const oldest = actionLog.at(-1);
  if (!oldest) return null;
  return SOURCE_LABELS[oldest.action_type] ?? null;
}
