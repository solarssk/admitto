import type { AttendeeStatus } from "@admitto/db";

const ADMITTABLE_STATUSES: AttendeeStatus[] = ["registered", "confirmed"];

export function isAdmittable(status: AttendeeStatus): boolean {
  return ADMITTABLE_STATUSES.includes(status);
}

export const ADMITTABLE_STATUS_LIST = ADMITTABLE_STATUSES;
