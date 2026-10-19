export type AttendeeStatus = 'registered' | 'confirmed' | 'cancelled' | 'revoked';

export type EmailDeliveryPurpose = 'initial' | 'resend';

export type EmailDeliveryStatus =
  | 'queued'
  | 'accepted'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'bounced'
  | 'rejected'
  | 'cancelled';

// pending: not yet created (on-demand, before first "Add to Wallet" click). failed: last create/
// update attempt errored (see WalletPass.last_error_code).
export type WalletPassStatus = 'pending' | 'active' | 'voided' | 'failed' | 'expired';

// CheckInStatus represents scanner validation outcomes.
// Persisted to CheckIn: VALID / ALREADY_CHECKED_IN / REVOKED (resolved attendee required).
// Never persisted: INVALID / UNKNOWN_EVENT / NETWORK_ERROR (no valid attendee_id).
export type CheckInStatus =
  | 'VALID'
  | 'ALREADY_CHECKED_IN'
  | 'INVALID'
  | 'REVOKED'
  | 'UNDO'
  | 'UNKNOWN_EVENT'
  | 'NETWORK_ERROR';

export const ATTENDEE_STATUS = ['registered', 'confirmed', 'cancelled', 'revoked'] as const satisfies AttendeeStatus[];

/**
 * Statuses that do not consume event capacity and are not expected at the door.
 * Single source of truth for "active attendee" counting (capacity checks,
 * overview KPIs, check-in stats).
 */
export const CAPACITY_EXCLUDED_STATUSES = ['revoked', 'cancelled'] as const satisfies readonly AttendeeStatus[];

export const EMAIL_DELIVERY_PURPOSE = ['initial', 'resend'] as const satisfies EmailDeliveryPurpose[];

export const EMAIL_DELIVERY_STATUS = [
  'queued',
  'accepted',
  'sent',
  'delivered',
  'failed',
  'bounced',
  'rejected',
  'cancelled',
] as const satisfies EmailDeliveryStatus[];

export const WALLET_PASS_STATUS = ['pending', 'active', 'voided', 'failed', 'expired'] as const satisfies WalletPassStatus[];

export const CHECKIN_STATUS = [
  'VALID',
  'ALREADY_CHECKED_IN',
  'INVALID',
  'REVOKED',
  'UNDO',
  'UNKNOWN_EVENT',
  'NETWORK_ERROR',
] as const satisfies CheckInStatus[];

/** Operational item states for event-day ops (ADR 0010). */
export type AttendeeItemStateValue =
  | 'pending'
  | 'issued'
  | 'returned'
  | 'lost'
  | 'problem'
  | 'not_applicable';

export const ATTENDEE_ITEM_STATE = [
  'pending',
  'issued',
  'returned',
  'lost',
  'problem',
  'not_applicable',
] as const satisfies AttendeeItemStateValue[];

/** AttendeeActionLog.action_type values (operator event-day + admin attendee management). */
export type AttendeeActionType =
  | 'check_in'
  | 'check_in_undo'
  | 'check_in_revoked'
  | 'scan_preview'
  | 'item_issued'
  | 'item_returned'
  | 'item_revoked'
  | 'note_added'
  | 'attendee_edited'
  | 'ticket_resent'
  | 'attendees_imported'
  | 'attendees_exported'
  | 'mail_bulk_resend'
  | 'reports_exported'
  | 'rsvp_status_changed'
  | 'attendee_created_manual'
  | 'attendee_erased'
  | 'attendees_bulk_erased'
  | 'pass_revoked'
  | 'pass_restored'
  | 'mail_bulk_send_cancelled';

export const ATTENDEE_ACTION_TYPE = [
  'check_in',
  'check_in_undo',
  'check_in_revoked',
  'scan_preview',
  'item_issued',
  'item_returned',
  'item_revoked',
  'note_added',
  'attendee_edited',
  'ticket_resent',
  'attendees_imported',
  'attendees_exported',
  'mail_bulk_resend',
  'reports_exported',
  'rsvp_status_changed',
  'attendee_created_manual',
  'attendee_erased',
  'attendees_bulk_erased',
  'pass_revoked',
  'pass_restored',
  'mail_bulk_send_cancelled',
] as const satisfies AttendeeActionType[];

/** Maximum note body length (API validation — Lock #8). */
export const MAX_ATTENDEE_NOTE_LENGTH = 2000;

/** Terminal success statuses — initial dedup skips when an existing row has one of these. */
export const EMAIL_DELIVERY_SUCCESS_STATUSES: readonly EmailDeliveryStatus[] = ['accepted', 'sent', 'delivered'];

/** AdminJob.type values (ADR 0042). */
export type AdminJobType = 'import_commit' | 'export' | 'wallet_push';

export const ADMIN_JOB_TYPE = [
  'import_commit',
  'export',
  'wallet_push',
] as const satisfies AdminJobType[];

/** AdminJob.status values. */
export type AdminJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export const ADMIN_JOB_STATUS = [
  'pending',
  'running',
  'succeeded',
  'failed',
] as const satisfies AdminJobStatus[];

/**
 * Registration.status values (guest registration, D-B2). Backed by the CHECK constraint
 * Registration_status_check. A deleted registration is a deleted row, not a status.
 * - awaiting_email: the guest has not confirmed the address yet (no seat, no ticket)
 * - pending: waits for an organiser's decision
 * - waitlist: no free seat, kept in order of arrival
 * - accepted: an Attendee exists (Registration.attendee_id is set exactly then)
 * - rejected: turned down by an organiser
 */
export type RegistrationStatus = 'awaiting_email' | 'pending' | 'waitlist' | 'accepted' | 'rejected';

export const REGISTRATION_STATUS = [
  'awaiting_email',
  'pending',
  'waitlist',
  'accepted',
  'rejected',
] as const satisfies RegistrationStatus[];

/** EventRegistrationSettings.mode values; null (or no settings row) means registration is off. */
export type RegistrationMode = 'automatic' | 'approval';

export const REGISTRATION_MODE = ['automatic', 'approval'] as const satisfies RegistrationMode[];

/** EventRegistrationSettings.access_methods entries (D-C1; exactly one per event in 0.8). */
export type RegistrationAccessMethod = 'link' | 'password' | 'sso';

export const REGISTRATION_ACCESS_METHOD = ['link', 'password', 'sso'] as const satisfies RegistrationAccessMethod[];

/**
 * RegistrationMail.template_name values (D-D1). 'ticket' only triggers the normal ticket send;
 * the other four are the system templates (SYSTEM_TEMPLATE_NAMES in @admitto/mail-templates).
 */
export type RegistrationMailTemplateName =
  | 'registration-confirm'
  | 'registration-received'
  | 'registration-waitlist'
  | 'registration-rejected'
  | 'ticket';

export const REGISTRATION_MAIL_TEMPLATE_NAME = [
  'registration-confirm',
  'registration-received',
  'registration-waitlist',
  'registration-rejected',
  'ticket',
] as const satisfies RegistrationMailTemplateName[];

/** RegistrationMail.status uses the EmailDelivery vocabulary (RegistrationMail_status_check), so
 * the type is `EmailDeliveryStatus`. */
export const REGISTRATION_MAIL_STATUS = EMAIL_DELIVERY_STATUS;
