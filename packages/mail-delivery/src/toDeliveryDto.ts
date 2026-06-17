import type { DeliveryLogEntry } from "./listDeliveries.js";

/** API-safe delivery row (ISO dates, no rendered body). */
export interface DeliveryDto {
  id: string;
  purpose: string;
  status: string;
  recipient_email: string | null;
  rendered_subject: string | null;
  queued_at: string;
  sent_at: string | null;
  failed_at: string | null;
  error_code: string | null;
}

/** Format a Date as ISO string or null for delivery DTOs. */
function isoOrNull(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/** Map a delivery log row to the admin API DTO (no rendered HTML). */
export function toDeliveryDto(entry: DeliveryLogEntry): DeliveryDto {
  return {
    id: entry.id,
    purpose: entry.purpose,
    status: entry.status,
    recipient_email: entry.recipient_email,
    rendered_subject: entry.rendered_subject,
    queued_at: entry.queued_at.toISOString(),
    sent_at: isoOrNull(entry.sent_at),
    failed_at: isoOrNull(entry.failed_at),
    error_code: entry.error_code,
  };
}
