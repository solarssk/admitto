import type { AttendeeStatus } from "@admitto/db";

const ADMITTABLE_STATUSES: AttendeeStatus[] = ["registered", "confirmed"];

/** Attendee statuses allowed through check-in admission (excludes revoked/cancelled). */
export const ADMITTABLE_STATUS_LIST = ADMITTABLE_STATUSES;

/** Whether an attendee status may be admitted at check-in or on the ticket page. */
export function isAdmittable(status: AttendeeStatus): boolean {
  return ADMITTABLE_STATUSES.includes(status);
}

