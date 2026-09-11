import type { PrismaClient } from "@admitto/db";
import type { NotificationSeverity } from "./types.js";

// Same as preferences.ts's own Db: personal, per-user data with no need to compose with an
// AdminAuditLog write in a caller's transaction (unlike settings.ts, which is org-level state).
type Db = PrismaClient;

/** Activity-list cap convention already accepted elsewhere in the product ("Recent activity"):
 * full history is a deliberately separate, not-yet-built feature, not pagination here. */
const PERSONAL_NOTIFICATIONS_LIMIT = 30;

export interface PersonalNotification {
  id: string;
  organizationId: string;
  notificationType: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  createdAt: Date;
  readAt: Date | null;
}

/**
 * The caller's own most recent notifications (read and unread), newest first. Scoped by user_id
 * in the query itself - isolation is structural here, not a check the route layer could forget to
 * apply. organizationId is returned so the route layer can resolve it to a name: a superadmin's
 * org-staff-audience alerts can come from more than one organization, and title/severity alone
 * don't identify which one (see the Notification model's own schema comment).
 */
export async function describePersonalNotifications(
  db: Db,
  userId: string,
): Promise<PersonalNotification[]> {
  const rows = await db.notification.findMany({
    where: { user_id: userId },
    orderBy: { created_at: "desc" },
    take: PERSONAL_NOTIFICATIONS_LIMIT,
    select: {
      id: true,
      organization_id: true,
      notification_type: true,
      severity: true,
      title: true,
      body: true,
      created_at: true,
      read_at: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    notificationType: row.notification_type,
    severity: row.severity as NotificationSeverity,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
  }));
}

/** Count of the caller's own unread notifications, capped to the same window
 * describePersonalNotifications shows - an unbounded count would let the bell's badge climb past
 * what the list can ever display or let the caller mark as read, once someone has more than
 * PERSONAL_NOTIFICATIONS_LIMIT unread at once. Still a single indexed read (see the Notification
 * model's @@index([user_id, read_at])), just capped after. */
export async function countUnreadNotifications(db: Db, userId: string): Promise<number> {
  const rows = await db.notification.findMany({
    where: { user_id: userId },
    orderBy: { created_at: "desc" },
    take: PERSONAL_NOTIFICATIONS_LIMIT,
    select: { read_at: true },
  });
  return rows.filter((row) => row.read_at === null).length;
}

/**
 * Marks one notification read on the caller's behalf. "forbidden" (not a silent no-op, not
 * "not_found") when the row exists but belongs to a different user - the route layer maps this to
 * 403, matching the existing personal-resource isolation convention (see
 * account-routes.ts/DELETE /api/account/sessions/:id). Idempotent: an already-read row returns
 * "ok" without writing again.
 */
export async function markNotificationRead(
  db: Db,
  userId: string,
  notificationId: string,
): Promise<"ok" | "not_found" | "forbidden"> {
  const row = await db.notification.findUnique({
    where: { id: notificationId },
    select: { user_id: true, read_at: true },
  });
  if (!row) return "not_found";
  if (row.user_id !== userId) return "forbidden";
  if (row.read_at) return "ok";
  await db.notification.update({ where: { id: notificationId }, data: { read_at: new Date() } });
  return "ok";
}

/** Marks every one of the caller's own unread notifications read in one statement, scoped by
 * user_id - inherently isolation-safe, nothing for another user's rows to be touched by. */
export async function markAllNotificationsRead(db: Db, userId: string): Promise<number> {
  const result = await db.notification.updateMany({
    where: { user_id: userId, read_at: null },
    data: { read_at: new Date() },
  });
  return result.count;
}

/** Permanently deletes every one of the caller's own notifications, scoped by user_id - the same
 * inherent isolation as markAllNotificationsRead. A real delete, not a hide/dismiss flag: the
 * durable, compliance-relevant record of the underlying security event already lives in
 * SecurityAuditLog (untouched here), so this table is purely the in-app delivery/inbox copy - safe
 * to clear on request the same way purgeNotifications (retention.ts) clears it automatically after
 * the retention window for whoever never does. */
export async function clearAllNotifications(db: Db, userId: string): Promise<number> {
  const result = await db.notification.deleteMany({ where: { user_id: userId } });
  return result.count;
}
