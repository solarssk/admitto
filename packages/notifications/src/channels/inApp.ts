import type { Prisma, PrismaClient } from "@admitto/db";
import type { NotificationChannel, NotificationSendResult } from "../channel.js";
import type { DispatchedNotification } from "../types.js";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * In-app delivery — inserts one Notification row per recipient. Always `ok: true` on a
 * successful insert: no external call, no SSRF/timeout to handle (prompt 86 §2.A).
 */
export class InAppChannel implements NotificationChannel {
  readonly channel = "in_app" as const;

  constructor(private readonly db: Db) {}

  async send(
    event: DispatchedNotification,
    recipientUserIds: string[],
  ): Promise<NotificationSendResult> {
    if (recipientUserIds.length === 0) return { ok: true };
    try {
      await this.db.notification.createMany({
        data: recipientUserIds.map((userId) => ({
          user_id: userId,
          notification_type: event.type,
          severity: event.severity,
          title: event.title,
          body: event.body,
          metadata: (event.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        })),
      });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message.slice(0, 300) };
    }
  }
}
