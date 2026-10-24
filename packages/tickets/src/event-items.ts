import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@admitto/db";

export { isBadgeItemUsable } from "./event-item-usability.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * The "badge" item is structurally required by the `badge_at_entry` ops-config
 * toggle (see `admit.ts` / `issueBadgeOnCheckIn`) — that toggle, which defaults
 * to on, has no effect unless an EventItem with key "badge" exists. Unlike other
 * items (giftbag, headset, ...), which are fully optional and left for operators
 * to add manually via + Add item (#367, #368), "badge" is auto-created so the
 * always-on-by-default toggle is functional out of the box.
 */
const DEFAULT_BADGE_ITEM = {
  key: "badge",
  label: "Badge",
  description: "Name badge issued at check-in.",
  icon: "id-badge-2",
  config: { issue_on_checkin: true, requires_return: false },
} as const;

/** Public constant for the structural "badge" item key — reuse instead of the "badge" literal. */
export const BADGE_ITEM_KEY = DEFAULT_BADGE_ITEM.key;

/**
 * The "companion" item (D-E5): the guest's +1, ticked off at the door like a hand-out. It is offered only to the guests
 * who have a companion (`audience: "with_companion"`), is not given back and is not issued at check-in. Unlike the badge
 * it is not there from the start: an admission that saves a companion creates it (`ensureCompanionEventItem`), so an
 * event that has no companions never has it and shows nothing new.
 */
const DEFAULT_COMPANION_ITEM = {
  key: "companion",
  label: "Companion",
  description: "Tick it when the guest's companion has come in.",
  icon: "user",
  config: { audience: "with_companion", requires_return: false, issue_on_checkin: false },
} as const;

/** Public constant for the "companion" item key - reuse instead of the "companion" literal. */
export const COMPANION_ITEM_KEY = DEFAULT_COMPANION_ITEM.key;

type DefaultEventItem = {
  key: string;
  label: string;
  description: string;
  icon: string;
  config: Prisma.InputJsonObject;
};

/** Matches migration SQL id: `ei_` + first 24 hex chars of md5(eventId:key). */
function defaultEventItemId(eventId: string, key: string): string {
  const digest = createHash("md5").update(`${eventId}:${key}`).digest("hex").slice(0, 24);
  return `ei_${digest}`;
}

/**
 * Creates an event's default item when the event has no item with its key - idempotent (Lock #7). The id is a hash of
 * the event and the key, and `skipDuplicates` makes the insert `ON CONFLICT DO NOTHING`, so two callers at once (the
 * unique index is on `(event_id, key)`) leave one row, and so does a caller after one that made its own item with the key.
 * An item that exists is left alone, disabled or edited: it is the organiser's now.
 */
async function ensureDefaultEventItem(eventId: string, db: DbClient, item: DefaultEventItem): Promise<void> {
  const existing = await db.eventItem.findFirst({
    where: { event_id: eventId, key: item.key },
    select: { id: true },
  });
  if (existing) return;

  await db.eventItem.createMany({
    data: [
      {
        id: defaultEventItemId(eventId, item.key),
        event_id: eventId,
        key: item.key,
        label: item.label,
        description: item.description,
        icon: item.icon,
        type: "item",
        enabled: true,
        config: item.config,
      },
    ],
    skipDuplicates: true,
  });
}

/**
 * Lazy-init the default "badge" EventItem row — idempotent (Lock #7).
 * Safe to call repeatedly; `skipDuplicates` makes it a no-op once the row exists
 * (including when a caller already created its own "badge" item beforehand).
 */
export function ensureBadgeEventItem(eventId: string, db: DbClient): Promise<void> {
  return ensureDefaultEventItem(eventId, db, DEFAULT_BADGE_ITEM);
}

/**
 * Creates the event's "companion" item when it has none (see DEFAULT_COMPANION_ITEM) - idempotent, like the badge. Called by
 * the admission that saves a companion, in its transaction. An organiser may disable or delete the item; the next
 * companion admitted creates it again, as a deleted badge comes back.
 */
export function ensureCompanionEventItem(eventId: string, db: DbClient): Promise<void> {
  return ensureDefaultEventItem(eventId, db, DEFAULT_COMPANION_ITEM);
}
