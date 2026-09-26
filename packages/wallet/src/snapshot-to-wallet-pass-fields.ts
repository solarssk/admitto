import type { WalletProviderSnapshot } from "./types.js";

/** Maps a *found* provider snapshot onto WalletPass's own registration columns - shared by
 * registration-sync.ts's periodic worker and refresh-wallet-pass-status.ts's manual "Refresh
 * status" action, so the two can't drift on which snapshot field maps to which column. Only the
 * registration counts and first-download time are persisted: `snapshot.validity` is an
 * observation for the domain layer to interpret, never written as-is.
 * Deliberately just this mapping, not the whole DB write: the two callers stamp
 * registration_checked_at/registration_sync_attempted_at under different scheduling rules (the
 * worker's own stale-row selection depends on registration_sync_attempted_at advancing even on a
 * "not found"/error read, which a manual one-off refresh has no equivalent need for), so unifying
 * the write itself would force one caller's scheduling need onto the other (architect review,
 * 2026-09-03). Callers must only spread this into a write when `snapshot` is non-null - a provider
 * "no match" result is not a confirmed zero (see registration-sync.ts's own doc comment on
 * syncOne). A provider that can't report registrations at all (`snapshot.registrations` null)
 * leaves the counts out of the write entirely rather than zeroing them. */
export function snapshotToWalletPassFields(snapshot: WalletProviderSnapshot) {
  const registrations = snapshot.registrations;
  return {
    ...(registrations
      ? {
          apple_active_registrations: registrations.appleActive,
          apple_inactive_registrations: registrations.appleInactive,
          google_active_registrations: registrations.googleActive,
          google_inactive_registrations: registrations.googleInactive,
          samsung_active_registrations: registrations.samsungActive,
          samsung_inactive_registrations: registrations.samsungInactive,
        }
      : {}),
    first_downloaded_at: snapshot.firstDownloadedAt,
  };
}
