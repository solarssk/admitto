import type { CheckInScanResponse } from "../api/types.js";

/**
 * Whether "Auto-advance after valid check-in" should clear the confirmation
 * for this response. A fresh admit with configured items must not be swept
 * away before the operator can hand them out — on either platform. On the
 * mobile overlay that means the item-issuing walkthrough (CameraOverlay's
 * itemStepActive, #434); on desktop it's the "Items to hand out" section on
 * the AttendeeCard with its Mark-issued buttons. Both surfaces gate that block
 * on the same test — any configured item at all (`items.length > 0`), not just
 * ones with a pending action — because an already-issued item (e.g. Badge via
 * badge_at_entry) still needs a step so the operator physically hands it over
 * (Bugbot). So the rule is platform-agnostic: as long as the card carries
 * items, do not advance. It was originally gated behind the mobile overlay
 * only (#454 shipped this fix mobile-first per its PO review); the same PR gave
 * desktop item-list parity but never revisited this check, so the mobile-only
 * gate was the actual desktop bug — the card and its Mark-issued buttons
 * vanished before the operator could use them.
 */
export function shouldAutoAdvance(
  response: CheckInScanResponse,
  opts: { autoAdvanceOnValid: boolean },
): boolean {
  if (!(opts.autoAdvanceOnValid && response.status === "VALID" && response.confirmed)) return false;
  if ((response.card?.items.length ?? 0) > 0) return false;
  return true;
}
