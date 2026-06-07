export type AttendeeStatus = 'registered' | 'confirmed' | 'cancelled';

export type EmailDeliveryStatus = 'pending' | 'sent' | 'failed' | 'bounced';

export type WalletPassStatus = 'active' | 'voided' | 'expired';

// CheckInStatus represents scanner validation outcomes returned to the scanner UI.
// Only VALID / ALREADY_CHECKED_IN / INVALID / REVOKED are written to the CheckIn
// table — they all have a resolved attendee_id. UNKNOWN_EVENT and NETWORK_ERROR
// are scanner-side results with no valid attendee; they are never persisted.
export type CheckInStatus =
  | 'VALID'
  | 'ALREADY_CHECKED_IN'
  | 'INVALID'
  | 'REVOKED'
  | 'UNKNOWN_EVENT'
  | 'NETWORK_ERROR';

export const ATTENDEE_STATUS = ['registered', 'confirmed', 'cancelled'] as const satisfies AttendeeStatus[];

export const EMAIL_DELIVERY_STATUS = ['pending', 'sent', 'failed', 'bounced'] as const satisfies EmailDeliveryStatus[];

export const WALLET_PASS_STATUS = ['active', 'voided', 'expired'] as const satisfies WalletPassStatus[];

export const CHECKIN_STATUS = [
  'VALID',
  'ALREADY_CHECKED_IN',
  'INVALID',
  'REVOKED',
  'UNKNOWN_EVENT',
  'NETWORK_ERROR',
] as const satisfies CheckInStatus[];
