import type { AttendeeRemovalReason } from "@admitto/shared";
import type { AttendeeRowDto, RemoveAttendeesResponse } from "../api/types.js";
import { peopleCount } from "./erasedAttendee.js";

/** What is chosen when the dialog opens. A reason is always chosen (the server needs one), and a duplicate is the
 * commonest mistake. */
export const DEFAULT_REMOVAL_REASON: AttendeeRemovalReason = "duplicate";

/** Why "Remove from event" is off on an archived event: its numbers are final. The way out for a privacy request is
 * named, because that is the one reason to touch an archived event's attendees. */
export const REMOVE_ARCHIVED_TOOLTIP =
  "This event is archived, so its numbers are final. To erase someone's personal data, use Erase personal data.";

/** How many of the `ids` among `rows` have checked in: removing them takes their check-ins out of Reports too. */
export function checkedInAmong(rows: readonly AttendeeRowDto[], ids: ReadonlySet<string>): number {
  return rows.filter((row) => ids.has(row.id) && row.admitted_at !== null).length;
}

/** The warning of the dialog that removes one person who has checked in. */
export const REMOVE_CHECKED_IN_LINE = "Already checked in. The check-in is removed from Reports too.";

/** The warning of the dialog that removes a selection, when some of the people in it have checked in. */
export function removedCheckInsLine(count: number): string {
  return count === 1
    ? "1 person has already checked in. The check-in is removed from Reports too."
    : `${count} people have already checked in. Their check-ins are removed from Reports too.`;
}

/** The toast after a removal. `not_found` is who was gone already, removed by someone else a moment before. */
export function removedToast({ removed, not_found }: RemoveAttendeesResponse): string {
  if (removed === 0) return "Nobody was removed";
  const done = removed === 1 ? "Attendee removed from the event" : `${peopleCount(removed)} removed from the event`;
  if (not_found === 0) return done;
  const gone = not_found === 1 ? "1 was" : `${not_found} were`;
  return `${done}. ${gone} already gone.`;
}
