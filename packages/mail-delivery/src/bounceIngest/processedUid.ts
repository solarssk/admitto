import type { PrismaClient } from "@admitto/db";
import { lookbackSince } from "./resolveAuth.js";

/** Record that an IMAP UID was already handled for this event/folder (idempotent ingest). */
export async function markUidProcessed(
  db: PrismaClient,
  eventId: string,
  folder: string,
  uid: string,
): Promise<void> {
  await db.bounceIngestProcessedUid.upsert({
    where: {
      event_id_folder_uid: { event_id: eventId, folder, uid },
    },
    create: { event_id: eventId, folder, uid },
    update: { processed_at: new Date() },
  });
}

export async function isUidProcessed(
  db: PrismaClient,
  eventId: string,
  folder: string,
  uid: string,
): Promise<boolean> {
  const row = await db.bounceIngestProcessedUid.findUnique({
    where: {
      event_id_folder_uid: { event_id: eventId, folder, uid },
    },
    select: { id: true },
  });
  return row !== null;
}

/** All processed UIDs for an event+folder (one query for skip-before-fetch). */
export async function listProcessedUids(
  db: PrismaClient,
  eventId: string,
  folder: string,
): Promise<Set<string>> {
  const rows = await db.bounceIngestProcessedUid.findMany({
    where: { event_id: eventId, folder },
    select: { uid: true },
  });
  return new Set(rows.map((r) => r.uid));
}

/**
 * Delete UID markers older than the IMAP lookback window. A successful ingest
 * bounds this table to UIDs seen during the rolling lookback period.
 */
export async function pruneProcessedUidsOlderThan(
  db: PrismaClient,
  since: Date = lookbackSince(),
): Promise<number> {
  const result = await db.bounceIngestProcessedUid.deleteMany({
    where: { processed_at: { lt: since } },
  });
  return result.count;
}
