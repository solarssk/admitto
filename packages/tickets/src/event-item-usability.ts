import type { EventItemConfig } from "./types.js";

/**
 * Single source of truth for "can the badge item actually back badge_at_entry
 * right now" — an item that's disabled, or has issue_on_checkin explicitly
 * turned off, can't auto-issue at check-in. Used by both the admin API
 * (guarding/syncing badge_at_entry) and the admin SPA (disabling the toggle).
 *
 * Kept in its own node-free module (no `node:crypto`/Prisma imports) so
 * `apps/admin` can import it via `@admitto/tickets/event-item-usability`
 * without pulling the rest of the tickets package's server-only code into
 * the browser bundle.
 */
export function isBadgeItemUsable(
  enabled: boolean,
  config: Pick<EventItemConfig, "issue_on_checkin"> | null | undefined,
): boolean {
  return enabled && config?.issue_on_checkin !== false;
}
