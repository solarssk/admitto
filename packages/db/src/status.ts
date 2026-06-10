export type AttendeeStatus = 'registered' | 'confirmed' | 'cancelled';

export type EmailDeliveryStatus = 'pending' | 'sent' | 'failed' | 'bounced';

export type WalletPassStatus = 'active' | 'voided' | 'expired';

// CheckInStatus represents scanner validation outcomes.
// Persisted to CheckIn: VALID / ALREADY_CHECKED_IN / REVOKED (resolved attendee required).
// Never persisted: INVALID / UNKNOWN_EVENT / NETWORK_ERROR (no valid attendee_id).
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
