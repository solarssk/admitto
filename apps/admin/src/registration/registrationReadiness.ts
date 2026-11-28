import type { RegistrationCountsDto } from "../api/types.js";
import { pluralSuffix } from "../utils/pluralize.js";

/** The row "Registrations" of the Overview's Setup checklist (D-B11). */
export interface RegistrationReadinessRow {
  label: "Registrations";
  status: "ok" | "warn";
  detail: string;
  icon: "clipboard-check";
  /** Where the row leads: the requests that wait for a decision when there are some, otherwise the tab. */
  to: string;
}

/** Whether the event holds more seats than its limit (D-B7): lowering the limit never sends anyone away, so the organiser sees it here. */
export function isOverLimit(seats: { used: number; capacity: number | null }): boolean {
  return seats.capacity !== null && seats.used > seats.capacity;
}

/**
 * The checklist row for an event that takes registrations: how many requests wait for a decision, how many are on the waiting
 * list, and, when the event holds more seats than its limit, that it does. `null` while registration is off (a row about
 * something the event does not use would only be noise) and while the numbers are unknown.
 */
export function registrationReadiness(
  counts: RegistrationCountsDto | null,
  eventPath: string,
  seats: { used: number; capacity: number | null },
): RegistrationReadinessRow | null {
  if (!counts || counts.mode === null) return null;
  const waiting = counts.needs_decision;
  const onWaitingList = counts.by_status.waitlist;
  const overLimit = isOverLimit(seats);
  const sentences = [
    waiting > 0
      ? `${waiting} request${pluralSuffix(waiting)} waiting for a decision.`
      : "No requests waiting for a decision.",
  ];
  if (onWaitingList > 0) sentences.push(`${onWaitingList} on the waiting list.`);
  if (overLimit) sentences.push(`Over the limit: ${seats.used} seats taken, limit ${seats.capacity}.`);
  return {
    label: "Registrations",
    status: waiting > 0 || overLimit ? "warn" : "ok",
    detail: sentences.join(" "),
    icon: "clipboard-check",
    to: waiting > 0 ? `${eventPath}/registration?tab=requests&status=pending` : `${eventPath}/registration`,
  };
}
