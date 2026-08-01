import type { DeliveryDetailDto, DeliveryDto } from "@admitto/shared";
import type { DeliveryDetailEntry, DeliveryLogEntry } from "./listDeliveries.js";

export type { DeliveryDetailDto, DeliveryDto };

/** Format a Date as ISO string or null for delivery DTOs. */
function isoOrNull(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/** Map a delivery log row to the admin API DTO (no rendered HTML). */
export function toDeliveryDto(entry: DeliveryLogEntry): DeliveryDto {
  return {
    id: entry.id,
    attendee_id: entry.attendee_id,
    attendee_name: entry.attendee_name,
    purpose: entry.purpose,
    status: entry.status,
    provider: entry.provider,
    provider_message_id: entry.provider_message_id,
    attempts: entry.attempts,
    retryable: entry.retryable,
    recipient_email: entry.recipient_email,
    rendered_subject: entry.rendered_subject,
    template_id: entry.template_id,
    template_name: entry.template_name,
    queued_at: entry.queued_at.toISOString(),
    accepted_at: isoOrNull(entry.accepted_at),
    sent_at: isoOrNull(entry.sent_at),
    failed_at: isoOrNull(entry.failed_at),
    error_code: entry.error_code,
    error: entry.error,
    client_timezone: entry.client_timezone,
  };
}

/** Map a delivery detail row + resolved actor display + timeline to the admin API detail DTO. */
export function toDeliveryDetailDto(
  entry: DeliveryDetailEntry,
  actorDisplay: string | null,
  timeline: DeliveryLogEntry[],
): DeliveryDetailDto {
  return {
    ...toDeliveryDto(entry),
    batch_id: entry.batch_id,
    actor_user_id: entry.actor_user_id,
    actor_display: actorDisplay,
    session_id: entry.session_id,
    timeline: timeline.map(toDeliveryDto),
  };
}
