/** Shared shape for a delivery row, so the backend's mapper (packages/mail-delivery) and the
 * admin frontend's own API types (apps/admin) don't carry two independently-maintained copies of
 * the same DTO fields (SonarCloud duplication flag on PR #669). Dependency-free, so it's safe in
 * the browser bundle. */

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
