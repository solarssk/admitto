/**
 * Shared "is Revoke check-in eligible" rule for the Check-in page's
 * AttendeeCard and the Attendee Detail page's "More actions" menu. Both
 * surfaces derive it from a different DTO shape, so this only centralizes the
 * boolean combination itself — each caller still computes its own `blocked`
 * from whatever "pass isn't admittable" signal it has on hand (the card's own
 * `blocked` flag, consumed via isBlockedStatus, on the Check-in page;
 * attendee.status on the Detail page). Kept in one place because this exact
 * rule already diverged once between the two surfaces during review (#449).
 */
export function canRevokeCheckIn(params: {
  checkInStatus: "admitted" | "not_admitted";
  blocked: boolean;
}): boolean {
  return params.checkInStatus === "admitted" && !params.blocked;
}
