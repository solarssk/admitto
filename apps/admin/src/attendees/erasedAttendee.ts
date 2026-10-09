import type { AttendeeStatus } from "@admitto/db/status";
import type { AttendeeDetailDto, AttendeeRowDto, EraseAttendeesResponse } from "../api/types.js";
import {
  formatAdmissionDisplayParts,
  formatEventClockTime,
  formatEventDate,
  truncatedToEventHour,
  type AdmissionDisplayParts,
} from "../utils/event-dates.js";

/** What every screen calls a person whose data was erased. The server's placeholder name is never
 * shown, so a changed placeholder cannot reach the screen. */
export const ERASED_ATTENDEE_LABEL = "Erased attendee";

/** "Erased on 08 Oct 2026", in the event's time zone. */
export function erasedOnLabel(erasedAt: string, timezone: string): string {
  return `Erased on ${formatEventDate(erasedAt, timezone)}`;
}

/** "1 person" / "12 people". */
export function peopleCount(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

/** "1 anonymous entry" / "12 anonymous entries": what an erasure leaves in Reports. */
export function anonymousEntries(n: number): string {
  return `${n} anonymous ${n === 1 ? "entry" : "entries"}`;
}

/**
 * Whether erasing this person frees their place. Someone who has not been admitted and is
 * registered or confirmed becomes cancelled, but not on an archived event, whose numbers are
 * final. Mirrors the rule in `eraseAttendees` (packages/tickets); the server is the authority, this
 * only decides whether the dialog says so.
 */
export function erasureFreesPlace(
  attendee: { status: AttendeeStatus; admitted_at: string | null },
  eventArchived: boolean,
): boolean {
  if (eventArchived || attendee.admitted_at !== null) return false;
  return attendee.status === "registered" || attendee.status === "confirmed";
}

/** The line under the Attendees list while erased entries are left out of it. */
export function hiddenErasedLine(count: number): string {
  return count === 1
    ? "1 erased entry is hidden. Reports still count it."
    : `${count} erased entries are hidden. Reports still count them.`;
}

/**
 * The line under the Attendees list while erased entries are shown in it. It carries no count: the
 * count of the hidden line is the event's, but the rows are filtered and paged, so a number here
 * could say 20 beside a result of three.
 */
export function shownErasedLine(): string {
  return "Erased entries are included. Reports count them too.";
}

/** The toast after an erasure that left nothing to do at the wallet provider. */
export function erasedToast({ erased, already_erased }: Pick<EraseAttendeesResponse, "erased" | "already_erased">): string {
  if (erased > 0) return erased === 1 ? "Personal data erased" : `Personal data of ${peopleCount(erased)} erased`;
  return already_erased > 0 ? "Already erased" : "Nobody was erased";
}

/** The accessible name of the checkbox an erased entry has, and which stays off. */
export const ERASED_NOT_SELECTABLE_LABEL = "Erased entries cannot be selected";

/** The accessible name of a row's checkbox. */
export function selectRowLabel(row: Pick<AttendeeRowDto, "name" | "erased_at">): string {
  return row.erased_at ? ERASED_NOT_SELECTABLE_LABEL : `Select ${row.name}`;
}

/**
 * What the first column of a list row shows. An erased entry never shows its placeholder name or
 * address: it says what it is, and when it was erased in place of the address.
 */
export function rowIdentity(
  row: Pick<AttendeeRowDto, "name" | "email" | "erased_at">,
  eventTimezone: string,
): { erased: boolean; name: string; detail: string } {
  if (!row.erased_at) return { erased: false, name: row.name, detail: row.email };
  return { erased: true, name: ERASED_ATTENDEE_LABEL, detail: erasedOnLabel(row.erased_at, eventTimezone) };
}

/** The wallet chip of an erased attendee's status strip: what became of the pass at the provider. */
export function erasedWalletChipLabel(detail: Pick<AttendeeDetailDto, "wallet_pass" | "wallet_pass_delete_pending">): string {
  if (detail.wallet_pass?.provider_removed_at) return "Pass removed";
  return detail.wallet_pass_delete_pending ? "To be deleted" : "No pass";
}

/**
 * The check-in cell of an erased attendee's status strip. The time an erasure keeps is cut to the
 * hour, so it reads "Around 10:00": without the UTC offset, which would not fit the chip beside it
 * and means little for an approximate time (the day is the event's own, as everywhere).
 */
export function erasedCheckInParts(admittedAt: string | null, timezone: string): AdmissionDisplayParts | null {
  if (admittedAt === null) return null;
  const clock = formatEventClockTime(admittedAt, timezone);
  return { day: formatAdmissionDisplayParts(admittedAt, timezone).day, time: `Around ${clock}` };
}

/** What the screen knows when the server has confirmed an erasure, to show what the server now holds. */
export type ConfirmedErasure = {
  /** When, as far as the screen knows (the server stamps its own time). */
  at: string;
  /** The event's zone: a check-in time is cut to the hour in it. */
  timezone: string;
  /** On an archived event nobody is cancelled, because the numbers there are final. */
  eventArchived: boolean;
};

/**
 * What an erasure leaves of a row's check-in time and status, as the server does it (`eraseAttendees`
 * in packages/tickets): the time cut to the hour, and a person who was not admitted cancelled, so
 * their place is free again. The exact minute must not stay on screen after the server has cut it.
 */
function admissionAfterErasure(
  row: { status: AttendeeStatus; admitted_at: string | null },
  erasure: ConfirmedErasure,
): { status: AttendeeStatus; admitted_at: string | null } {
  return {
    status: erasureFreesPlace(row, erasure.eventArchived) ? "cancelled" : row.status,
    admitted_at: row.admitted_at === null ? null : truncatedToEventHour(row.admitted_at, erasure.timezone),
  };
}

/**
 * What the attendee page holds right after the server has confirmed an erasure: the detail with
 * everything personal taken out and the erased marker set, the check-in time cut to the hour and the
 * pass marked as still at the provider when the answer said so (`walletPending`). The page then reads
 * the server's version to fill in what the entry keeps; until that answers, or for good if the read
 * fails, nothing of the person stays on screen, the page is the read-only one, and its Try again for
 * a pass that is still at the provider is there.
 */
export function redactedAfterErasure(
  detail: AttendeeDetailDto,
  erasure: ConfirmedErasure,
  walletPending: boolean,
): AttendeeDetailDto {
  return {
    ...detail,
    ...admissionAfterErasure(detail, erasure),
    erased_at: erasure.at,
    name: ERASED_ATTENDEE_LABEL,
    first_name: null,
    last_name: null,
    email: "",
    company: null,
    department: null,
    custom_data: null,
    deliveries: detail.deliveries.map((delivery) => ({
      ...delivery,
      attendee_name: ERASED_ATTENDEE_LABEL,
      recipient_email: null,
      rendered_subject: null,
      provider_message_id: null,
      error: null,
    })),
    wallet_apple_link: null,
    wallet_google_link: null,
    wallet_pass:
      detail.wallet_pass === null
        ? null
        : { ...detail.wallet_pass, apple_url: null, android_url: null, user_agent: null, user_agent_captured_at: null },
    action_log: [],
    action_log_total: 0,
    action_log_first_action_type: null,
    action_log_snapshot: null,
    notes: [],
    notes_total: 0,
    wallet_pass_delete_pending: walletPending,
  };
}

/**
 * What the Attendees list holds right after the server has confirmed the erasure of `ids`: those
 * rows, redacted in place (the erased marker set, name, address, company and department taken out,
 * the check-in time cut to the hour). The list then reads the server's version, which leaves them
 * out unless erased entries are shown; until that answers, or if it is slow, nothing of those people
 * stays on screen, and the page does not empty out from under the operator.
 */
export function redactedRowsAfterErasure(
  items: readonly AttendeeRowDto[],
  ids: ReadonlySet<string>,
  erasure: ConfirmedErasure,
): AttendeeRowDto[] {
  return items.map((row) =>
    ids.has(row.id)
      ? {
          ...row,
          ...admissionAfterErasure(row, erasure),
          erased_at: erasure.at,
          name: ERASED_ATTENDEE_LABEL,
          email: "",
          company: null,
          department: null,
        }
      : row,
  );
}

/**
 * Erasure cannot be undone, so an answer that shows the attendee the page already holds as erased
 * without the erased marker was computed before the erasure and reached the page late (a note saved
 * a moment before it, say). It is older than what the page shows and must not replace it.
 */
export function isOlderThanErasure(held: AttendeeDetailDto | null, answer: AttendeeDetailDto): boolean {
  return held !== null && Boolean(held.erased_at) && held.id === answer.id && !answer.erased_at;
}
