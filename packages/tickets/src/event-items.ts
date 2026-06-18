import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

const DEFAULT_EVENT_ITEMS = [
  {
    key: "giftbag",
    label: "Gift bag",
    config: { contents: [{ label: "Shirt size", source_field: "shirt_size" }] },
  },
  { key: "badge", label: "Badge", config: { issue_on_checkin: true } },
  { key: "headset", label: "Headset", config: { requires_return: true } },
] as const;

export const DEFAULT_EVENT_ITEM_KEYS: ReadonlySet<string> = new Set(
  DEFAULT_EVENT_ITEMS.map((item) => item.key),
);

/** Matches migration SQL id: `ei_` + first 24 hex chars of md5(eventId:key). */
function defaultEventItemId(eventId: string, key: string): string {
  const digest = createHash("md5").update(`${eventId}:${key}`).digest("hex").slice(0, 24);
  return `ei_${digest}`;
}

/**
 * Lazy-init default EventItem rows (giftbag, badge, headset) — idempotent (Lock #7).
 * Covers events created after the one-time migration backfill.
 */
export async function ensureDefaultEventItems(eventId: string, db: DbClient): Promise<void> {
  await db.eventItem.createMany({
    data: DEFAULT_EVENT_ITEMS.map((item) => ({
      id: defaultEventItemId(eventId, item.key),
      event_id: eventId,
      key: item.key,
      label: item.label,
      type: "item",
      enabled: true,
      config: item.config,
    })),
    skipDuplicates: true,
  });
}
