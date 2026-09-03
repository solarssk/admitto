import type { WalletPassRegistrationStatus } from "./types.js";

/** Maps a *found* provider registration status onto WalletPass's own registration columns -
 * shared by registration-sync.ts's periodic worker and refresh-wallet-pass-status.ts's manual
 * "Refresh status" action, so the two can't drift on which status field maps to which column.
 * Deliberately just this mapping, not the whole DB write: the two callers stamp
 * registration_checked_at/registration_sync_attempted_at under different scheduling rules (the
 * worker's own stale-row selection depends on registration_sync_attempted_at advancing even on a
 * "not found"/error read, which a manual one-off refresh has no equivalent need for), so unifying
 * the write itself would force one caller's scheduling need onto the other (architect review,
 * 2026-09-03). Callers must only spread this into a write when `status` is non-null - a provider
 * "no match" result is not a confirmed zero (see registration-sync.ts's own doc comment on
 * syncOne). */
export function registrationStatusToWalletPassFields(status: WalletPassRegistrationStatus) {
  return {
    apple_active_registrations: status.appleActiveRegistrations,
    apple_inactive_registrations: status.appleInactiveRegistrations,
    google_active_registrations: status.googleActiveRegistrations,
    google_inactive_registrations: status.googleInactiveRegistrations,
    samsung_active_registrations: status.samsungActiveRegistrations,
    samsung_inactive_registrations: status.samsungInactiveRegistrations,
    first_downloaded_at: status.firstDownloadedAt,
  };
}
