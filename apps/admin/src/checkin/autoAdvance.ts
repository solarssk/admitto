import type { CheckInScanResponse } from "../api/types.js";

/**
 * Whether "Auto-advance after valid check-in" should clear the confirmation
 * for this response. On the mobile overlay, a fresh admit with configured
 * items must not be swept away before the item-issuing step (#434) — the
 * operator needs to see it, not get bounced back to the camera. This must
 * match CameraOverlay's itemStepActive, which shows the walkthrough for
 * every configured item (not just ones with a pending action) as a reminder
 * to physically hand over already-issued items too (e.g. badge_at_entry) —
 * checking only `actions.length > 0` here let auto-advance dismiss the card
 * before that reminder ever rendered (Bugbot). Desktop keeps the plain
 * auto-advance behaviour regardless of items.
 */
export function shouldAutoAdvance(
  response: CheckInScanResponse,
  opts: { autoAdvanceOnValid: boolean; showMobileOverlay: boolean },
): boolean {
  if (!(opts.autoAdvanceOnValid && response.status === "VALID" && response.confirmed)) return false;
  if (opts.showMobileOverlay && (response.card?.items.length ?? 0) > 0) {
    return false;
  }
  return true;
}
