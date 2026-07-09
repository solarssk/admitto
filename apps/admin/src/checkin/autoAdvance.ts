import type { CheckInScanResponse } from "../api/types.js";

/**
 * Whether "Auto-advance after valid check-in" should clear the confirmation
 * for this response. On the mobile overlay, a fresh admit with items still
 * to hand out must not be swept away before the item-issuing step (#434) —
 * the operator needs to see it, not get bounced back to the camera. Desktop
 * keeps the plain auto-advance behaviour regardless of pending items.
 */
export function shouldAutoAdvance(
  response: CheckInScanResponse,
  opts: { autoAdvanceOnValid: boolean; showMobileOverlay: boolean },
): boolean {
  if (!(opts.autoAdvanceOnValid && response.status === "VALID" && response.confirmed)) return false;
  if (opts.showMobileOverlay && response.card?.items.some((item) => item.actions.length > 0)) {
    return false;
  }
  return true;
}
