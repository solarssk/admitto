import type { PrismaClient } from "@admitto/db";
import { NOTIFICATION_TYPES, getNotificationTypeDef } from "./registry.js";
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

/**
 * The personal-preferences grid's read side (PR4): one user's per-channel opt-out state across
 * every userConfigurable notification type, in a single query. Mirror image of
 * resolveEnabledChannelsForUsers (which is one-type/many-users) - this is one-user/many-types.
 * A type with userConfigurable: false is omitted from the returned map entirely, not just left
 * with its full channel set - there's nothing for the grid to offer a toggle for.
 */
export async function resolvePersonalPreferences(
  db: Db,
  userId: string,
): Promise<Map<string, NotificationChannelKey[]>> {
  const result = new Map<string, NotificationChannelKey[]>();
  const configurableTypeIds = Object.keys(NOTIFICATION_TYPES).filter(
    (id) => getNotificationTypeDef(id)?.userConfigurable,
  );
  if (configurableTypeIds.length === 0) return result;

  const preferences = await db.notificationPreference.findMany({
    where: { user_id: userId, notification_type: { in: configurableTypeIds } },
    select: { notification_type: true, channel: true, enabled: true },
  });
  const explicitByType = new Map<string, Map<string, boolean>>();
  for (const pref of preferences) {
    const forType = explicitByType.get(pref.notification_type) ?? new Map<string, boolean>();
    forType.set(pref.channel, pref.enabled);
    explicitByType.set(pref.notification_type, forType);
  }

  for (const typeId of configurableTypeIds) {
    const typeDef = getNotificationTypeDef(typeId);
    const perUserChannels = (typeDef?.availableChannels ?? []).filter(
      (channel): channel is "email" | "in_app" => channel !== "webhook",
    );
    const explicit = explicitByType.get(typeId);
    result.set(
      typeId,
      perUserChannels.filter((channel) => explicit?.get(channel) ?? true),
    );
  }
  return result;
}

/**
 * Single-cell upsert for the personal-preferences grid. Trusts the caller for validity
 * (notificationType is real and userConfigurable, channel is one of its non-webhook
 * availableChannels) - same validation-is-the-route's-job split patchNotificationSettings already
 * documents. No transaction, no AdminAuditLog: this is the user's own personal setting, not an
 * administrative action on organization state.
 */
export async function setNotificationPreference(
  db: Db,
  userId: string,
  notificationType: string,
  channel: "email" | "in_app",
  enabled: boolean,
): Promise<void> {
  await db.notificationPreference.upsert({
    where: { user_id_notification_type_channel: { user_id: userId, notification_type: notificationType, channel } },
    create: { user_id: userId, notification_type: notificationType, channel, enabled },
    update: { enabled },
  });
}
