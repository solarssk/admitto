export type AttendeeStatus = 'registered' | 'confirmed' | 'cancelled';

export type EmailDeliveryStatus = 'pending' | 'sent' | 'failed' | 'bounced';

export type WalletPassStatus = 'active' | 'voided' | 'expired';

export const ATTENDEE_STATUS = ['registered', 'confirmed', 'cancelled'] as const satisfies AttendeeStatus[];

export const EMAIL_DELIVERY_STATUS = ['pending', 'sent', 'failed', 'bounced'] as const satisfies EmailDeliveryStatus[];

export const WALLET_PASS_STATUS = ['active', 'voided', 'expired'] as const satisfies WalletPassStatus[];
