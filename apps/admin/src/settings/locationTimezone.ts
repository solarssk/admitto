/** Shared helpers for the Location tab's pin footer and timezone mismatch notice. */

/** Format map pin coordinates for the Address card footer. */
export function formatMapCoordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}
