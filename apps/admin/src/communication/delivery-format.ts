import { formatEventDate, formatEventDateTime, formatEventTime, formatUtcDateTime, formatZonedClockTime } from "../utils/event-dates.js";
import type { DeliveryDto } from "../api/types.js";

/** Format an ISO timestamp for the delivery log, or "-" when absent. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  return formatUtcDateTime(iso);
}

/** Single-line time for Attendee Detail's Delivery history card: actor browser zone when
 * known, else event zone (same Category-1 pattern as Registered on / Activity). Not the
 * Communication log's UTC-primary + local-secondary pair. */
export function formatDeliveryHistoryTime(
  iso: string | null,
  clientTimezone: string | null | undefined,
  eventTimezone: string,
): string {
  if (!iso) return "-";
  return formatEventDateTime(iso, clientTimezone ?? eventTimezone);
}

export interface DeliveryHistoryTimeParts {
  date: string;
  time: string;
}

/** Two-line variant of {@link formatDeliveryHistoryTime} for Attendee Detail's Delivery history
 * row, which stacks date above time so a long subject/recipient pair on the same line isn't
 * squeezed by one wide combined string. */
export function formatDeliveryHistoryTimeParts(
  iso: string | null,
  clientTimezone: string | null | undefined,
  eventTimezone: string,
): DeliveryHistoryTimeParts | null {
  if (!iso) return null;
  const timezone = clientTimezone ?? eventTimezone;
  return { date: formatEventDate(iso, timezone), time: formatEventTime(iso, timezone) };
}

/** The row's client-local time ("HH:MM (IANA, UTC±offset)"), when the send/resend that produced
 * it carried a known browser timezone - same "UTC primary, local secondary" pattern and
 * composition as Audit/Security log's own userLocalTimeText, using client_timezone (the browser
 * that triggered the send) instead of an actor's. Null when absent, so callers only render a
 * second line when there's something to show. */
export function deliveryLocalTime(row: Pick<DeliveryDto, "client_timezone">, iso: string | null): string | null {
  if (!iso || !row.client_timezone) return null;
  return formatZonedClockTime(iso, row.client_timezone);
}

export function purposeLabel(purpose: string): string {
  return purpose === "resend" ? "Resend" : "Initial";
}

/** Tabler icon for a Delivery history row.
 * Failure terminal states use `mail-exclamation` (envelope + !) so the shape itself reads as
 * "something went wrong", not only the red tint. Otherwise the purpose icon stays: ticket for
 * the first send, mail-forward for resends. */
export function deliveryHistoryIcon(
  purpose: string,
  status?: string,
): "ticket" | "mail-forward" | "mail-exclamation" {
  if (status === "bounced" || status === "failed" || status === "rejected") {
    return "mail-exclamation";
  }
  return purpose === "resend" ? "mail-forward" : "ticket";
}

/** Compact header counters for Attendee Detail → Delivery history (icon + number only).
 * "Sent" covers accepted / sent / delivered (transport accepted or later); bounced is its own
 * terminal status and is not double-counted. Failed / rejected / queued are omitted from the
 * chips so the header stays two short icons on mobile. */
export function countDeliveryOutcomes(
  deliveries: ReadonlyArray<{ status: string }>,
): { sent: number; bounced: number } {
  let sent = 0;
  let bounced = 0;
  for (const d of deliveries) {
    if (d.status === "bounced") bounced += 1;
    else if (d.status === "accepted" || d.status === "sent" || d.status === "delivered") sent += 1;
  }
  return { sent, bounced };
}

export function templateLabel(row: Pick<DeliveryDto, "template_name">): string {
  return row.template_name ?? "Default ticket";
}

/** A row's most relevant single timestamp - whichever terminal/queued state it last reached.
 * Used for the log's one-column-at-a-glance display; full per-field timestamps (queued/
 * accepted/sent/failed) are shown individually in the Delivery Details modal. */
export function rowTimestamp(row: Pick<DeliveryDto, "sent_at" | "accepted_at" | "failed_at" | "queued_at">): string | null {
  return row.sent_at ?? row.accepted_at ?? row.failed_at ?? row.queued_at;
}
