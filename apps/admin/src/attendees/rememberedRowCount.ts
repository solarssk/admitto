/** Most rows the skeleton will ever draw, whatever was remembered. */
export const MAX_SKELETON_ROWS = 50;

const keyFor = (eventId: string) => `admitto_attendees_rows_${eventId}`;

/**
 * How many rows the Attendees list showed last time for this event, so the loading skeleton can be
 * the size of the list that is about to replace it instead of a guess. `null` when nothing is
 * remembered. The count is per browser and holds no attendee data.
 *
 * localStorage can throw (private browsing, storage disabled by policy), and Node's own global
 * `localStorage` makes a bare access warn in tests, so check `window` first and never let either
 * break the list.
 */
export function readRememberedRowCount(eventId: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(keyFor(eventId));
    const count = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isInteger(count) && count >= 0 ? Math.min(count, MAX_SKELETON_ROWS) : null;
  } catch {
    return null;
  }
}

export function rememberRowCount(eventId: string, count: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(keyFor(eventId), String(Math.min(count, MAX_SKELETON_ROWS)));
  } catch {
    // Best effort: without it the skeleton simply falls back to its default size.
  }
}
