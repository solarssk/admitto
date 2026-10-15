import type { PrismaClient } from "@admitto/db";
import { emitSystemLog } from "@admitto/shared/system-log";

/** The last pass a sweep tried: sweeps go by event id, then attendee id. */
export type Cursor = { eventId: string; attendeeId: string };

/** The part of an event's passes to try: after `after` and up to `upTo` (attendee ids), either may be left out. */
export type Range = { after?: string; upTo?: string };

/** Reads the place a sweep stopped at (a SystemSettings row under `key`), or null when it kept none. */
export async function readCursor(db: PrismaClient, key: string): Promise<Cursor | null> {
  try {
    const row = await db.systemSettings.findUnique({ where: { key } });
    if (!row) return null;
    const parsed = JSON.parse(row.value_json) as Partial<Cursor>;
    return typeof parsed.eventId === "string" && typeof parsed.attendeeId === "string"
      ? { eventId: parsed.eventId, attendeeId: parsed.attendeeId }
      : null;
  } catch {
    // Without it the sweep starts from the beginning, which is what it did before it kept a place.
    return null;
  }
}

/** Keeps the place (or forgets it, with null). A failure to do so only costs the next sweep its head start. */
export async function writeCursor(db: PrismaClient, key: string, cursor: Cursor | null): Promise<void> {
  try {
    if (cursor === null) {
      await db.systemSettings.deleteMany({ where: { key } });
      return;
    }
    const value_json = JSON.stringify(cursor);
    await db.systemSettings.upsert({ where: { key }, create: { key, value_json }, update: { value_json } });
  } catch {
    emitSystemLog("wallet", "warn", "wallet_pass_sweep_cursor_not_saved", { key });
  }
}

/**
 * The events and the parts of them to try, in the order of this sweep: after `cursor` (the last pass the sweep
 * before it tried), to the end, then from the beginning up to it. A sweep that ran out of time therefore goes on
 * where it stopped instead of trying the same first passes again, and a pass that keeps failing cannot keep the
 * ones behind it from being tried. Without a cursor it is the order by event id, then attendee id.
 */
export function inSweepOrder<T extends { event: { id: string } }>(items: T[], cursor: Cursor | null): Array<T & { range: Range }> {
  const whole = (item: T) => ({ ...item, range: {} });
  if (!cursor) return items.map(whole);
  const own = items.find((item) => item.event.id === cursor.eventId);
  return [
    ...(own ? [{ ...own, range: { after: cursor.attendeeId } }] : []),
    ...items.filter((item) => item.event.id > cursor.eventId).map(whole),
    ...items.filter((item) => item.event.id < cursor.eventId).map(whole),
    ...(own ? [{ ...own, range: { upTo: cursor.attendeeId } }] : []),
  ];
}
