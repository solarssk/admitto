import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@admitto/db";
import type { EventItemConfig } from "./types.js";

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
  config: { issue_on_checkin: true, requires_return: false },
} as const;

/** Public constant for the structural "badge" item key — reuse instead of the "badge" literal. */
export const BADGE_ITEM_KEY = DEFAULT_BADGE_ITEM.key;

/**
 * Single source of truth for "can the badge item actually back badge_at_entry
 * right now" — an item that's disabled, or has issue_on_checkin explicitly
 * turned off, can't auto-issue at check-in. Used by both the admin API
 * (guarding/syncing badge_at_entry) and the admin SPA (disabling the toggle).
 */
export function isBadgeItemUsable(
  enabled: boolean,
  config: Pick<EventItemConfig, "issue_on_checkin"> | null | undefined,
): boolean {
  return enabled && config?.issue_on_checkin !== false;
}

/** Matches migration SQL id: `ei_` + first 24 hex chars of md5(eventId:key). */
function defaultEventItemId(eventId: string, key: string): string {
  const digest = createHash("md5").update(`${eventId}:${key}`).digest("hex").slice(0, 24);
  return `ei_${digest}`;
}

/**
 * Lazy-init the default "badge" EventItem row — idempotent (Lock #7).
 * Safe to call repeatedly; `skipDuplicates` makes it a no-op once the row exists
 * (including when a caller already created its own "badge" item beforehand).
 */
export async function ensureBadgeEventItem(eventId: string, db: DbClient): Promise<void> {
  const existing = await db.eventItem.findFirst({
    where: { event_id: eventId, key: DEFAULT_BADGE_ITEM.key },
    select: { id: true },
  });
  if (existing) return;

  await db.eventItem.createMany({
    data: [
      {
        id: defaultEventItemId(eventId, DEFAULT_BADGE_ITEM.key),
        event_id: eventId,
        key: DEFAULT_BADGE_ITEM.key,
        label: DEFAULT_BADGE_ITEM.label,
        type: "item",
        enabled: true,
        config: DEFAULT_BADGE_ITEM.config,
      },
    ],
    skipDuplicates: true,
  });
}
