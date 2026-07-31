import type { DeliveryDetailEntry, DeliveryLogEntry } from "./listDeliveries.js";

/** API-safe delivery row (ISO dates, no rendered body). */
export interface DeliveryDto {
  id: string;
  attendee_id: string;
  attendee_name: string;
  purpose: string;
  status: string;
  provider: string;
  provider_message_id: string | null;
  attempts: number;
  retryable: boolean | null;
  recipient_email: string | null;
  rendered_subject: string | null;
  template_id: string | null;
  /** Human-readable template label, null for the built-in default ticket template. */
  template_name: string | null;
  queued_at: string;
  accepted_at: string | null;
  sent_at: string | null;
  failed_at: string | null;
  error_code: string | null;
  /** Sanitized send-error text (tokens/emails/URLs already redacted), null when not applicable. */
  error: string | null;
  /** Triggering admin's IANA timezone at send time, when known. */
  client_timezone: string | null;
}

/** Full single-delivery DTO — superset of `DeliveryDto` with fields only needed by the Delivery
 * Details view (not the list), plus the attendee's full delivery timeline. */
export interface DeliveryDetailDto extends DeliveryDto {
  batch_id: string | null;
  actor_user_id: string | null;
  /** Resolved display label for `actor_user_id` (email or display name), null when unknown/unset
   * or the acting user account no longer exists. */
  actor_display: string | null;
  session_id: string | null;
  /** Every delivery for the same attendee, oldest first (this one included). */
  timeline: DeliveryDto[];
}

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
