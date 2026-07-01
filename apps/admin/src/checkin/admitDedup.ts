/** Dedup key for the same physical admit (local scan echo + SSE). */
export function admitDedupKey(attendeeId: string, admittedAt: string): string {
  return JSON.stringify([attendeeId, admittedAt]);
}

const DEDUP_TTL_MS = 5000;

/** Drop admit-dedup entries older than the TTL window. */
export function pruneAdmitDedupMap(map: Map<string, number>, now = Date.now()): void {
  for (const [key, ts] of map) {
    if (now - ts > DEDUP_TTL_MS) map.delete(key);
  }
}

/** Record a recent admit so duplicate SSE/local echoes are ignored. */
export function registerAdmitDedup(
  map: Map<string, number>,
  attendeeId: string,
  admittedAt: string,
  now = Date.now(),
): void {
  map.set(admitDedupKey(attendeeId, admittedAt), now);
  pruneAdmitDedupMap(map, now);
}

/** Whether this admit was seen recently (within the dedup TTL). */
export function isAdmitDedupHit(
  map: Map<string, number>,
  attendeeId: string,
  admittedAt: string,
): boolean {
  return map.has(admitDedupKey(attendeeId, admittedAt));
}

/** Seed dedup keys from an existing sidebar history snapshot. */
export function seedAdmitDedupFromHistory(
  map: Map<string, number>,
  entries: Array<{ attendee_id: string; checked_in_at: string }>,
  now = Date.now(),
): void {
  for (const row of entries) {
    if (row.checked_in_at) {
      registerAdmitDedup(map, row.attendee_id, row.checked_in_at, now);
    }
  }
}

/** Merge a fetched sidebar snapshot with live prepends (SSE/local) without dropping newer rows. */
export function mergeCheckInHistory<T extends { attendee_id: string; checked_in_at: string }>(
  fetched: T[],
  live: T[],
  cap: number,
): T[] {
  const byKey = new Map<string, T>();
  for (const row of fetched) {
    if (row.checked_in_at) {
      byKey.set(admitDedupKey(row.attendee_id, row.checked_in_at), row);
    }
  }
  for (const row of live) {
    if (row.checked_in_at) {
      byKey.set(admitDedupKey(row.attendee_id, row.checked_in_at), row);
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.checked_in_at.localeCompare(a.checked_in_at))
    .slice(0, cap);
}
