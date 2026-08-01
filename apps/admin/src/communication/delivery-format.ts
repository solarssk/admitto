import { formatUtcDateTime, formatZonedClockTime } from "../utils/event-dates.js";
import type { DeliveryDto } from "../api/types.js";

/** Format an ISO timestamp for the delivery log, or "-" when absent. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  return formatUtcDateTime(iso);
}

/** The row's client-local time ("HH:MM (IANA, UTC±offset)"), when the send/resend that produced
 * it carried a known browser timezone - same "UTC primary, local secondary" pattern and
 * composition as Audit/Security log's own actorLocalTime, using client_timezone (the browser
 * that triggered the send) instead of an actor's. Null when absent, so callers only render a
 * second line when there's something to show. */
export function deliveryLocalTime(row: Pick<DeliveryDto, "client_timezone">, iso: string | null): string | null {
  if (!iso || !row.client_timezone) return null;
  return formatZonedClockTime(iso, row.client_timezone);
}

export function purposeLabel(purpose: string): string {
  return purpose === "resend" ? "Resend" : "Initial";
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
