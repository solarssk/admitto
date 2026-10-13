import { withSessionAdvisoryLock } from "@admitto/db/adapter";

/** All sending paths contend on a per-delivery session, independently of worker job locks. */
export function withDeliveryOwnership<T>(deliveryId: string, run: (assertOwned: () => void) => Promise<T>): Promise<T | undefined> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Delivery ownership requires database configuration");
  return withSessionAdvisoryLock(url, `admitto:delivery:${deliveryId}`, run);
}

/** Advance the persistent revision even when two claims share the same clock millisecond. */
export function nextDeliveryRevision(queuedAt: Date, now = new Date()): Date {
  return new Date(Math.max(now.getTime(), queuedAt.getTime() + 1));
}
