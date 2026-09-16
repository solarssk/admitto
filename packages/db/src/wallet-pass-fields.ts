import type { WalletPassStatus } from './status.js';

/** WalletPass fields as exposed over the admin API - single source of truth for a shape that
 * apps/web (attendees-api-routes.ts's serializeWalletPassAction) and apps/admin (its own DTO of
 * the same name) both need declared independently, since neither app can import runtime code from
 * the other. Import-type only, so this carries zero bundle cost into the admin SPA - same pattern
 * as WalletPassStatus above. */
export interface WalletPassApiFields {
  status: WalletPassStatus;
  issued_at: string | null;
  voided_at: string | null;
  apple_url: string | null;
  android_url: string | null;
  last_synced_at: string | null;
  last_error_code: string | null;
  apple_active_registrations: number | null;
  apple_inactive_registrations: number | null;
  google_active_registrations: number | null;
  google_inactive_registrations: number | null;
  samsung_active_registrations: number | null;
  samsung_inactive_registrations: number | null;
  // Provider-reported string, deliberately not parsed to a Date - see the schema comment on
  // WalletPass.first_downloaded_at for why (unconfirmed timezone).
  first_downloaded_at: string | null;
  registration_checked_at: string | null;
  // Set only by PassCreator's own confirmed-registration webhook - see
  // WalletPass.first_confirmed_at's schema comment.
  first_confirmed_at: string | null;
  // Raw captured User-Agent - see WalletPass.user_agent's schema comment.
  user_agent: string | null;
  user_agent_captured_at: string | null;
}
