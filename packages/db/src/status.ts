export type AttendeeStatus = 'registered' | 'confirmed' | 'cancelled';

export type EmailDeliveryPurpose = 'initial' | 'resend';

export type EmailDeliveryStatus =
  | 'queued'
  | 'accepted'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'bounced'
  | 'rejected';

export type WalletPassStatus = 'active' | 'voided' | 'expired';

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

export const ATTENDEE_STATUS = ['registered', 'confirmed', 'cancelled'] as const satisfies AttendeeStatus[];

export const EMAIL_DELIVERY_PURPOSE = ['initial', 'resend'] as const satisfies EmailDeliveryPurpose[];

export const EMAIL_DELIVERY_STATUS = [
  'queued',
  'accepted',
  'sent',
  'delivered',
  'failed',
  'bounced',
  'rejected',
] as const satisfies EmailDeliveryStatus[];

export const WALLET_PASS_STATUS = ['active', 'voided', 'expired'] as const satisfies WalletPassStatus[];

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
  | 'scan_preview'
  | 'item_issued'
  | 'item_returned'
  | 'note_added'
  | 'attendee_edited'
  | 'ticket_resent'
  | 'attendees_imported'
  | 'attendees_exported'
  | 'reports_exported'
  | 'rsvp_status_changed'
  | 'attendee_created_manual';

export const ATTENDEE_ACTION_TYPE = [
  'check_in',
  'check_in_undo',
  'scan_preview',
  'item_issued',
  'item_returned',
  'note_added',
  'attendee_edited',
  'ticket_resent',
  'attendees_imported',
  'attendees_exported',
  'reports_exported',
  'rsvp_status_changed',
  'attendee_created_manual',
] as const satisfies AttendeeActionType[];

/** Maximum note body length (API validation — Lock #8). */
export const MAX_ATTENDEE_NOTE_LENGTH = 2000;

/** Terminal success statuses — initial dedup skips when an existing row has one of these. */
export const EMAIL_DELIVERY_SUCCESS_STATUSES: readonly EmailDeliveryStatus[] = ['accepted', 'sent', 'delivered'];
