import type { PrismaClient } from "@admitto/db";
import { getNotificationTypeDef } from "./registry.js";
import type { NotificationChannelKey } from "./types.js";

// Never Prisma.TransactionClient - see the Db comment in ./dispatcher.ts.
type Db = PrismaClient;

/**
 * Resolves which of a notification type's per-user channels (email, in_app - never webhook, a
 * team-wide resource handled separately by dispatcher.ts) are enabled for each of `userIds`, in
 * one query. No stored NotificationPreference row for a user means every applicable channel is on
 * for them (opt-out default, ADR 0044 §2). A type with `userConfigurable: false` (the ASVS V2.5.5
 * self-audience receipts) always maps every user to its full channel set regardless of any stored
 * row - letting the account owner silence the one alert meant to let them catch an unauthorized
 * change on their own account would defeat its purpose (see NotificationTypeDef.userConfigurable).
 */
export async function resolveEnabledChannelsForUsers(
  db: Db,
  userIds: string[],
  notificationType: string,
): Promise<Map<string, NotificationChannelKey[]>> {
  const result = new Map<string, NotificationChannelKey[]>();
  if (userIds.length === 0) return result;

  const typeDef = getNotificationTypeDef(notificationType);
  if (!typeDef) {
    for (const userId of userIds) result.set(userId, []);
    return result;
  }

  const perUserChannels = typeDef.availableChannels.filter(
    (channel): channel is "email" | "in_app" => channel !== "webhook",
  );
  if (perUserChannels.length === 0 || !typeDef.userConfigurable) {
    for (const userId of userIds) result.set(userId, perUserChannels);
    return result;
  }

  const preferences = await db.notificationPreference.findMany({
    where: {
      user_id: { in: userIds },
      notification_type: notificationType,
      channel: { in: perUserChannels },
    },
    select: { user_id: true, channel: true, enabled: true },
  });
  const explicitByUser = new Map<string, Map<string, boolean>>();
  for (const pref of preferences) {
    const forUser = explicitByUser.get(pref.user_id) ?? new Map<string, boolean>();
    forUser.set(pref.channel, pref.enabled);
    explicitByUser.set(pref.user_id, forUser);
  }

  for (const userId of userIds) {
    const explicit = explicitByUser.get(userId);
    result.set(
      userId,
      perUserChannels.filter((channel) => explicit?.get(channel) ?? true),
    );
  }
  return result;
}

/** Single-user convenience wrapper around resolveEnabledChannelsForUsers. */
export async function resolveEnabledChannels(
  db: Db,
  userId: string,
  notificationType: string,
): Promise<NotificationChannelKey[]> {
  const result = await resolveEnabledChannelsForUsers(db, [userId], notificationType);
  return result.get(userId) ?? [];
}
