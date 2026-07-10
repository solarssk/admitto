import type { AttendeeCardDto, CheckInScanResponse } from "../api/types.js";

/**
 * Derive the scan-result state for a card loaded via manual lookup, mirroring
 * what POST /scan would return for the same attendee (#379). `blocked` takes
 * precedence over admitted: a voided pass reads as REVOKED even if the holder
 * was admitted earlier, matching checkInScan semantics. Non-PREVIEW states are
 * `confirmed: true` — the card came from the server, so the "Awaiting server
 * confirmation" note must not render.
 */
export function scanResultFromCard(card: AttendeeCardDto): CheckInScanResponse {
  if (card.blocked) {
    return { status: "REVOKED", confirmed: true, card, attendeeId: card.id };
  }
  if (card.check_in_status === "admitted") {
    return {
      status: "ALREADY_CHECKED_IN",
      confirmed: true,
      card,
      attendeeId: card.id,
      admittedAt: card.admitted_at ?? undefined,
    };
  }
  return { status: "PREVIEW", confirmed: false, card, attendeeId: card.id };
}
