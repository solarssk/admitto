import type { Prisma, PrismaClient } from "@admitto/db";
import { getNotificationTypeDef } from "./registry.js";
import type { NotificationChannelKey } from "./types.js";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Resolves which of a notification type's per-user channels (email, in_app — never webhook, a
 * team-wide resource handled separately by dispatcher.ts) are enabled for one user.
 *
 * No stored NotificationPreference rows means every applicable channel is on — opt-out default
 * (ADR 0044 §2). A type with `userConfigurable: false` (the ASVS V2.5.5 self-audience receipts)
 * always returns its full channel set regardless of any stored row — letting the account owner
 * silence the one alert meant to let them catch an unauthorized change on their own account
 * would defeat its purpose (see NotificationTypeDef.userConfigurable).
 */
export async function resolveEnabledChannels(
  db: Db,
  userId: string,
  notificationType: string,
): Promise<NotificationChannelKey[]> {
  const typeDef = getNotificationTypeDef(notificationType);
  if (!typeDef) return [];

  const perUserChannels = typeDef.availableChannels.filter(
    (channel): channel is "email" | "in_app" => channel !== "webhook",
  );
  if (perUserChannels.length === 0) return [];
  if (!typeDef.userConfigurable) return perUserChannels;

  const preferences = await db.notificationPreference.findMany({
    where: {
      user_id: userId,
      notification_type: notificationType,
      channel: { in: perUserChannels },
    },
    select: { channel: true, enabled: true },
  });
  if (preferences.length === 0) return perUserChannels;

  const explicit = new Map(preferences.map((p) => [p.channel, p.enabled]));
  return perUserChannels.filter((channel) => explicit.get(channel) ?? true);
}
