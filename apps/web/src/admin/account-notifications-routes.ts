/**
 * Personal notification preferences, unread count, and inbox for the caller's own account
 * (notifications-module-foundation plan, PR4). Unlike notification-settings-routes.ts (org-level,
 * superadmin-only), every route here is scoped to the caller's own userId and needs nothing more
 * than requireSession - same convention as the rest of account-routes.ts. Lives in a sibling file
 * rather than growing that already-large file further.
 */

import type { Context } from "hono";
import { z } from "zod";
import type { PrismaClient } from "@admitto/db";
import {
  countUnreadNotifications,
  describePersonalNotifications,
  getNotificationTypeDef,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATION_TYPES,
  resolvePersonalPreferences,
  setNotificationPreference,
  type NotificationChannelKey,
} from "@admitto/notifications";

const PERSONAL_CHANNEL_KINDS = ["email", "in_app"] as const;
type PersonalChannelKind = (typeof PERSONAL_CHANNEL_KINDS)[number];

const patchPreferenceBodySchema = z
  .object({
    notification_type: z.string().min(1),
    channel: z.enum(PERSONAL_CHANNEL_KINDS),
    enabled: z.boolean(),
  })
  .strict();

/** Registry keys the personal grid may show - a type the account owner can't opt out of (ASVS
 * V2.5.5 self-audience receipts, userConfigurable: false) is never listed, same reasoning as
 * notification-settings-routes.ts's own orgDisableableTypeIds(), and the same defensive
 * own-property lookup via getNotificationTypeDef (not a direct NOTIFICATION_TYPES[id] index). */
function userConfigurableTypeIds(): string[] {
  return Object.keys(NOTIFICATION_TYPES).filter((id) => getNotificationTypeDef(id)?.userConfigurable);
}

async function serializePersonalPreferences(db: PrismaClient, userId: string) {
  const resolved = await resolvePersonalPreferences(db, userId);
  return {
    notification_types: userConfigurableTypeIds().map((id) => {
      const typeDef = getNotificationTypeDef(id)!;
      const availableChannels = typeDef.availableChannels.filter(
        (channel): channel is PersonalChannelKind => channel !== "webhook",
      );
      const enabled = new Set(resolved.get(id) ?? []);
      const channels: Partial<Record<PersonalChannelKind, boolean>> = {};
      for (const channel of availableChannels) channels[channel] = enabled.has(channel);
      return {
        id,
        label: typeDef.label,
        default_severity: typeDef.defaultSeverity,
        available_channels: availableChannels,
        channels,
      };
    }),
  };
}

/** GET /api/account/notifications/preferences */
export async function handleGetAccountNotificationPreferences(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const userId = c.get("auth").userId;
  return c.json(await serializePersonalPreferences(db, userId));
}

/** PATCH /api/account/notifications/preferences - toggles one grid cell. */
export async function handlePatchAccountNotificationPreference(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const userId = c.get("auth").userId;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const parsed = patchPreferenceBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed", details: parsed.error.flatten() }, 400);
  }

  const typeDef = getNotificationTypeDef(parsed.data.notification_type);
  if (!typeDef?.userConfigurable) {
    return c.json({ error: "invalid_notification_type" }, 400);
  }
  if (!typeDef.availableChannels.includes(parsed.data.channel as NotificationChannelKey)) {
    return c.json({ error: "invalid_channel" }, 400);
  }

  await setNotificationPreference(
    db,
    userId,
    parsed.data.notification_type,
    parsed.data.channel,
    parsed.data.enabled,
  );
  return c.json(await serializePersonalPreferences(db, userId));
}

async function serializePersonalNotifications(db: PrismaClient, userId: string) {
  const [notifications, unreadCount] = await Promise.all([
    describePersonalNotifications(db, userId),
    countUnreadNotifications(db, userId),
  ]);

  const orgIds = [...new Set(notifications.map((n) => n.organizationId))];
  const orgs = orgIds.length
    ? await db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
    : [];
  const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));

  return {
    notifications: notifications.map((n) => ({
      id: n.id,
      organization_name: orgNameById.get(n.organizationId) ?? null,
      notification_type: n.notificationType,
      severity: n.severity,
      title: n.title,
      body: n.body,
      created_at: n.createdAt.toISOString(),
      read_at: n.readAt ? n.readAt.toISOString() : null,
    })),
    unread_count: unreadCount,
  };
}

/** GET /api/account/notifications - latest 30 (read + unread), for the bell dropdown. */
export async function handleGetAccountNotifications(c: Context, db: PrismaClient): Promise<Response> {
  const userId = c.get("auth").userId;
  return c.json(await serializePersonalNotifications(db, userId));
}

/** GET /api/account/notifications/unread-count - the bell's cheap 30s poll target. */
export async function handleGetAccountNotificationsUnreadCount(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const userId = c.get("auth").userId;
  const unreadCount = await countUnreadNotifications(db, userId);
  return c.json({ unread_count: unreadCount });
}

/** PATCH /api/account/notifications/:id/read */
export async function handlePatchAccountNotificationRead(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const userId = c.get("auth").userId;
  const id = c.req.param("id") ?? "";
  if (!id) return c.json({ error: "id required" }, 400);

  const result = await markNotificationRead(db, userId, id);
  if (result === "forbidden") return c.json({ error: "forbidden" }, 403);
  // "not_found": same idempotent-200 convention as DELETE /api/account/sessions/:sessionId on a
  // stale/already-gone id - nothing to mark read, not the caller's fault.
  const unreadCount = await countUnreadNotifications(db, userId);
  return c.json({ unread_count: unreadCount });
}

/** POST /api/account/notifications/mark-all-read */
export async function handlePostAccountNotificationsMarkAllRead(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const userId = c.get("auth").userId;
  const updatedCount = await markAllNotificationsRead(db, userId);
  return c.json({ updated_count: updatedCount, unread_count: 0 });
}
