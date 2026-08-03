import type { BadgeVariant } from "@admitto/ui";
import { daysUntilEvent } from "./event-countdown.js";

export type EventCardStatus = {
  label: string;
  variant: BadgeVariant;
};

/**
 * Calendar month + day for the event card date block.
 * Uses the UTC calendar day from stored `Event.date` (UTC noon sentinel) so the
 * picker day never shifts with the viewer's offset.
 */
export function eventCardDateParts(iso: string): { month: string; day: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { month: "—", day: "—" };
  const month = date
    .toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })
    .toUpperCase();
  const day = date.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" });
  return { month, day };
}

/**
 * Status chip for Events list / operator picker cards.
 * Past active events → Needs archiving; upcoming always “In N days” (not a calendar date).
 */
export function eventCardStatus(event: {
  date: string;
  timezone: string;
  archived_at: string | null;
}): EventCardStatus {
  if (event.archived_at) {
    return { label: "Archived", variant: "neutral" };
  }

  const daysUntil = daysUntilEvent(event.date, event.timezone);
  if (daysUntil == null) {
    return { label: "Active", variant: "info" };
  }
  if (daysUntil < 0) {
    return { label: "Needs archiving", variant: "warn" };
  }
  if (daysUntil === 0) {
    const msLeft = new Date(event.date).getTime() - Date.now();
    const h = Math.max(0, Math.floor((msLeft % 86_400_000) / 3_600_000));
    return {
      label: h === 0 ? "Starting soon" : `Today in ${h}h`,
      variant: "info",
    };
  }
  if (daysUntil === 1) {
    return { label: "Tomorrow", variant: "info" };
  }
  return { label: `In ${daysUntil} days`, variant: "info" };
}
